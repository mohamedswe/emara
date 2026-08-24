// Empirical analysis: turn raw audit runs into a durable evidence base.
//
// Reads every run under audit-results/<target>/, groups them by experiment label
// (the part after the timestamp, e.g. "variance-3" -> group "variance"), computes
// per-group statistics, and writes a committed data-analysis/ report that proves
// whether a change worked — by comparing groups against each other, not by
// trusting any single run.
//
// Usage:
//   node --experimental-strip-types bench/analyze.ts audit-results/<target>
//
// Writes:
//   data-analysis/<target>-<date>.json   machine-readable evidence
//   data-analysis/<target>-<date>.md     human-readable report
//   data-analysis/latest-<target>.json   always points at the most recent analysis

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface RunMetrics {
  label?: string;
  startedAt?: string;
  wallClockMs?: number;
  exitCode?: number;
  acceptance?: string | null;
  acceptanceFailures?: string[];
  tokens?: { requests?: number; promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
  turns?: number | null;
  toolCalls?: number | null;
  correctionConverged?: boolean | null;
  coverage?: { coveragePercent?: number | null; unexplainedMeaningfulNodes?: number | null; unaccountedMeaningfulNodes?: number | null };
}

interface Stat {
  n: number;
  min: number;
  max: number;
  mean: number;
  stdev: number;
  spread: number;
}

function stat(values: Array<number | null | undefined>): Stat | null {
  const vals = values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (vals.length === 0) return null;
  const n = vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const stdev = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { n, min: r(min), max: r(max), mean: r(mean), stdev: r(stdev), spread: r(max - min) };
}

function r(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Extract the experiment group from a run dir name: "<timestamp>-<label>-<n>" -> "<label>". */
function groupOf(dirName: string, label: string | undefined): string {
  const source = label ?? dirName;
  // Strip a trailing -<number> (run index) to get the experiment group.
  const m = source.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, "").replace(/-\d+$/, "");
  return m.length > 0 ? m : "ungrouped";
}

function main(): void {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error("Usage: node --experimental-strip-types bench/analyze.ts audit-results/<target>");
    process.exit(1);
  }
  const root = resolve(dir);
  if (!existsSync(root)) {
    console.error(`No such directory: ${root}`);
    process.exit(1);
  }
  const target = basename(root);

  const runs: Array<{ dir: string; group: string; m: RunMetrics }> = [];
  let skippedFailed = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metricsPath = join(root, entry.name, "metrics.json");
    if (!existsSync(metricsPath)) continue;
    try {
      const m = JSON.parse(readFileSync(metricsPath, "utf8")) as RunMetrics;
      // Skip failed runs (crashed / network error / no tokens consumed) so they
      // don't pollute group statistics. A run that never reached the model is not
      // evidence about the auditor's behavior.
      const failed = m.exitCode === 1 || m.tokens == null;
      if (failed) {
        skippedFailed += 1;
        continue;
      }
      runs.push({ dir: entry.name, group: groupOf(entry.name, m.label), m });
    } catch {
      // skip unreadable
    }
  }
  if (runs.length === 0) {
    console.error(`No successful runs with metrics.json under ${root}`);
    process.exit(1);
  }

  // Group runs by experiment label.
  const groups = new Map<string, RunMetrics[]>();
  for (const run of runs) {
    const list = groups.get(run.group) ?? [];
    list.push(run.m);
    groups.set(run.group, list);
  }

  const groupStats = [...groups.entries()].map(([group, ms]) => ({
    group,
    runs: ms.length,
    convergedRate: r(ms.filter((m) => m.correctionConverged === true).length / ms.length),
    acceptanceRate: r(ms.filter((m) => m.acceptance === "STATICALLY_VERIFIED" || m.acceptance === "RUNTIME_VERIFIED").length / ms.length),
    coveragePercent: stat(ms.map((m) => m.coverage?.coveragePercent)),
    unaccountedNodes: stat(ms.map((m) => m.coverage?.unaccountedMeaningfulNodes)),
    unexplainedNodes: stat(ms.map((m) => m.coverage?.unexplainedMeaningfulNodes)),
    totalTokens: stat(ms.map((m) => m.tokens?.totalTokens)),
    turns: stat(ms.map((m) => m.turns)),
    wallClockSeconds: stat(ms.map((m) => (typeof m.wallClockMs === "number" ? m.wallClockMs / 1000 : undefined))),
  }));

  const analysis = {
    schema: "auditor-analysis/v1",
    target,
    generatedAt: new Date().toISOString(),
    totalRuns: runs.length,
    skippedFailedRuns: skippedFailed,
    groups: groupStats,
  };

  const outDir = resolve(projectRoot, "data-analysis");
  mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const jsonPath = join(outDir, `${target}-${date}.json`);
  const mdPath = join(outDir, `${target}-${date}.md`);
  const latestPath = join(outDir, `latest-${target}.json`);

  writeFileSync(jsonPath, JSON.stringify(analysis, null, 2));
  writeFileSync(latestPath, JSON.stringify(analysis, null, 2));
  writeFileSync(mdPath, renderMarkdown(analysis));

  console.log(`[analyze] ${runs.length} successful run(s) across ${groups.size} group(s)${skippedFailed > 0 ? ` (${skippedFailed} failed run(s) excluded)` : ""}`);
  for (const g of groupStats) {
    const cov = g.coveragePercent;
    const tok = g.totalTokens;
    console.log(
      `[analyze]   ${g.group.padEnd(12)} n=${g.runs} converged=${Math.round(g.convergedRate * 100)}% cov=${cov ? `${cov.mean}%±${cov.stdev}` : "-"} tokens=${tok ? tok.mean : "-"}`,
    );
  }
  console.log(`[analyze] wrote ${jsonPath}`);
  console.log(`[analyze] wrote ${mdPath}`);
}

function renderMarkdown(analysis: {
  target: string;
  generatedAt: string;
  totalRuns: number;
  groups: Array<{
    group: string;
    runs: number;
    convergedRate: number;
    acceptanceRate: number;
    coveragePercent: Stat | null;
    unaccountedNodes: Stat | null;
    totalTokens: Stat | null;
    turns: Stat | null;
    wallClockSeconds: Stat | null;
  }>;
}): string {
  const lines: string[] = [];
  lines.push(`# Empirical analysis — ${analysis.target}`);
  lines.push("");
  lines.push(`Generated ${analysis.generatedAt} from ${analysis.totalRuns} audit run(s).`);
  lines.push("");
  lines.push("Each group is one experiment configuration. Compare groups to prove whether a");
  lines.push("change worked — a real effect must exceed the within-group noise (stdev).");
  lines.push("");
  lines.push("| Group | Runs | Converged | Coverage (mean±sd) | Unaccounted | Tokens (mean) | Turns | Time (s) |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const g of analysis.groups) {
    const cov = g.coveragePercent ? `${g.coveragePercent.mean}% ±${g.coveragePercent.stdev}` : "-";
    const unacc = g.unaccountedNodes ? `${g.unaccountedNodes.mean}` : "-";
    const tok = g.totalTokens ? `${Math.round(g.totalTokens.mean).toLocaleString()}` : "-";
    const turns = g.turns ? `${g.turns.mean}` : "-";
    const wall = g.wallClockSeconds ? `${g.wallClockSeconds.mean}` : "-";
    lines.push(`| ${g.group} | ${g.runs} | ${Math.round(g.convergedRate * 100)}% | ${cov} | ${unacc} | ${tok} | ${turns} | ${wall} |`);
  }
  lines.push("");
  lines.push("## How to read this");
  lines.push("");
  lines.push("- **Converged** — fraction of runs where the correction loop converged. Higher is better.");
  lines.push("- **Coverage** — fraction of meaningful code accounted for. The headline functionality signal.");
  lines.push("- **stdev** — the noise floor. A difference between two groups smaller than the combined");
  lines.push("  stdev is not yet proven; run more samples.");
  lines.push("- **Tokens / Turns / Time** — cost. Lower at equal coverage is a strict win.");
  lines.push("");
  return lines.join("\n");
}

main();
