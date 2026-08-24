import type {
  Edge,
  FileNode,
  RepositoryGraph,
  RepositoryNode,
  SymbolNode,
} from "../graph/types.js";
import { validateRepositoryGraph } from "../graph/validateRepositoryGraph.ts";

export type SymbolNavigationRelationship =
  | "DEFINITION"
  | "REFERENCE"
  | "CALLER"
  | "CALLEE"
  | "IMPORTER"
  | "CONSUMER";

export interface SymbolNavigationResult {
  nodeId: string;
  file: string;
  lineRange: { start: number; end: number };
  relationship: SymbolNavigationRelationship;
  confidence: number;
}

export interface SymbolNavigationResponse {
  query: string;
  ambiguous: boolean;
  candidates: SymbolNavigationResult[];
  results: SymbolNavigationResult[];
  total: number;
  truncated: boolean;
}

const MAX_RESULTS = 100;

export function findDefinition(
  graph: RepositoryGraph,
  symbol: string,
): SymbolNavigationResponse {
  return navigate(graph, symbol, "DEFINITION");
}

export function findReferences(
  graph: RepositoryGraph,
  symbol: string,
): SymbolNavigationResponse {
  return navigate(graph, symbol, "REFERENCE");
}

export function findCallers(
  graph: RepositoryGraph,
  symbol: string,
): SymbolNavigationResponse {
  return navigate(graph, symbol, "CALLER");
}

export function findCallees(
  graph: RepositoryGraph,
  symbol: string,
): SymbolNavigationResponse {
  return navigate(graph, symbol, "CALLEE");
}

export function findImporters(
  graph: RepositoryGraph,
  symbol: string,
): SymbolNavigationResponse {
  return navigate(graph, symbol, "IMPORTER");
}

export function findConsumers(
  graph: RepositoryGraph,
  symbol: string,
): SymbolNavigationResponse {
  return navigate(graph, symbol, "CONSUMER");
}

function navigate(
  graph: RepositoryGraph,
  rawSymbol: string,
  relationship: SymbolNavigationRelationship,
): SymbolNavigationResponse {
  validateRepositoryGraph(graph);
  const query = rawSymbol.trim();
  if (query.length === 0) throw new Error("Symbol must not be empty");

  const filesById = new Map(graph.files.map((file) => [file.id, file]));
  const nodes = [
    ...graph.files,
    ...graph.symbols,
    ...graph.entrypoints,
    ...graph.entities,
  ];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const definitions = definitionCandidates(graph.symbols, query, filesById);
  const definitionIds = new Set(definitions.map((candidate) => candidate.nodeId));
  const ambiguous = definitions.length > 1;

  let results: SymbolNavigationResult[];
  switch (relationship) {
    case "DEFINITION":
      results = definitions;
      break;
    case "CALLER":
      results = edgeResults(
        graph.edges.filter(
          (edge) => edge.type === "CALLS" && definitionIds.has(edge.target),
        ),
        "source",
        "CALLER",
        nodesById,
      );
      break;
    case "CALLEE":
      results = edgeResults(
        graph.edges.filter(
          (edge) => edge.type === "CALLS" && definitionIds.has(edge.source),
        ),
        "target",
        "CALLEE",
        nodesById,
      );
      break;
    case "IMPORTER":
      results = edgeResults(
        graph.edges.filter(
          (edge) => edge.type === "REFERENCES" && definitionIds.has(edge.target),
        ),
        "source",
        "IMPORTER",
        nodesById,
      );
      break;
    case "REFERENCE":
    case "CONSUMER": {
      const edgeRelationship: SymbolNavigationRelationship =
        relationship === "REFERENCE" ? "REFERENCE" : "CONSUMER";
      results = edgeResults(
        graph.edges.filter(
          (edge) =>
            definitionIds.has(edge.target) &&
            (edge.type === "CALLS" || edge.type === "REFERENCES"),
        ),
        "source",
        edgeRelationship,
        nodesById,
      );
      results.push(
        ...graph.entrypoints
          .filter(
            (entrypoint) =>
              entrypoint.handlerSymbolId !== undefined &&
              definitionIds.has(entrypoint.handlerSymbolId),
          )
          .map((entrypoint) => ({
            nodeId: entrypoint.id,
            file: entrypoint.evidence.file,
            lineRange: { ...entrypoint.lineRange },
            relationship: edgeRelationship,
            confidence: 1,
          })),
      );
      results = deduplicateResults(results);
      break;
    }
  }

  results.sort(compareResults);
  return {
    query,
    ambiguous,
    candidates: definitions,
    results: results.slice(0, MAX_RESULTS),
    total: results.length,
    truncated: results.length > MAX_RESULTS,
  };
}

function definitionCandidates(
  symbols: readonly SymbolNode[],
  query: string,
  filesById: ReadonlyMap<string, FileNode>,
): SymbolNavigationResult[] {
  const exact = symbols.filter((symbol) => symbol.name === query);
  const unqualified =
    exact.length > 0
      ? exact
      : symbols.filter((symbol) => unqualifiedName(symbol.name) === query);
  const insensitive =
    unqualified.length > 0
      ? unqualified
      : symbols.filter(
          (symbol) =>
            symbol.name.toLocaleLowerCase("en-US") ===
              query.toLocaleLowerCase("en-US") ||
            unqualifiedName(symbol.name).toLocaleLowerCase("en-US") ===
              query.toLocaleLowerCase("en-US"),
        );

  return insensitive
    .flatMap((symbol) => {
      const file = filesById.get(symbol.fileId);
      if (file === undefined) return [];
      return [{
        nodeId: symbol.id,
        file: file.path,
        lineRange: { ...symbol.lineRange },
        relationship: "DEFINITION" as const,
        confidence:
          symbol.name === query
            ? 1
            : unqualifiedName(symbol.name) === query
              ? 0.95
              : 0.85,
      }];
    })
    .sort(compareResults);
}

function edgeResults(
  edges: readonly Edge[],
  endpoint: "source" | "target",
  relationship: SymbolNavigationRelationship,
  nodesById: ReadonlyMap<string, RepositoryNode>,
): SymbolNavigationResult[] {
  return deduplicateResults(
    edges.flatMap((edge) => {
      const nodeId = edge[endpoint];
      if (!nodesById.has(nodeId) || edge.evidence.line === undefined) return [];
      return [{
        nodeId,
        file: edge.evidence.file,
        lineRange: {
          start: edge.evidence.line,
          end: edge.evidence.line,
        },
        relationship,
        confidence: 1,
      }];
    }),
  );
}

function deduplicateResults(
  results: readonly SymbolNavigationResult[],
): SymbolNavigationResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = [
      result.nodeId,
      result.file,
      result.lineRange.start,
      result.lineRange.end,
      result.relationship,
    ].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unqualifiedName(name: string): string {
  const separator = name.lastIndexOf(".");
  return separator === -1 ? name : name.slice(separator + 1);
}

function compareResults(
  left: SymbolNavigationResult,
  right: SymbolNavigationResult,
): number {
  return (
    right.confidence - left.confidence ||
    compareText(left.file, right.file) ||
    left.lineRange.start - right.lineRange.start ||
    left.lineRange.end - right.lineRange.end ||
    compareText(left.nodeId, right.nodeId)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
