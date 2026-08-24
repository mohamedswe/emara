// Aggregate every run under a target directory into a durable summary.json.
//
// bench/compare.ts prints a table to the terminal; this writes the variance
// statistics to disk so the noise floor (or any experiment's aggregate) is a
// committed artifact you can diff against later — not ephemeral terminal output.
//
// Usage:
//   node --experimental-strip-types bench/summarize.ts audit-results/<target> [labelFilter]
//
// Writes audit-results/<target>/summary[.labelFilter].json

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

interface RunMetrics {
  label?: string;
  startedAt?: string;
  wallClockMs?: number;
  exitCode?: number;
  acceptance?: string | null;
  tokens?: {
    requests?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
  turns?: number | null;
  toolCalls?: number | null;
  coverage?: {
    coveragePercent?: number | null;
    unexplainedMeaningfulNodes?: number | null;
    unaccountedMeaningfulNodes?: number | null;
  };
}

interface StatSummary {
  n: number;
  min: number;
  max: number;
  mean: number;
  stdev: number;
  spread: number;
  spreadPercentOfMean: number;
}

function summarize(values: number[]): StatSummary | null {
  const vals = values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (vals.length === 0) return null;
  const n = vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n; // population stdev
  const stdev = Math.sqrt(variance);
  const spread = max - min;
  return {
    n,
    min: round(min),
    max: round(max),
    mean: round(mean),
    stdev: round(stdev),
    spread: round(spread),
    spreadPercentOfMean: mean === 0 ? 0 : round((spread / mean) * 100),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function main(): void {
  const dir = process.argv[2];
  const labelFilter = process.argv[3];
  if (dir === undefined) {
    console.error("Usage: node --experimental-strip-types bench/summarize.ts audit-results/<target> [labelFilter]");
    process.exit(1);
  }
  const root = resolve(dir);
  if (!existsSync(root)) {
    console.error(`No such directory: ${root}`);
    process.exit(1);
  }

  const runs: Array<{ dir: string; m: RunMetrics }> = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (labelFilter !== undefined && !entry.name.includes(labelFilter)) continue;
    const metricsPath = join(root, entry.name, "metrics.json");
    if (!existsSync(metricsPath)) continue;
    try {
      runs.push({ dir: entry.name, m: JSON.parse(readFileSync(metricsPath, "utf8")) as RunMetrics });
    } catch {
      // skip unreadable
    }
  }
  runs.sort((a, b) => (a.m.startedAt ?? "").localeCompare(b.m.startedAt ?? ""));

  if (runs.length === 0) {
    console.error(`No runs with metrics.json found under ${root}${labelFilter ? ` matching "${labelFilter}"` : ""}`);
    process.exit(1);
  }

  const summary = {
    schema: "auditor-summary/v1",
    targetDir: root,
    labelFilter: labelFilter ?? null,
    generatedAt: new Date().toISOString(),
    runCount: runs.length,
    runs: runs.map(({ dir, m }) => ({
      dir,
      label: m.label ?? null,
      startedAt: m.startedAt ?? null,
      acceptance: m.acceptance ?? null,
      exitCode: m.exitCode ?? null,
      coveragePercent: m.coverage?.coveragePercent ?? null,
      unexplainedNodes: m.coverage?.unexplainedMeaningfulNodes ?? null,
      unaccountedNodes: m.coverage?.unaccountedMeaningfulNodes ?? null,
      totalTokens: m.tokens?.totalTokens ?? null,
      promptTokens: m.tokens?.promptTokens ?? null,
      completionTokens: m.tokens?.completionTokens ?? null,
      requests: m.tokens?.requests ?? null,
      turns: m.turns ?? null,
      toolCalls: m.toolCalls ?? null,
      wallClockSeconds: typeof m.wallClockMs === "number" ? round(m.wallClockMs / 1000) : null,
    })),
    stats: {
      coveragePercent: summarize(runs.map((r) => r.m.coverage?.coveragePercent).filter((v): v is number => typeof v === "number")),
      unexplainedNodes: summarize(runs.map((r) => r.m.coverage?.unexplainedMeaningfulNodes).filter((v): v is number => typeof v === "number")),
      unaccountedNodes: summarize(runs.map((r) => r.m.coverage?.unaccountedMeaningfulNodes).filter((v): v is number => typeof v === "number")),
      totalTokens: summarize(runs.map((r) => r.m.tokens?.totalTokens).filter((v): v is number => typeof v === "number")),
      requests: summarize(runs.map((r) => r.m.tokens?.requests).filter((v): v is number => typeof v === "number")),
      turns: summarize(runs.map((r) => r.m.turns).filter((v): v is number => typeof v === "number")),
      wallClockSeconds: summarize(runs.map((r) => (typeof r.m.wallClockMs === "number" ? r.m.wallClockMs / 1000 : undefined)).filter((v): v is number => typeof v === "number")),
    },
  };

  const outName = labelFilter ? `summary.${labelFilter}.json` : "summary.json";
  const outPath = join(root, outName);
  writeFileSync(outPath, JSON.stringify(summary, null, 2));

  // Console echo of the headline numbers.
  const c = summary.stats.coveragePercent;
  const t = summary.stats.totalTokens;
  console.log(`[summarize] ${runs.length} run(s) -> ${outPath}`);
  if (c) console.log(`[summarize] coverage: mean=${c.mean}% stdev=${c.stdev} spread=${c.spread}pts (${c.min}-${c.max})`);
  if (t) console.log(`[summarize] tokens:   mean=${t.mean} stdev=${t.stdev} spread=${t.spreadPercentOfMean}% (${t.min}-${t.max})`);
}

main();
