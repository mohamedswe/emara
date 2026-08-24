import type {
  ParsedEntryPoint,
  ParsedSourceFile,
  ParsedSymbol,
} from "../parser/types.js";
import type { ScannedFile } from "../scanner/types.js";
import { isTestFilePath } from "../scanner/classifyFilePath.ts";
import type {
  Edge,
  EntryPointNode,
  FileNode,
  RepositoryGraph,
  RepositoryGraphAnalysis,
  SymbolNode,
} from "./types.js";
import { buildEvidenceGraph } from "./buildEvidenceGraph.ts";
import { resolveCrossFileCallEdges } from "./resolveCrossFileCalls.ts";
import {
  resolveInternalImportEdges,
  type InternalModuleResolutionOptions,
} from "./resolveInternalImports.ts";
import { resolveSymbolReferenceEdges } from "./resolveSymbolReferences.ts";

export interface BuildRepositoryGraphOptions
  extends InternalModuleResolutionOptions {
  analysis?: RepositoryGraphAnalysis;
}

export function buildRepositoryGraph(
  scannedFiles: readonly ScannedFile[],
  parsedFiles: readonly ParsedSourceFile[],
  options: BuildRepositoryGraphOptions = {},
): RepositoryGraph {
  const files = buildFileNodes(scannedFiles);
  const fileIdsByPath = new Map(files.map((file) => [file.path, file.id]));
  const symbols: SymbolNode[] = [];
  const entrypoints: EntryPointNode[] = [];
  const edges: Edge[] = [];
  const parsedPaths = new Set<string>();
  const symbolIds = new Set<string>();
  const entrypointIds = new Set<string>();

  for (const parsedFile of [...parsedFiles].sort(compareParsedFiles)) {
    if (parsedPaths.has(parsedFile.path)) {
      throw new Error(`Duplicate parsed file path: ${parsedFile.path}`);
    }

    parsedPaths.add(parsedFile.path);

    const fileId = fileIdsByPath.get(parsedFile.path);
    if (fileId === undefined) {
      throw new Error(`Parsed file was not present in the scan: ${parsedFile.path}`);
    }

    if (parsedFile.diagnostics.length > 0) {
      throw new Error(
        `Cannot construct a graph from a file with parse diagnostics: ${parsedFile.path}`,
      );
    }

    for (const parsedSymbol of [...parsedFile.symbols].sort(compareParsedSymbols)) {
      const symbol = createSymbolNode(
        parsedFile.path,
        fileId,
        parsedSymbol,
        symbolIds,
      );

      symbolIds.add(symbol.id);
      symbols.push(symbol);
      edges.push({
        source: fileId,
        target: symbol.id,
        type: "CONTAINS",
        evidence: {
          file: parsedFile.path,
          line: symbol.lineRange.start,
          extractor: "tree-sitter",
        },
      });
    }

    const fileSymbols = symbols.filter((symbol) => symbol.fileId === fileId);
    const runtimeEntryPoints = isTestFilePath(parsedFile.path)
      ? []
      : parsedFile.entrypoints;
    for (const parsedEntryPoint of [...runtimeEntryPoints].sort(
      compareParsedEntryPoints,
    )) {
      const entrypoint = createEntryPointNode(
        parsedFile.path,
        fileId,
        fileSymbols,
        parsedEntryPoint,
      );

      if (entrypointIds.has(entrypoint.id)) {
        throw new Error(`Duplicate entrypoint ID: ${entrypoint.id}`);
      }

      entrypointIds.add(entrypoint.id);
      entrypoints.push(entrypoint);
      edges.push({
        source: fileId,
        target: entrypoint.id,
        type: "CONTAINS",
        evidence: { ...entrypoint.evidence },
      });
    }
  }

  edges.push(...resolveInternalImportEdges(files, parsedFiles, options));
  edges.push(...resolveCrossFileCallEdges(files, symbols, parsedFiles, options));
  edges.push(...resolveSymbolReferenceEdges(files, symbols, parsedFiles, options));
  const evidenceGraph = buildEvidenceGraph(
    files,
    symbols,
    entrypoints,
    parsedFiles,
    edges,
  );
  edges.push(...evidenceGraph.edges);

  return {
    version: 4,
    analysis: options.analysis ?? {
      sourceFileCount: parsedFiles.length,
      parsedSourceFileCount: parsedFiles.length,
      unparsedSourceFiles: [],
      diagnostics: [],
    },
    files,
    symbols,
    entrypoints,
    entities: evidenceGraph.entities,
    edges,
  };
}

function buildFileNodes(scannedFiles: readonly ScannedFile[]): FileNode[] {
  const files: FileNode[] = [];
  const paths = new Set<string>();

  for (const scannedFile of [...scannedFiles].sort(compareScannedFiles)) {
    if (paths.has(scannedFile.path)) {
      throw new Error(`Duplicate scanned file path: ${scannedFile.path}`);
    }

    paths.add(scannedFile.path);
    files.push({
      id: fileId(scannedFile.path),
      type: "file",
      path: scannedFile.path,
      language: scannedFile.language,
      contentHash: scannedFile.contentHash,
      ...(scannedFile.lineCount === undefined
        ? {}
        : {
            lineRange: {
              start: 1,
              end: scannedFile.lineCount,
            },
          }),
    });
  }

  return files;
}

function createSymbolNode(
  path: string,
  fileIdValue: string,
  parsedSymbol: ParsedSymbol,
  existingIds: ReadonlySet<string>,
): SymbolNode {
  const baseId = `${parsedSymbol.type}:${path}:${parsedSymbol.name}`;
  return {
    id: disambiguatedSourceNodeId(
      baseId,
      parsedSymbol.lineRange.start,
      parsedSymbol.lineRange.end,
      existingIds,
    ),
    type: parsedSymbol.type,
    name: parsedSymbol.name,
    fileId: fileIdValue,
    lineRange: {
      start: parsedSymbol.lineRange.start,
      end: parsedSymbol.lineRange.end,
    },
    exported: parsedSymbol.exported,
  };
}

function disambiguatedSourceNodeId(
  baseId: string,
  startLine: number,
  endLine: number,
  existingIds: ReadonlySet<string>,
): string {
  if (!existingIds.has(baseId)) return baseId;
  const lineId = `${baseId}:line:${startLine}`;
  if (!existingIds.has(lineId)) return lineId;
  const rangeId = `${lineId}-${endLine}`;
  if (!existingIds.has(rangeId)) return rangeId;
  throw new Error(
    `Duplicate symbol at the same source range: ${rangeId}`,
  );
}

function createEntryPointNode(
  path: string,
  fileIdValue: string,
  fileSymbols: readonly SymbolNode[],
  parsedEntryPoint: ParsedEntryPoint,
): EntryPointNode {
  const handlerSymbol =
    parsedEntryPoint.handlerName === undefined
      ? undefined
      : uniqueFunctionSymbol(fileSymbols, parsedEntryPoint.handlerName);

  return {
    id: `entrypoint:${parsedEntryPoint.kind}:${path}:${parsedEntryPoint.lineRange.start}:${parsedEntryPoint.name}`,
    type: "entrypoint",
    kind: parsedEntryPoint.kind,
    name: parsedEntryPoint.name,
    exposure:
      parsedEntryPoint.exposure ??
      (parsedEntryPoint.kind === "startup" ? "startup" : "external"),
    ...(parsedEntryPoint.httpMethod === undefined
      ? {}
      : { httpMethod: parsedEntryPoint.httpMethod }),
    ...(parsedEntryPoint.route === undefined
      ? {}
      : { route: parsedEntryPoint.route }),
    fileId: fileIdValue,
    ...(handlerSymbol === undefined
      ? {}
      : { handlerSymbolId: handlerSymbol.id }),
    lineRange: {
      start: parsedEntryPoint.lineRange.start,
      end: parsedEntryPoint.lineRange.end,
    },
    evidence: {
      file: path,
      line: parsedEntryPoint.lineRange.start,
      extractor: "tree-sitter",
    },
  };
}

function uniqueFunctionSymbol(
  symbols: readonly SymbolNode[],
  name: string,
): SymbolNode | undefined {
  const matches = symbols.filter(
    (symbol) => symbol.type === "function" && symbol.name === name,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function fileId(path: string): string {
  return `file:${path}`;
}

function compareScannedFiles(left: ScannedFile, right: ScannedFile): number {
  return compareStrings(left.path, right.path);
}

function compareParsedFiles(
  left: ParsedSourceFile,
  right: ParsedSourceFile,
): number {
  return compareStrings(left.path, right.path);
}

function compareParsedSymbols(left: ParsedSymbol, right: ParsedSymbol): number {
  return (
    left.lineRange.start - right.lineRange.start ||
    left.lineRange.end - right.lineRange.end ||
    compareStrings(left.type, right.type) ||
    compareStrings(left.name, right.name)
  );
}

function compareParsedEntryPoints(
  left: ParsedEntryPoint,
  right: ParsedEntryPoint,
): number {
  return (
    left.lineRange.start - right.lineRange.start ||
    left.lineRange.end - right.lineRange.end ||
    compareStrings(left.kind, right.kind) ||
    compareStrings(left.name, right.name) ||
    compareStrings(left.handlerName ?? "", right.handlerName ?? "")
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
