import { spawn } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import type { DeadCodeCandidate } from "../audit/types.js";
import { clusterRepositoryFeatures } from "../features/clusterRepositoryFeatures.ts";
import { indexRepository } from "../graph/indexRepository.ts";
import type { RepositoryGraph } from "../graph/types.js";
import { buildReachabilityLedger } from "../retrieval/reachabilityLedger.ts";

const EXCLUDED_COPY_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "venv",
]);
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const MAX_COMMAND_OUTPUT_CHARACTERS = 4_000;

export interface DeadCodeValidationCommand {
  command: string;
  args?: string[];
  cwd?: string;
  label?: string;
  timeoutMs?: number;
}

export interface DeadCodeValidationResult {
  candidate: DeadCodeCandidate;
  commandResults: Array<{
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

/**
 * Validates one candidate in a disposable repository copy. The source
 * repository is never edited. Installed dependencies and generated output are
 * deliberately excluded; callers must supply commands that are meaningful in
 * that clean validation environment.
 */
export async function validateDeadCodeCandidate(
  graph: RepositoryGraph,
  repositoryPath: string,
  candidate: DeadCodeCandidate,
  commands: readonly DeadCodeValidationCommand[],
): Promise<DeadCodeValidationResult> {
  if (commands.length === 0) {
    throw new Error("At least one validation command is required");
  }
  const repositoryRoot = await realpath(resolve(repositoryPath));
  const graphFile = graph.files.find((file) => file.path === candidate.file);
  if (graphFile === undefined) {
    throw new Error(`Candidate file is absent from the graph: ${candidate.file}`);
  }
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "auditor-delete-validation-"),
  );
  const isolatedRepository = join(temporaryRoot, "repository");
  const baselineFingerprint = featureFingerprint(graph);
  try {
    await cp(repositoryRoot, isolatedRepository, {
      recursive: true,
      filter: (source) => copyAllowed(repositoryRoot, source),
    });
    if (candidate.id.startsWith("dead-import:")) {
      await removePythonImportBinding(
        isolatedRepository,
        candidate.file,
        candidate.symbol,
      );
    } else {
      assertWholeFileDeletionAllowed(graph, graphFile.id);
      await rm(resolveInside(isolatedRepository, candidate.file));
    }

    const commandResults = [];
    for (const command of commands) {
      commandResults.push(await runValidationCommand(isolatedRepository, command));
    }
    const commandsPassed = commandResults.every((result) => result.exitCode === 0);
    const { graph: mutatedGraph } = await indexRepository(isolatedRepository, {
      outputPath: join(temporaryRoot, "mutated-graph.json"),
    });
    const featureFingerprintUnchanged =
      featureFingerprint(mutatedGraph) === baselineFingerprint;
    const passed = commandsPassed && featureFingerprintUnchanged;
    const commandLabels = commands.map(commandLabel);
    return {
      candidate: {
        ...candidate,
        verdict: passed
          ? "VALIDATED_SAFE_TO_DELETE"
          : "VALIDATION_REQUIRED",
        validation: {
          passed,
          commands: commandLabels,
          featureFingerprintUnchanged,
        },
        blockers: passed
          ? []
          : [
              ...candidate.blockers,
              ...(commandsPassed ? [] : ["One or more isolated validation commands failed."]),
              ...(featureFingerprintUnchanged
                ? []
                : ["The deterministic feature-cluster fingerprint changed after removal."]),
            ],
      },
      commandResults,
    };
  } finally {
    await removeVerifiedTemporaryRoot(temporaryRoot);
  }
}

function assertWholeFileDeletionAllowed(
  graph: RepositoryGraph,
  fileId: string,
): void {
  const ledger = buildReachabilityLedger(graph);
  const fileStatus = ledger.entries.find((entry) => entry.nodeId === fileId)?.status;
  if (fileStatus !== "disconnected_candidate") {
    throw new Error(
      `Whole-file validation requires disconnected_candidate reachability; received ${fileStatus ?? "missing"}`,
    );
  }
  const ownedIds = new Set([
    ...graph.symbols.filter((node) => node.fileId === fileId).map((node) => node.id),
    ...graph.entrypoints.filter((node) => node.fileId === fileId).map((node) => node.id),
    ...graph.entities.filter((node) => node.fileId === fileId).map((node) => node.id),
  ]);
  const unsafe = ledger.entries.find(
    (entry) =>
      ownedIds.has(entry.nodeId) &&
      entry.status !== "disconnected_candidate",
  );
  if (unsafe !== undefined) {
    throw new Error(
      `Whole-file validation is blocked by ${unsafe.status} node ${unsafe.nodeId}`,
    );
  }
}

async function removePythonImportBinding(
  repositoryRoot: string,
  filePath: string,
  binding: string,
): Promise<void> {
  if (extname(filePath).toLowerCase() !== ".py") {
    throw new Error("Isolated import removal currently supports Python files only");
  }
  const path = resolveInside(repositoryRoot, filePath);
  const source = await readFile(path, "utf8");
  const lines = source.split(/\r?\n/u);
  const matches: Array<{ index: number; replacement: string }> = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(
      /^(?<prefix>\s*(?:from\s+\S+\s+import|import)\s+)(?<bindings>[^#()]+?)(?<comment>\s*#.*)?$/u,
    );
    if (match?.groups === undefined) continue;
    const parts = (match.groups.bindings ?? "").split(",").map((part) => part.trim());
    const retained = parts.filter((part) => importLocalName(part) !== binding);
    if (retained.length === parts.length) continue;
    const replacement = retained.length === 0
      ? ""
      : `${match.groups.prefix ?? ""}${retained.join(", ")}${match.groups.comment ?? ""}`;
    matches.push({ index, replacement });
  }
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one simple Python import for ${JSON.stringify(binding)}; found ${matches.length}`,
    );
  }
  const match = matches[0];
  if (match === undefined) throw new Error("Import match disappeared");
  lines[match.index] = match.replacement;
  await writeFile(path, lines.join(source.includes("\r\n") ? "\r\n" : "\n"), "utf8");
}

function importLocalName(binding: string): string {
  const alias = binding.match(/\s+as\s+(?<alias>[A-Za-z_][A-Za-z0-9_]*)$/u)
    ?.groups?.alias;
  if (alias !== undefined) return alias;
  return binding.split(".").at(-1)?.trim() ?? binding.trim();
}

function featureFingerprint(graph: RepositoryGraph): string {
  const clustering = clusterRepositoryFeatures(graph);
  return JSON.stringify({
    entrypoints: graph.entrypoints.map((entrypoint) => entrypoint.id).sort(compareText),
    clusters: clustering.clusters.map((cluster) => ({
      id: cluster.id,
      seedEntrypointIds: [...cluster.seedEntrypointIds],
      members: cluster.members.map((member) => ({
        nodeId: member.nodeId,
        role: member.role,
      })),
    })),
    sharedSubsystems: clustering.sharedSubsystems.map((subsystem) => ({
      id: subsystem.id,
      featureClusterIds: [...subsystem.featureClusterIds],
      memberNodeIds: [...subsystem.memberNodeIds],
    })),
  });
}

async function runValidationCommand(
  repositoryRoot: string,
  specification: DeadCodeValidationCommand,
): Promise<DeadCodeValidationResult["commandResults"][number]> {
  if (specification.command.trim().length === 0) {
    throw new Error("Validation command must not be empty");
  }
  const cwd = specification.cwd === undefined
    ? repositoryRoot
    : resolveInside(repositoryRoot, specification.cwd);
  const timeoutMs = specification.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Validation command timeoutMs must be a positive safe integer");
  }
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(specification.command, specification.args ?? [], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = boundedOutput(stdout, String(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderr = boundedOutput(stderr, String(chunk));
    });
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolvePromise({
        command: commandLabel(specification),
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function copyAllowed(repositoryRoot: string, source: string): boolean {
  const relativePath = relative(repositoryRoot, source);
  if (relativePath.length === 0) return true;
  return !relativePath.split(sep).some((segment) =>
    EXCLUDED_COPY_DIRECTORIES.has(segment)
  );
}

function resolveInside(root: string, relativePath: string): string {
  const target = resolve(root, relativePath);
  const relativeTarget = relative(root, target);
  if (
    relativeTarget.length === 0 ||
    isAbsolute(relativeTarget) ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`)
  ) {
    throw new Error(`Path escapes isolated repository: ${relativePath}`);
  }
  return target;
}

async function removeVerifiedTemporaryRoot(path: string): Promise<void> {
  const resolvedTemporaryDirectory = resolve(tmpdir());
  const resolvedPath = resolve(path);
  const relativePath = relative(resolvedTemporaryDirectory, resolvedPath);
  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    !basename(resolvedPath).startsWith("auditor-delete-validation-")
  ) {
    throw new Error(`Refusing to remove unverified temporary path: ${resolvedPath}`);
  }
  await rm(resolvedPath, { recursive: true, force: true });
}

function commandLabel(command: DeadCodeValidationCommand): string {
  return command.label ?? [command.command, ...(command.args ?? [])].join(" ");
}

function boundedOutput(current: string, addition: string): string {
  return `${current}${addition}`.slice(-MAX_COMMAND_OUTPUT_CHARACTERS);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
