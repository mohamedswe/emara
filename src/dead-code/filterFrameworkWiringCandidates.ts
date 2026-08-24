import Parser from "tree-sitter";
import Python from "tree-sitter-python";

import type { DeadCodeCandidate } from "../audit/types.js";
import type { RepositoryGraph, SymbolNode } from "../graph/types.js";
import { getSource } from "../retrieval/getSource.ts";

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const PARSER_INPUT_CHUNK_SIZE = 16_384;

/**
 * Removes candidates with mechanically visible framework/module liveness.
 *
 * Generic decorator calls are registration points in Python frameworks. Their
 * handlers, symbols used by their decorator/signature expressions, and
 * resolved callees reachable from those handlers are therefore alive. A
 * top-level same-file read/call is also executable module wiring and keeps the
 * referenced function alive.
 */
export async function filterFrameworkWiringCandidates(
  candidates: readonly DeadCodeCandidate[],
  graph: RepositoryGraph,
  repositoryPath: string,
): Promise<DeadCodeCandidate[]> {
  const candidateNodeIds = new Set(candidates.flatMap((candidate) => candidate.nodeIds));
  const candidateFunctions = graph.symbols.filter(
    (symbol) => symbol.type === "function" && candidateNodeIds.has(symbol.id),
  );
  if (candidateFunctions.length === 0) return [...candidates];

  const filesById = new Map(graph.files.map((file) => [file.id, file]));
  const symbolsById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));
  const candidatesByFileId = groupByFile(candidateFunctions);
  const relevantFileIds = new Set([
    ...candidatesByFileId.keys(),
    ...graph.entrypoints.map((entrypoint) => entrypoint.fileId),
  ]);
  const fileReferenceTargets = new Map<string, SymbolNode[]>();
  for (const edge of graph.edges) {
    if (edge.type !== "REFERENCES" || !relevantFileIds.has(edge.source)) continue;
    const symbol = symbolsById.get(edge.target);
    if (symbol === undefined) continue;
    const values = fileReferenceTargets.get(edge.source) ?? [];
    values.push(symbol);
    fileReferenceTargets.set(edge.source, values);
  }
  const alive = new Set(
    graph.entrypoints.flatMap((entrypoint) =>
      entrypoint.handlerSymbolId === undefined ? [] : [entrypoint.handlerSymbolId]
    ),
  );

  for (const fileId of [...relevantFileIds].sort(compareText)) {
    const fileCandidates = candidatesByFileId.get(fileId) ?? [];
    const file = filesById.get(fileId);
    if (file === undefined || file.language !== "python" || file.lineRange === undefined) {
      continue;
    }
    const slice = await getSource(graph, repositoryPath, file.id, {
      maxLines: file.lineRange.end,
      maxBytes: MAX_SOURCE_BYTES,
    });
    const root = parsePython(sanitizeForTreeSitter(slice.content));
    seedPythonFrameworkLiveness(
      root,
      fileId,
      fileCandidates,
      fileReferenceTargets.get(fileId) ?? [],
      alive,
    );
  }

  propagateResolvedLiveness(graph, alive);
  return candidates.filter((candidate) =>
    !candidate.nodeIds.some((nodeId) => alive.has(nodeId))
  );
}

function seedPythonFrameworkLiveness(
  root: Parser.SyntaxNode,
  fileId: string,
  candidates: readonly SymbolNode[],
  fileReferenceTargets: readonly SymbolNode[],
  alive: Set<string>,
): void {
  const candidatesByName = new Map(candidates.map((candidate) => [candidate.name, candidate]));

  for (const statement of root.namedChildren) {
    const definition = pythonDefinition(statement);
    if (definition?.type === "function_definition") {
      const name = definition.childForFieldName("name")?.text;
      const candidate = name === undefined ? undefined : candidatesByName.get(name);
      const decorators = statement.type === "decorated_definition"
        ? statement.namedChildren.filter((node) => node.type === "decorator")
        : [];
      const registered = decorators.some((decorator) =>
        decorator.descendantsOfType("call").length > 0
      );
      if (registered && candidate !== undefined) alive.add(candidate.id);

      for (const decorator of decorators) {
        seedExpressionReferences(
          decorator,
          fileId,
          candidatesByName,
          fileReferenceTargets,
          alive,
        );
      }
      if (registered) {
        const parameters = definition.childForFieldName("parameters");
        if (parameters !== null) {
          seedExpressionReferences(
            parameters,
            fileId,
            candidatesByName,
            fileReferenceTargets,
            alive,
          );
        }
      }
      continue;
    }
    if (definition !== undefined) continue;

    // Function/class definitions are declarations. Every other top-level
    // statement executes while the module is imported, including assignments,
    // conditionals, and registry construction.
    for (const identifier of statement.descendantsOfType("identifier")) {
      const candidate = candidatesByName.get(identifier.text);
      if (candidate !== undefined) alive.add(candidate.id);
    }
  }
}

function seedExpressionReferences(
  expression: Parser.SyntaxNode,
  fileId: string,
  localCandidates: ReadonlyMap<string, SymbolNode>,
  importedTargets: readonly SymbolNode[],
  alive: Set<string>,
): void {
  for (const identifier of expression.descendantsOfType("identifier")) {
    const local = localCandidates.get(identifier.text);
    if (local !== undefined) alive.add(local.id);
    for (const target of importedTargets) {
      if (
        target.fileId !== fileId &&
        (target.name === identifier.text || target.name.endsWith(`.${identifier.text}`))
      ) {
        alive.add(target.id);
      }
    }
  }
}

function propagateResolvedLiveness(graph: RepositoryGraph, alive: Set<string>): void {
  const outgoing = new Map<string, string[]>();
  const symbolIds = new Set(graph.symbols.map((symbol) => symbol.id));
  for (const edge of graph.edges) {
    if (edge.type !== "CALLS" && edge.type !== "REFERENCES") continue;
    if (!symbolIds.has(edge.target)) continue;
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  }

  const pending = [...alive].sort(compareText);
  for (let index = 0; index < pending.length; index += 1) {
    const source = pending[index];
    if (source === undefined) continue;
    for (const target of [...(outgoing.get(source) ?? [])].sort(compareText)) {
      if (alive.has(target)) continue;
      alive.add(target);
      pending.push(target);
    }
  }
}

function pythonDefinition(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  if (node.type === "function_definition" || node.type === "class_definition") return node;
  if (node.type !== "decorated_definition") return undefined;
  return node.namedChildren.find((child) =>
    child.type === "function_definition" || child.type === "class_definition"
  );
}

function parsePython(source: string): Parser.SyntaxNode {
  const parser = new Parser();
  parser.setLanguage(Python);
  const tree = parser.parse((index) => source.slice(index, index + PARSER_INPUT_CHUNK_SIZE));
  return tree.rootNode;
}

function sanitizeForTreeSitter(source: string): string {
  return source.replace(/[^\u0000-\uFFFF]/gu, " ");
}

function groupByFile(symbols: readonly SymbolNode[]): Map<string, SymbolNode[]> {
  const grouped = new Map<string, SymbolNode[]>();
  for (const symbol of symbols) {
    const values = grouped.get(symbol.fileId) ?? [];
    values.push(symbol);
    grouped.set(symbol.fileId, values);
  }
  return grouped;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
