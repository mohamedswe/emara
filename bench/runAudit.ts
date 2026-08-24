// Scientific audit runner.
//
// Runs build:contract against a target repository with a fixed configuration and
// writes a self-contained run directory under audit-results/<target>/<stamp>-<label>/
// containing the graph, the contract, and a metrics.json with every quantifiable
// signal the auditor emits (tokens, wall-clock, turns, coverage, acceptance).
//
// Usage:
//   node --experimental-strip-types bench/runAudit.ts <targetRepoPath> [label]
//
// The DeepSeek API key is read from the repo-root .env (see .env.example).

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { parse as parseYaml } from "yaml";

import { scoreContract } from "../src/contract/scoreContract.ts";
import type { SoftwareContract } from "../src/contract/types.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function timestamp(): string {
  // 2026-08-18T18-30-00 (filesystem-safe, sortable)
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function main(): Promise<void> {
  const [, , targetArg, labelArg, keepFullArg] = process.argv;
  if (targetArg === undefined || targetArg.length === 0) {
    console.error("Usage: node --experimental-strip-types bench/runAudit.ts <targetRepoPath> [label] [keepFullToolOutputs]");
    process.exit(1);
  }
  const targetPath = resolve(targetArg);
  if (!existsSync(targetPath)) {
    console.error(`Target repository does not exist: ${targetPath}`);
    process.exit(1);
  }
  const targetName = basename(targetPath);
  const label = (labelArg ?? "run").replace(/[^a-zA-Z0-9_-]/g, "-");
  const keepFull = keepFullArg === undefined ? undefined : Number(keepFullArg);
  if (keepFull !== undefined && (!Number.isSafeInteger(keepFull) || keepFull < 0)) {
    console.error("keepFullToolOutputs must be a non-negative integer");
    process.exit(1);
  }
  const runDir = resolve(
    projectRoot,
    "audit-results",
    targetName,
    `${timestamp()}-${label}`,
  );
  mkdirSync(runDir, { recursive: true });

  const graphPath = resolve(runDir, "graph.json");
  const contractPath = resolve(runDir, "contract.yaml");

  const args = [
    "--experimental-strip-types",
    resolve(projectRoot, "src/contract/buildContract.ts"),
    targetPath,
    "--graph", graphPath,
    "--output", contractPath,
    ...(keepFull === undefined ? [] : ["--keep-full-tool-outputs", String(keepFull)]),
  ];

  console.log(`[bench] target=${targetPath}`);
  console.log(`[bench] runDir=${runDir}`);
  const startedAt = Date.now();

  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  child.stderr.on("data", (d) => { stderr += d.toString(); });

  const exitCode: number = await new Promise((res) => {
    child.on("close", (code) => res(code ?? 1));
  });
  const wallClockMs = Date.now() - startedAt;

  // The CLI prints one JSON object on stdout (its metrics summary) and exits 2
  // when the contract is INCOMPLETE. Both are valid scientific outcomes — record
  // them, do not treat a non-zero exit as a harness failure.
  let cliSummary: Record<string, unknown> = {};
  const jsonLine = stdout.trim().split("\n").find((l) => l.trim().startsWith("{"));
  if (jsonLine !== undefined) {
    try {
      cliSummary = JSON.parse(jsonLine);
    } catch {
      cliSummary = { parseError: "could not parse CLI JSON", raw: stdout.slice(0, 2000) };
    }
  } else if (stdout.trim().length > 0) {
    cliSummary = { raw: stdout.slice(0, 2000) };
  }

  const metrics = {
    schema: "auditor-run/v1",
    target: { name: targetName, path: targetPath },
    label,
    runDir,
    keepFullToolOutputs: keepFull ?? null,
    startedAt: new Date(startedAt).toISOString(),
    wallClockMs,
    exitCode,
    acceptance: cliSummary.acceptanceStatus ?? null,
    acceptanceFailures: cliSummary.acceptanceFailures ?? [],
    tokens: cliSummary.tokenUsage ?? null,
    timing: cliSummary.timing ?? (typeof cliSummary.wallClockMs === "number"
      ? { wallClockMs: cliSummary.wallClockMs }
      : null),
    modelCalls: cliSummary.modelCalls ?? null,
    model: cliSummary.model ?? null,
    provider: cliSummary.provider ?? null,
    turns: cliSummary.turns ?? null,
    toolCalls: cliSummary.toolCalls ?? null,
    reviewTurns: cliSummary.reviewTurns ?? null,
    coverageInvestigationTurns: cliSummary.coverageInvestigationTurns ?? null,
    correctionRounds: cliSummary.correctionRounds ?? null,
    correctionTurns: cliSummary.correctionTurns ?? null,
    correctionConverged: cliSummary.correctionConverged ?? null,
    counts: {
      capabilities: cliSummary.capabilities ?? null,
      userFlows: cliSummary.userFlows ?? null,
      requirements: cliSummary.requirements ?? null,
      declaredClaims: cliSummary.declaredClaims ?? null,
      uncertainties: cliSummary.uncertainties ?? null,
      featureDossiers: cliSummary.featureDossiers ?? null,
    },
    coverage: {
      coveragePercent: cliSummary.coveragePercent ?? null,
      unexplainedMeaningfulNodes: cliSummary.unexplainedMeaningfulNodes ?? null,
      supportAccountedMeaningfulNodes: cliSummary.supportAccountedMeaningfulNodes ?? null,
      unaccountedMeaningfulNodes: cliSummary.unaccountedMeaningfulNodes ?? null,
    },
    artifacts: {
      graph: existsSync(graphPath) ? "graph.json" : null,
      contract: existsSync(contractPath) ? "contract.yaml" : null,
    },
    stderr: stderr.trim().length > 0 ? stderr.slice(0, 2000) : null,
  };

  writeFileSync(resolve(runDir, "metrics.json"), JSON.stringify(metrics, null, 2));

  console.log(`[bench] exit=${exitCode} acceptance=${metrics.acceptance} wallClock=${(wallClockMs / 1000).toFixed(1)}s`);
  const timing = metrics.timing as { modelCallMs?: number; overheadMs?: number } | null;
  if (timing !== null && typeof timing.modelCallMs === "number") {
    console.log(`[bench] time split: model=${(timing.modelCallMs / 1000).toFixed(1)}s overhead=${((timing.overheadMs ?? 0) / 1000).toFixed(1)}s`);
  }
  if (metrics.tokens !== null) {
    const t = metrics.tokens as { totalTokens?: number; promptTokens?: number; completionTokens?: number; requests?: number };
    console.log(`[bench] tokens total=${t.totalTokens} prompt=${t.promptTokens} completion=${t.completionTokens} requests=${t.requests}`);
  }
  console.log(`[bench] metrics.json written to ${runDir}`);

  // Stage 2: score the contract inline so one command runs the full pipeline.
  // The score is written to score.json next to metrics.json and printed.
  if (existsSync(contractPath)) {
    try {
      const contract = parseYaml(
        readFileSync(contractPath, "utf8"),
      ) as SoftwareContract;
      const score = scoreContract(contract);
      writeFileSync(
        resolve(runDir, "score.json"),
        JSON.stringify(score, null, 2),
      );
      console.log("");
      console.log(`[score] FUNCTIONALITY ${score.score}/100 (${score.grade})`);
      console.log(
        `[score] coverage ${Math.round(score.subscores.coverage * 100)}% verification ${Math.round(score.subscores.verification * 100)}% certainty ${Math.round(score.subscores.certainty * 100)}% trust ${Math.round(score.subscores.trust * 100)}%`,
      );
      const topDeductions = score.deductions.filter((d) => d.points > 0).slice(0, 5);
      for (const d of topDeductions) {
        console.log(`[score]   -${d.points}  ${d.detail}`);
      }
      if (score.suggestions.length > 0) {
        console.log(`[score] top fix: +${score.suggestions[0].pointsRecovered}  ${score.suggestions[0].action}`);
      }
      console.log(`[score] score.json written to ${runDir}`);
    } catch (error) {
      console.log(`[score] could not score contract: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.log("[score] no contract.yaml produced; skipping score");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
