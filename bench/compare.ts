// Compare every audit run under a target directory.
//
// Reads each <dir>/metrics.json and prints a table sorted by start time so token
// and time variance across identical fixed-prompt runs is visible at a glance.
//
// Usage:
//   node --experimental-strip-types bench/compare.ts audit-results/<target>

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

interface RunMetrics {
  label?: string;
  startedAt?: string;
  wallClockMs?: number;
  exitCode?: number;
  acceptance?: string | null;
  tokens?: { totalTokens?: number; promptTokens?: number; completionTokens?: number } | null;
  turns?: number | null;
  toolCalls?: number | null;
  coverage?: { coveragePercent?: number | null; unexplainedMeaningfulNodes?: number | null };
}

function fmt(n: unknown, digits = 0): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "-";
  return digits > 0 ? n.toFixed(digits) : String(Math.round(n));
}

function main(): void {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error("Usage: node --experimental-strip-types bench/compare.ts audit-results/<target>");
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
    const metricsPath = join(root, entry.name, "metrics.json");
    if (!existsSync(metricsPath)) continue;
    try {
      const m = JSON.parse(readFileSync(metricsPath, "utf8")) as RunMetrics;
      runs.push({ dir: entry.name, m });
    } catch {
      // skip unreadable run
    }
  }

  runs.sort((a, b) => (a.m.startedAt ?? "").localeCompare(b.m.startedAt ?? ""));

  if (runs.length === 0) {
    console.log(`No runs with metrics.json found under ${root}`);
    return;
  }

  const header = [
    "run".padEnd(28),
    "accept".padEnd(10),
    "tokens".padStart(9),
    "prompt".padStart(9),
    "compl".padStart(8),
    "time(s)".padStart(8),
    "turns".padStart(6),
    "tools".padStart(6),
    "cov%".padStart(6),
    "unexpl".padStart(7),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));

  const totals: number[] = [];
  const times: number[] = [];
  for (const { dir, m } of runs) {
    const t = m.tokens ?? {};
    console.log(
      [
        dir.slice(0, 28).padEnd(28),
        (m.acceptance ?? "-").slice(0, 10).padEnd(10),
        fmt(t.totalTokens).padStart(9),
        fmt(t.promptTokens).padStart(9),
        fmt(t.completionTokens).padStart(8),
        fmt(typeof m.wallClockMs === "number" ? m.wallClockMs / 1000 : undefined, 1).padStart(8),
        fmt(m.turns).padStart(6),
        fmt(m.toolCalls).padStart(6),
        fmt(m.coverage?.coveragePercent, 1).padStart(6),
        fmt(m.coverage?.unexplainedMeaningfulNodes).padStart(7),
      ].join(" "),
    );
    if (typeof t.totalTokens === "number") totals.push(t.totalTokens);
    if (typeof m.wallClockMs === "number") times.push(m.wallClockMs / 1000);
  }

  if (totals.length > 0) {
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    console.log("-".repeat(header.length));
    console.log(`tokens total: n=${totals.length} min=${min} avg=${Math.round(avg)} max=${max} spread=${max - min}`);
  }
  if (times.length > 0) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`time(s):      n=${times.length} min=${Math.min(...times).toFixed(1)} avg=${avg.toFixed(1)} max=${Math.max(...times).toFixed(1)}`);
  }
}

main();
