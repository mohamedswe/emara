import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type {
  EntryPointNode,
  EvidenceGraphNode,
  FileNode,
  RepositoryGraph,
  SymbolNode,
} from "../graph/types.js";
import { validateRepositoryGraph } from "../graph/validateRepositoryGraph.ts";
import type {
  GetSourceOptions,
  SourceSlice,
  SourceSliceLimits,
} from "./types.js";

const DEFAULT_LIMITS: SourceSliceLimits = {
  maxLines: 200,
  maxBytes: 65_536,
};

type SourceBearingFileNode = FileNode & {
  lineRange: { start: number; end: number };
};
type SourceBearingNode =
  | SymbolNode
  | EntryPointNode
  | EvidenceGraphNode
  | SourceBearingFileNode;

export async function getSource(
  graph: RepositoryGraph,
  repositoryPath: string,
  nodeId: string,
  options: GetSourceOptions = {},
): Promise<SourceSlice> {
  if (repositoryPath.length === 0) {
    throw new Error("Repository path must not be empty");
  }
  if (nodeId.length === 0) {
    throw new Error("Source node ID must not be empty");
  }

  const limits = resolveLimits(options);
  validateRepositoryGraph(graph);

  const node = findSourceBearingNode(graph, nodeId);
  const file = node.type === "file"
    ? node
    : graph.files.find((candidate) => candidate.id === node.fileId);
  if (file === undefined) {
    throw new Error(
      `Source node ${JSON.stringify(nodeId)} references missing file ${JSON.stringify(node.type === "file" ? node.id : node.fileId)}`,
    );
  }

  const lineCount = node.lineRange.end - node.lineRange.start + 1;
  if (lineCount > limits.maxLines) {
    throw new Error(
      `Source slice for ${JSON.stringify(nodeId)} spans ${lineCount} lines, exceeding maxLines ${limits.maxLines}`,
    );
  }

  const repositoryRoot = await resolveRepositoryRoot(repositoryPath);
  const sourcePath = await resolveSourcePath(repositoryRoot, file);
  const sourceBytes = await readFile(sourcePath);
  const actualHash = createHash("sha256").update(sourceBytes).digest("hex");
  if (actualHash !== file.contentHash) {
    throw new Error(
      `Source file ${JSON.stringify(file.path)} has changed since graph construction: expected SHA-256 ${file.contentHash}, received ${actualHash}`,
    );
  }

  const source = sourceBytes.toString("utf8");
  const content = sliceLines(source, node.lineRange.start, node.lineRange.end);
  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength > limits.maxBytes) {
    throw new Error(
      `Source slice for ${JSON.stringify(nodeId)} is ${byteLength} bytes, exceeding maxBytes ${limits.maxBytes}`,
    );
  }

  return {
    nodeId: node.id,
    fileId: file.id,
    path: file.path,
    language: file.language,
    lineRange: { ...node.lineRange },
    content,
    lineCount,
    byteLength,
    contentHash: actualHash,
    integrity: "verified",
    limits,
  };
}

function findSourceBearingNode(
  graph: RepositoryGraph,
  nodeId: string,
): SourceBearingNode {
  const node =
    graph.symbols.find((candidate) => candidate.id === nodeId) ??
    graph.entrypoints.find((candidate) => candidate.id === nodeId) ??
    graph.entities.find((candidate) => candidate.id === nodeId);
  if (node !== undefined) {
    return node;
  }

  const file = graph.files.find((candidate) => candidate.id === nodeId);
  if (file?.lineRange !== undefined) {
    return file as SourceBearingFileNode;
  }
  if (file !== undefined) {
    throw new Error(
      `File node ${JSON.stringify(nodeId)} has no indexed line range`,
    );
  }

  throw new Error(`Source node not found: ${JSON.stringify(nodeId)}`);
}

async function resolveRepositoryRoot(repositoryPath: string): Promise<string> {
  const requestedRoot = resolve(repositoryPath);
  let repositoryRoot: string;

  try {
    repositoryRoot = await realpath(requestedRoot);
  } catch (error) {
    throw new Error(`Unable to access repository path: ${requestedRoot}`, {
      cause: error,
    });
  }

  const rootStats = await stat(repositoryRoot);
  if (!rootStats.isDirectory()) {
    throw new Error(`Repository path is not a directory: ${requestedRoot}`);
  }

  return repositoryRoot;
}

async function resolveSourcePath(
  repositoryRoot: string,
  file: FileNode,
): Promise<string> {
  const requestedPath = resolve(repositoryRoot, file.path);
  if (!isPathInside(repositoryRoot, requestedPath)) {
    throw new Error(
      `Graph file path escapes repository root: ${JSON.stringify(file.path)}`,
    );
  }

  let sourcePath: string;
  try {
    sourcePath = await realpath(requestedPath);
  } catch (error) {
    throw new Error(`Unable to access indexed source file: ${file.path}`, {
      cause: error,
    });
  }

  if (!isPathInside(repositoryRoot, sourcePath)) {
    throw new Error(
      `Indexed source file resolves outside repository root: ${JSON.stringify(file.path)}`,
    );
  }

  const sourceStats = await stat(sourcePath);
  if (!sourceStats.isFile()) {
    throw new Error(`Indexed source path is not a file: ${file.path}`);
  }

  return sourcePath;
}

function isPathInside(repositoryRoot: string, candidatePath: string): boolean {
  const relativePath = relative(repositoryRoot, candidatePath);
  return (
    relativePath.length > 0 &&
    !isAbsolute(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`)
  );
}

function sliceLines(source: string, startLine: number, endLine: number): string {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  if (endLine > lineStarts.length) {
    throw new Error(
      `Indexed line range ${startLine}-${endLine} exceeds source length of ${lineStarts.length} lines`,
    );
  }

  const startOffset = lineStarts[startLine - 1];
  if (startOffset === undefined) {
    throw new Error(
      `Indexed line range ${startLine}-${endLine} does not start within the source file`,
    );
  }

  const nextLineOffset = lineStarts[endLine];
  let endOffset = nextLineOffset ?? source.length;
  if (nextLineOffset !== undefined && source[endOffset - 1] === "\n") {
    endOffset -= 1;
    if (source[endOffset - 1] === "\r") {
      endOffset -= 1;
    }
  }

  return source.slice(startOffset, endOffset);
}

function resolveLimits(options: GetSourceOptions): SourceSliceLimits {
  return {
    maxLines: positiveIntegerOption(
      options.maxLines,
      DEFAULT_LIMITS.maxLines,
      "maxLines",
    ),
    maxBytes: positiveIntegerOption(
      options.maxBytes,
      DEFAULT_LIMITS.maxBytes,
      "maxBytes",
    ),
  };
}

function positiveIntegerOption(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }

  return resolved;
}
