import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { indexRepository } from "../graph/indexRepository.ts";
import { readRepositoryGraph } from "../graph/persistRepositoryGraph.ts";
import type { RepositoryGraph } from "../graph/types.js";
import { scanRepository } from "../scanner/scanRepository.ts";
import { DeepSeekChatModel } from "./deepSeekChatModel.ts";
import type {
  ContractDiscoveryModel,
  ContractModelRequest,
  ContractModelResponse,
} from "./model.js";
import {
  assertContractAccepted,
  ContractAcceptanceError,
} from "./contractAcceptance.ts";
import { discoverContract } from "./discoverContract.ts";
import { writeSoftwareContract } from "./persistSoftwareContract.ts";
import type { SoftwareContract } from "./types.js";

interface CliOptions {
  repositoryPath: string;
  graphPath: string;
  outputPath: string;
  model: string;
  excludePaths: string[];
  reuseGraph: boolean;
  maxTurns?: number;
  maxReviewTurns?: number;
  maxCoverageInvestigationTurns?: number;
  maxCorrectionRounds?: number;
  maxCorrectionTurns?: number;
  maxCorrectionTargets?: number;
  maxOutputTokens?: number;
  keepFullToolOutputs?: number;
}

// The auditor has a single contract-discovery backend: DeepSeek.
const CONTRACT_PROVIDER = "deepseek" as const;

/** One model request's telemetry: how long it took and what it cost. */
export interface ModelCallTelemetry {
  durationMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

/**
 * Wraps a discovery model to record per-call wall-clock time and token usage.
 * One client instance flows through every phase (discovery, contradiction
 * review, coverage investigation, correction), so this single wrapper sees
 * every model request the audit makes.
 */
class TelemetryModel implements ContractDiscoveryModel {
  readonly provider: string;
  readonly calls: ModelCallTelemetry[] = [];
  readonly #inner: ContractDiscoveryModel;

  constructor(inner: ContractDiscoveryModel) {
    this.#inner = inner;
    this.provider = inner.provider;
  }

  async createResponse(
    request: ContractModelRequest,
  ): Promise<ContractModelResponse> {
    const started = Date.now();
    const response = await this.#inner.createResponse(request);
    this.calls.push({
      durationMs: Date.now() - started,
      promptTokens: response.usage?.promptTokens ?? null,
      completionTokens: response.usage?.completionTokens ?? null,
      totalTokens: response.usage?.totalTokens ?? null,
    });
    return response;
  }

  totals(): {
    requests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    modelCallMs: number;
  } {
    let prompt = 0;
    let completion = 0;
    let total = 0;
    let ms = 0;
    for (const call of this.calls) {
      prompt += call.promptTokens ?? 0;
      completion += call.completionTokens ?? 0;
      total += call.totalTokens ?? 0;
      ms += call.durationMs;
    }
    return {
      requests: this.calls.length,
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
      modelCallMs: ms,
    };
  }
}

export interface BuildContractOptions {
  graphPath?: string;
  reuseGraph?: boolean;
  outputPath?: string;
  model?: string;
  excludePaths?: readonly string[];
  maxTurns?: number;
  maxReviewTurns?: number;
  maxCoverageInvestigationTurns?: number;
  maxCorrectionRounds?: number;
  maxCorrectionTurns?: number;
  maxCorrectionTargets?: number;
  maxOutputTokens?: number;
  keepFullToolOutputs?: number;
}

export interface BuildContractResult {
  contract: SoftwareContract;
  outputPath: string;
  graphPath: string;
  graphReused: boolean;
  turns: number;
  toolCalls: number;
  reviewTurns: number;
  coverageInvestigationTurns: number;
  correctionRounds: number;
  correctionTurns: number;
  correctionConverged: boolean;
  modelRequests: number;
  acceptedForStaticAudit: boolean;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultEnvironmentPath = resolve(projectRoot, ".env");

export function loadContractEnvironment(
  environmentPath = defaultEnvironmentPath,
): string | null {
  const resolvedPath = resolve(environmentPath);
  if (!existsSync(resolvedPath)) return null;
  const environmentText = readFileSync(resolvedPath, "utf8");
  const rawDeepSeekKey = parseRawDeepSeekKey(environmentText);
  if (rawDeepSeekKey === null) {
    loadEnvFile(resolvedPath);
  } else if (!hasEnvironmentValue("DEEPSEEK_API_KEY")) {
    process.env.DEEPSEEK_API_KEY = rawDeepSeekKey;
  }
  return resolvedPath;
}

export async function buildContract(
  repositoryPath: string,
  modelClient: ContractDiscoveryModel,
  options: BuildContractOptions = {},
): Promise<BuildContractResult> {
  if (repositoryPath.length === 0) {
    throw new Error("Repository path must not be empty");
  }
  const repositoryRoot = resolve(repositoryPath);
  const graphOutputPath = resolveFromRepository(
    repositoryRoot,
    options.graphPath ?? "graph.json",
  );
  const contractOutputPath = resolveFromRepository(
    repositoryRoot,
    options.outputPath ?? "contract.yaml",
  );
  if (graphOutputPath === contractOutputPath) {
    throw new Error("Graph and contract output paths must be different");
  }

  const excludedPaths = [
    graphOutputPath,
    contractOutputPath,
    ...(options.excludePaths ?? []).map((path) =>
      resolveFromRepository(repositoryRoot, path)
    ),
  ];
  const graph = options.reuseGraph === true
    ? await loadReusableGraph(graphOutputPath, repositoryRoot, excludedPaths)
    : (await indexRepository(repositoryRoot, {
        outputPath: graphOutputPath,
        excludePaths: excludedPaths,
      })).graph;
  const discovery = await discoverContract(
    graph,
    repositoryRoot,
    modelClient,
    {
      model: options.model ?? defaultModel(),
      ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
      ...(options.maxReviewTurns === undefined
        ? {}
        : { maxReviewTurns: options.maxReviewTurns }),
      ...(options.maxCoverageInvestigationTurns === undefined
        ? {}
        : {
            maxCoverageInvestigationTurns:
              options.maxCoverageInvestigationTurns,
          }),
      ...(options.maxCorrectionRounds === undefined
        ? {}
        : { maxCorrectionRounds: options.maxCorrectionRounds }),
      ...(options.maxCorrectionTurns === undefined
        ? {}
        : { maxCorrectionTurns: options.maxCorrectionTurns }),
      ...(options.maxCorrectionTargets === undefined
        ? {}
        : { maxCorrectionTargets: options.maxCorrectionTargets }),
      ...(options.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: options.maxOutputTokens }),
      ...(options.keepFullToolOutputs === undefined
        ? {}
        : { keepFullToolOutputs: options.keepFullToolOutputs }),
    },
  );
  const writtenPath = await writeSoftwareContract(
    discovery.contract,
    graph,
    contractOutputPath,
  );

  return {
    contract: discovery.contract,
    outputPath: writtenPath,
    graphPath: graphOutputPath,
    graphReused: options.reuseGraph === true,
    turns: discovery.turns,
    toolCalls: discovery.toolCalls,
    reviewTurns: discovery.reviewTurns,
    coverageInvestigationTurns: discovery.coverageInvestigationTurns,
    correctionRounds: discovery.correctionRounds,
    correctionTurns: discovery.correctionTurns,
    correctionConverged: discovery.correctionConverged,
    modelRequests: discovery.modelRequests,
    acceptedForStaticAudit:
      discovery.contract.acceptance.status !== "INCOMPLETE",
  };
}

export async function runBuildContractCli(args: readonly string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: npm run build:contract -- [repository] [--graph graph.json] [--reuse-graph] [--output contract.yaml] [--model model-name] [--exclude path]... [--max-turns N] [--max-review-turns N] [--max-coverage-turns N] [--max-correction-rounds N] [--max-correction-turns N] [--max-correction-targets N] [--max-output-tokens N] [--keep-full-tool-outputs N]",
    );
    return;
  }

  const environmentPath = loadContractEnvironment();
  const options = parseArgs(args);
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error(
      `DEEPSEEK_API_KEY is required by the DeepSeek contract-discovery backend. Add it to ${environmentPath ?? defaultEnvironmentPath}. The key is never written to graph.json or contract.yaml.`,
    );
  }

  const modelClient = new TelemetryModel(createModelClient(apiKey));
  const startedAt = Date.now();
  const result = await buildContract(options.repositoryPath, modelClient, {
    graphPath: options.graphPath,
    reuseGraph: options.reuseGraph,
    outputPath: options.outputPath,
    model: options.model,
    excludePaths: options.excludePaths,
    ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
    ...(options.maxReviewTurns === undefined
      ? {}
      : { maxReviewTurns: options.maxReviewTurns }),
    ...(options.maxCoverageInvestigationTurns === undefined
      ? {}
      : {
          maxCoverageInvestigationTurns:
          options.maxCoverageInvestigationTurns,
        }),
    ...(options.maxCorrectionRounds === undefined
      ? {}
      : { maxCorrectionRounds: options.maxCorrectionRounds }),
    ...(options.maxCorrectionTurns === undefined
      ? {}
      : { maxCorrectionTurns: options.maxCorrectionTurns }),
    ...(options.maxCorrectionTargets === undefined
      ? {}
      : { maxCorrectionTargets: options.maxCorrectionTargets }),
    ...(options.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: options.maxOutputTokens }),
    ...(options.keepFullToolOutputs === undefined
      ? {}
      : { keepFullToolOutputs: options.keepFullToolOutputs }),
  });

  const wallClockMs = Date.now() - startedAt;
  const tokenUsage = modelClient.totals();
  // Time spent waiting on the model vs. everything else (graph build, tool
  // execution, coverage analysis, hydration). overheadMs is the non-model work.
  const timing = {
    wallClockMs,
    modelCallMs: tokenUsage.modelCallMs,
    overheadMs: wallClockMs - tokenUsage.modelCallMs,
  };

  console.log(
    JSON.stringify({
      outputPath: result.outputPath,
      graphPath: result.graphPath,
      graphReused: result.graphReused,
      provider: CONTRACT_PROVIDER,
      model: options.model,
      wallClockMs,
      timing,
      tokenUsage,
      modelCalls: modelClient.calls,
      turns: result.turns,
      toolCalls: result.toolCalls,
      capabilities: result.contract.capabilities.length,
      userFlows: result.contract.userFlows.length,
      requirements: result.contract.requirements.length,
      declaredClaims: result.contract.declaredClaims.length,
      uncertainties: result.contract.uncertainties.length,
      featureDossiers: result.contract.featureDossiers.length,
      coveragePercent: result.contract.coverageReview.coveragePercent,
      unexplainedMeaningfulNodes:
        result.contract.coverageReview.unexplainedMeaningfulNodes,
      supportAccountedMeaningfulNodes:
        result.contract.coverageReview.supportAccountedMeaningfulNodes,
      unaccountedMeaningfulNodes:
        result.contract.coverageReview.unaccountedMeaningfulNodes,
      reviewTurns: result.reviewTurns,
      coverageInvestigationTurns: result.coverageInvestigationTurns,
      correctionRounds: result.correctionRounds,
      correctionTurns: result.correctionTurns,
      correctionConverged: result.correctionConverged,
      acceptanceStatus: result.contract.acceptance.status,
      acceptanceFailures: result.contract.acceptance.failures,
      acceptedForStaticAudit: result.acceptedForStaticAudit,
      modelRequests: result.modelRequests,
    }),
  );

  // Keep the incomplete artifact for diagnosis, but fail the command so no
  // downstream audit can mistake it for an accepted source of truth.
  assertContractAccepted(result.contract, "static");
}

function parseArgs(args: readonly string[]): CliOptions {
  let repositoryPath = process.cwd();
  let graphPath = "graph.json";
  let outputPath = "contract.yaml";
  let requestedModel: string | null = null;
  const excludePaths: string[] = [];
  let reuseGraph = false;
  let maxTurns: number | undefined;
  let maxReviewTurns: number | undefined;
  let maxCoverageInvestigationTurns: number | undefined;
  let maxCorrectionRounds: number | undefined;
  let maxCorrectionTurns: number | undefined;
  let maxCorrectionTargets: number | undefined;
  let maxOutputTokens: number | undefined;
  let keepFullToolOutputs: number | undefined;
  let positionalSeen = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (argument === "--reuse-graph") {
      reuseGraph = true;
      continue;
    }
    if (
      argument === "--graph" ||
      argument === "--output" ||
      argument === "--model" ||
      argument === "--exclude" ||
      argument === "--max-turns" ||
      argument === "--max-review-turns" ||
      argument === "--max-coverage-turns" ||
      argument === "--max-correction-rounds" ||
      argument === "--max-correction-turns" ||
      argument === "--max-correction-targets" ||
      argument === "--max-output-tokens" ||
      argument === "--keep-full-tool-outputs"
    ) {
      const value = args[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      if (argument === "--graph") graphPath = value;
      if (argument === "--output") outputPath = value;
      if (argument === "--model") requestedModel = value;
      if (argument === "--exclude") excludePaths.push(value);
      if (argument === "--max-turns") {
        maxTurns = positiveIntegerOption(value, argument);
      }
      if (argument === "--max-review-turns") {
        maxReviewTurns = positiveIntegerOption(value, argument);
      }
      if (argument === "--max-coverage-turns") {
        maxCoverageInvestigationTurns = positiveIntegerOption(value, argument);
      }
      if (argument === "--max-correction-rounds") {
        maxCorrectionRounds = nonNegativeIntegerOption(value, argument);
      }
      if (argument === "--max-correction-turns") {
        maxCorrectionTurns = positiveIntegerOption(value, argument);
      }
      if (argument === "--max-correction-targets") {
        maxCorrectionTargets = nonNegativeIntegerOption(value, argument);
      }
      if (argument === "--max-output-tokens") {
        maxOutputTokens = positiveIntegerOption(value, argument);
      }
      if (argument === "--keep-full-tool-outputs") {
        keepFullToolOutputs = nonNegativeIntegerOption(value, argument);
      }
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (positionalSeen) {
      throw new Error(`Unexpected positional argument: ${argument}`);
    }
    repositoryPath = argument;
    positionalSeen = true;
  }
  const model = requestedModel ?? configuredModel();
  return {
    repositoryPath,
    graphPath,
    outputPath,
    model,
    excludePaths,
    reuseGraph,
    ...(maxTurns === undefined ? {} : { maxTurns }),
    ...(maxReviewTurns === undefined ? {} : { maxReviewTurns }),
    ...(maxCoverageInvestigationTurns === undefined
      ? {}
      : { maxCoverageInvestigationTurns }),
    ...(maxCorrectionRounds === undefined
      ? {}
      : { maxCorrectionRounds }),
    ...(maxCorrectionTurns === undefined ? {} : { maxCorrectionTurns }),
    ...(maxCorrectionTargets === undefined ? {} : { maxCorrectionTargets }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(keepFullToolOutputs === undefined ? {} : { keepFullToolOutputs }),
  };
}

function positiveIntegerOption(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${option} requires a positive safe integer`);
  }
  return parsed;
}

function nonNegativeIntegerOption(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${option} requires a non-negative safe integer`);
  }
  return parsed;
}

function createModelClient(apiKey: string): ContractDiscoveryModel {
  const baseUrl = process.env.DEEPSEEK_BASE_URL?.trim();
  return new DeepSeekChatModel({
    apiKey,
    ...(baseUrl === undefined || baseUrl.length === 0 ? {} : { baseUrl }),
  });
}

function configuredModel(): string {
  return process.env.DEEPSEEK_MODEL?.trim() || defaultModel();
}

function defaultModel(): string {
  return "deepseek-v4-flash";
}

function parseRawDeepSeekKey(environmentText: string): string | null {
  const meaningfulLines = environmentText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (meaningfulLines.length !== 1) return null;
  const value = meaningfulLines[0];
  return value !== undefined && /^sk-[A-Za-z0-9_-]+$/u.test(value)
    ? value
    : null;
}

function hasEnvironmentValue(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value.trim().length > 0;
}

function resolveFromRepository(repositoryRoot: string, path: string): string {
  if (path.length === 0) throw new Error("Output path must not be empty");
  return isAbsolute(path) ? resolve(path) : resolve(repositoryRoot, path);
}

async function loadReusableGraph(
  graphPath: string,
  repositoryRoot: string,
  excludedPaths: readonly string[],
): Promise<RepositoryGraph> {
  const graph = await readRepositoryGraph(graphPath);
  const excludedRelativePaths = new Set(
    excludedPaths
      .map((path) => relativePathInside(repositoryRoot, path))
      .filter((path): path is string => path !== null),
  );
  const scannedFiles = (await scanRepository(repositoryRoot)).filter(
    (file) => !excludedRelativePaths.has(file.path),
  );
  const graphFiles = new Map(graph.files.map((file) => [file.path, file]));
  const scannedPaths = new Set(scannedFiles.map((file) => file.path));
  const changed = scannedFiles.filter((file) => {
    const indexed = graphFiles.get(file.path);
    return indexed === undefined || indexed.contentHash !== file.contentHash;
  }).map((file) => file.path);
  const removed = graph.files
    .filter((file) => !scannedPaths.has(file.path))
    .map((file) => file.path);
  const stalePaths = [...new Set([...changed, ...removed])].sort();
  if (stalePaths.length > 0) {
    const preview = stalePaths.slice(0, 10).join(", ");
    const suffix = stalePaths.length > 10 ? ` and ${stalePaths.length - 10} more` : "";
    throw new Error(
      `Cannot reuse stale repository graph; changed, added, or removed files: ${preview}${suffix}. Re-run without --reuse-graph to rebuild it.`,
    );
  }
  return graph;
}

function relativePathInside(repositoryRoot: string, absolutePath: string): string | null {
  const relativePath = relative(repositoryRoot, absolutePath);
  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    return null;
  }
  return relativePath.split(sep).join("/");
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  resolve(entryPath) === resolve(fileURLToPath(import.meta.url))
) {
  runBuildContractCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof ContractAcceptanceError ? 2 : 1;
  });
}
