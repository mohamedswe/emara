import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadContractEnvironment } from "../contract/buildContract.ts";
import { DeepSeekChatModel } from "../contract/deepSeekChatModel.ts";
import { indexRepository } from "../graph/indexRepository.ts";
import {
  buildFunctionalityAudit,
  type SemanticPassRecord,
} from "./buildFunctionalityAudit.ts";
import {
  evaluateAuditAgainstOracle,
  type FunctionalityAuditOracle,
} from "./oracle.ts";
import { renderAuditReportFromJson } from "./renderAuditReport.ts";

export interface CliOptions {
  repositoryPath: string;
  outputPath: string;
  graphPath: string;
  expectedCommit?: string;
  oraclePath?: string;
  model: string;
  deterministic: boolean;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export async function runFunctionalityAuditCli(
  args: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const options = parseArguments([...args]);
  const pipelineStartedAtMs = Date.now();
  const commit = repositoryCommit(options.repositoryPath);
  if (
    options.expectedCommit !== undefined &&
    commit !== options.expectedCommit
  ) {
    throw new Error(
      `Repository commit ${commit} does not match expected commit ${options.expectedCommit}`,
    );
  }

  let model: DeepSeekChatModel | undefined;
  if (!options.deterministic) {
    loadContractEnvironment();
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error(
        "DEEPSEEK_API_KEY is required unless --deterministic is enabled.",
      );
    }
    const baseUrl = process.env.DEEPSEEK_BASE_URL?.trim();
    model = new DeepSeekChatModel({
      apiKey,
      ...(baseUrl === undefined || baseUrl.length === 0 ? {} : { baseUrl }),
    });
  }
  await mkdir(dirname(options.outputPath), { recursive: true });
  await mkdir(dirname(options.graphPath), { recursive: true });
  const outputDirectory = dirname(options.outputPath);
  const semanticPassesPath = resolve(outputDirectory, "semantic-passes.json");
  const reportPath = resolve(outputDirectory, "audit-report.md");
  const evaluationPath = resolve(outputDirectory, "oracle-evaluation.json");

  console.log(`[functionality] target=${options.repositoryPath}`);
  console.log(`[functionality] commit=${commit}`);
  console.log(
    `[functionality] mode=${options.deterministic ? "deterministic" : "deepseek-assisted"}`,
  );
  console.log("[functionality] indexing and clustering deterministically");
  const { graph, sourceFiles } = await indexRepository(options.repositoryPath, {
    outputPath: options.graphPath,
    excludePaths: [
      options.outputPath,
      semanticPassesPath,
      reportPath,
      evaluationPath,
    ],
  });
  console.log(
    `[functionality] graph files=${graph.files.length} symbols=${graph.symbols.length} entrypoints=${graph.entrypoints.length}`,
  );

  const semanticPasses: SemanticPassRecord[] = [];
  const audit = await buildFunctionalityAudit(
    graph,
    options.repositoryPath,
    model,
    {
      repositoryCommit: commit,
      deterministic: options.deterministic,
      model: options.model,
      cache: "cold",
      pipelineStartedAtMs,
      indexedSourceFiles: sourceFiles,
      onSemanticPasses: (passes) => {
        semanticPasses.push(...passes);
      },
    },
  );
  await writeJsonAtomically(options.outputPath, audit);
  await writeJsonAtomically(semanticPassesPath, {
    schema: "functionality-semantic-passes/v1",
    repositoryCommit: commit,
    passes: semanticPasses,
  });
  await writeTextAtomically(
    reportPath,
    await renderAuditReportFromJson(options.outputPath),
  );

  console.log(
    `[functionality] features=${audit.features.length} promises=${audit.documentationPromises.length} declaredClaims=${audit.declaredClaims.length} deadCandidates=${audit.deadCodeCandidates.length}`,
  );
  console.log(
    `[functionality] wallClock=${(audit.metrics.wallClockMs / 1_000).toFixed(1)}s deterministic=${(audit.metrics.deterministicWallClockMs / 1_000).toFixed(1)}s modelRequests=${audit.metrics.modelRequests} tokens=${audit.metrics.totalTokens}`,
  );
  console.log(`[functionality] audit=${options.outputPath}`);
  console.log(`[functionality] report=${reportPath}`);
  console.log(`[functionality] semanticPasses=${semanticPassesPath}`);

  if (options.oraclePath !== undefined) {
    const oracle = JSON.parse(
      await readFile(options.oraclePath, "utf8"),
    ) as FunctionalityAuditOracle;
    const evaluation = evaluateAuditAgainstOracle(audit, oracle);
    await writeJsonAtomically(evaluationPath, evaluation);
    console.log(
      `[functionality] oracle=${evaluation.passed ? "PASS" : "FAIL"} failures=${evaluation.failures.length}`,
    );
    for (const failure of evaluation.failures) console.log(`[functionality]   - ${failure}`);
    if (!evaluation.passed) process.exitCode = 2;
  }
}

export function parseArguments(args: string[]): CliOptions {
  const normalizedArgs = args.flatMap((argument) => {
    const match = argument.match(/^(--[^=]+)=(.*)$/u);
    return match === null ? [argument] : [match[1] ?? "", match[2] ?? ""];
  });
  const repositoryArg = normalizedArgs[0];
  if (repositoryArg === undefined || repositoryArg.startsWith("--")) {
    throw new Error(
      "Usage: auditor <repository> [--deterministic] [--output path] [--graph path] [--expected-commit sha] [--oracle path] [--model name]",
    );
  }
  const repositoryPath = resolve(repositoryArg);
  const outputDirectory = resolve(repositoryPath, "audit-output");
  let outputPath = resolve(outputDirectory, "functionality-audit.json");
  let graphPath = resolve(outputDirectory, "graph.json");
  let expectedCommit: string | undefined;
  let oraclePath: string | undefined;
  let model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
  let deterministic = false;

  for (let index = 1; index < normalizedArgs.length;) {
    const option = normalizedArgs[index];
    if (option === "--deterministic") {
      deterministic = true;
      index += 1;
      continue;
    }
    const value = normalizedArgs[index + 1];
    if (option === undefined || value === undefined) {
      throw new Error(`${option ?? "option"} requires a value`);
    }
    switch (option) {
      case "--output":
        outputPath = absolutePath(value);
        break;
      case "--graph":
        graphPath = absolutePath(value);
        break;
      case "--expected-commit":
        expectedCommit = value;
        break;
      case "--oracle":
        oraclePath = absolutePath(value);
        break;
      case "--model":
        model = value;
        break;
      default:
        throw new Error(`Unknown option: ${option}`);
    }
    index += 2;
  }
  if (outputPath === graphPath) throw new Error("Audit and graph paths must differ");
  if (model.trim().length === 0) throw new Error("Model must not be empty");
  return {
    repositoryPath,
    outputPath,
    graphPath,
    model,
    deterministic,
    ...(expectedCommit === undefined ? {} : { expectedCommit }),
    ...(oraclePath === undefined ? {} : { oraclePath }),
  };
}

function repositoryCommit(repositoryPath: string): string {
  return execFileSync(
    "git",
    [
      "-c",
      `safe.directory=${repositoryPath.replaceAll("\\", "/")}`,
      "-C",
      repositoryPath,
      "rev-parse",
      "HEAD",
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await writeTextAtomically(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextAtomically(path: string, value: string): Promise<void> {
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, value, "utf8");
  await rename(temporaryPath, path);
}

function absolutePath(value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(projectRoot, value);
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  resolve(entryPath) === fileURLToPath(import.meta.url)
) {
  runFunctionalityAuditCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
