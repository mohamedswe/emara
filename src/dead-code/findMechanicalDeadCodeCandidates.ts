import Parser from "tree-sitter";
import Python from "tree-sitter-python";

import type { RepositoryGraph } from "../graph/types.js";
import type { IndexedSourceFile } from "../graph/indexedSourceFile.ts";
import { DEFAULT_FRAMEWORK_REGISTRY } from "../frameworks/registry.ts";
import {
  isSupportedSourceFile,
  parseWithLanguageFrontend,
} from "../languages/languageFrontends.ts";
import type { ParsedSourceFile } from "../parser/types.js";
import { getSource } from "../retrieval/getSource.ts";
import { isTestFilePath } from "../scanner/classifyFilePath.ts";
import type { ScannedFile } from "../scanner/types.js";
import type { DeadCodeCandidate } from "../audit/types.js";

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const SIMPLE_IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

interface ParsedSourceFact {
  fileId: string;
  path: string;
  content: string;
  parsed: ParsedSourceFile;
  candidateEligible: boolean;
  pythonUsage?: PythonUsageFacts;
}

interface PythonAssignmentFact {
  name: string;
  lineRange: { start: number; end: number };
  scopeKey: string;
  classBodyField: boolean;
}

interface PythonUsageFacts {
  assignments: PythonAssignmentFact[];
  keywordArgumentNamesByScope: Map<string, Set<string>>;
}

interface MechanicalFinding {
  category:
    | "assignment"
    | "exported-api-method"
    | "local-helper"
    | "module-export"
    | "type-alias";
  file: string;
  symbol: string;
  line: number;
  nodeIds: string[];
  reason: string;
}

/**
 * Finds mechanically provable no-reference declarations. Every result remains
 * fail-closed at VALIDATION_REQUIRED and must go through the existing isolated
 * deletion ladder before it can ever be called safe to delete.
 */
export async function findMechanicalDeadCodeCandidates(
  graph: RepositoryGraph,
  repositoryPath: string,
  indexedSourceFiles: readonly IndexedSourceFile[] = [],
): Promise<DeadCodeCandidate[]> {
  const sources = await readSourceFacts(
    graph,
    repositoryPath,
    indexedSourceFiles,
  );
  const attributeAccessNames = collectAttributeAccessNames(sources);
  const findings = [
    ...findUnusedLocalHelpers(sources, graph),
    ...findUnusedAssignments(sources, attributeAccessNames),
    ...findUnusedTypeAliases(sources, graph),
    ...findUnusedExportedApiMethods(sources),
    ...findNeverImportedModuleExports(sources, graph),
  ];
  const unique = new Map<string, DeadCodeCandidate>();
  for (const finding of findings) {
    const id = `dead-${finding.category}:${finding.file}:${finding.symbol}`;
    unique.set(id, {
      id,
      nodeIds: finding.nodeIds,
      file: finding.file,
      line: finding.line,
      symbol: finding.symbol,
      reachabilityStatus: "disconnected_candidate",
      verdict: "VALIDATION_REQUIRED",
      reason: finding.reason,
      blockers: [
        `Remove only ${finding.symbol} at ${finding.file}:${finding.line} in an isolated workspace, then run the repository's typecheck, build, and tests.`,
      ],
      validation: null,
    });
  }
  return [...unique.values()].sort(
    (left, right) =>
      compareText(left.file, right.file) || compareText(left.symbol, right.symbol),
  );
}

/**
 * Fail closed for an explicit .mjs export when its own module contains lexical
 * evidence for the same name outside the declaration/export ranges. The
 * evidence may be an indirect or member-based use, so this deliberately
 * withholds a deletion candidate instead of fabricating a binding graph edge.
 * Broadening this conservative rule to legacy .js modules changes established
 * oracle candidates whose property names merely coincide with exports.
 */
export async function filterInFileUsedMjsExportCandidates(
  candidates: readonly DeadCodeCandidate[],
  graph: RepositoryGraph,
  repositoryPath: string,
  indexedSourceFiles: readonly IndexedSourceFile[] = [],
): Promise<DeadCodeCandidate[]> {
  const sources = await readSourceFacts(
    graph,
    repositoryPath,
    indexedSourceFiles,
  );
  const sourcesByPath = new Map(sources.map((source) => [source.path, source]));
  const symbolsById = new Map(graph.symbols.map((symbol) => [symbol.id, symbol]));

  return candidates.filter((candidate) =>
    !candidate.nodeIds.some((nodeId) => {
      const graphSymbol = symbolsById.get(nodeId);
      const source = sourcesByPath.get(candidate.file);
      if (
        graphSymbol === undefined ||
        source === undefined ||
        graphSymbol.fileId !== source.fileId ||
        !graphSymbol.exported ||
        !source.path.toLowerCase().endsWith(".mjs")
      ) {
        return false;
      }

      const parsedSymbols = source.parsed.symbols.filter((symbol) =>
        symbol.exported &&
        symbol.name === graphSymbol.name &&
        symbol.type === graphSymbol.type
      );
      if (parsedSymbols.length !== 1) return false;
      const parsedSymbol = parsedSymbols[0];
      if (parsedSymbol === undefined) return false;

      const exportRanges = source.parsed.exports
        .filter((entry) =>
          !entry.typeOnly &&
          entry.source === undefined &&
          (entry.localName ?? entry.exportedName) === graphSymbol.name
        )
        .map((entry) => entry.lineRange);
      if (exportRanges.length === 0) return false;

      return hasLexicalReferenceOutsideRanges(
        source.content,
        graphSymbol.name,
        [parsedSymbol.lineRange, ...exportRanges],
      );
    })
  );
}

async function readSourceFacts(
  graph: RepositoryGraph,
  repositoryPath: string,
  indexedSourceFiles: readonly IndexedSourceFile[],
): Promise<ParsedSourceFact[]> {
  const facts: ParsedSourceFact[] = [];
  const indexedSourcesByPath = new Map(
    indexedSourceFiles.map((source) => [source.file.path, source]),
  );
  for (const file of [...graph.files].sort((left, right) =>
    compareText(left.path, right.path)
  )) {
    if (
      file.lineRange === undefined ||
      !isSupportedSourceFile(file as ScannedFile)
    ) {
      continue;
    }
    const indexedSource = indexedSourcesByPath.get(file.path);
    const reusableSource = indexedSource?.file.contentHash === file.contentHash &&
        indexedSource.file.language === file.language &&
        Buffer.byteLength(indexedSource.content, "utf8") <= MAX_SOURCE_BYTES
      ? indexedSource
      : undefined;
    const slice = reusableSource === undefined
      ? await getSource(graph, repositoryPath, file.id, {
          maxLines: file.lineRange.end,
          maxBytes: MAX_SOURCE_BYTES,
        })
      : undefined;
    const originalContent = reusableSource?.content ?? slice?.content ?? "";
    const content = sanitizeForTreeSitter(originalContent);
    const parsed = reusableSource !== undefined && content === originalContent
      ? reusableSource.parsed
      : parseWithLanguageFrontend(file as ScannedFile, content);
    if (parsed.diagnostics.length > 0) continue;
    facts.push({
      fileId: file.id,
      path: file.path,
      content,
      parsed,
      candidateEligible: !isTestFilePath(file.path),
      ...(parsed.language === "python"
        ? { pythonUsage: extractPythonUsageFacts(content) }
        : {}),
    });
  }
  return facts;
}

function findUnusedLocalHelpers(
  sources: readonly ParsedSourceFact[],
  graph: RepositoryGraph,
): MechanicalFinding[] {
  return sources.flatMap((source) =>
    source.parsed.symbols.flatMap((symbol): MechanicalFinding[] => {
      if (
        !source.candidateEligible ||
        symbol.type !== "function" ||
        symbol.exported ||
        !SIMPLE_IDENTIFIER.test(symbol.name) ||
        hasLexicalReferenceOutsideRange(
          source.content,
          symbol.name,
          symbol.lineRange.start,
          symbol.lineRange.end,
        )
      ) {
        return [];
      }
      return [{
        category: "local-helper",
        file: source.path,
        symbol: symbol.name,
        line: symbol.lineRange.start,
        nodeIds: graph.symbols
          .filter((node) => node.name === symbol.name && filePath(graph, node.fileId) === source.path)
          .map((node) => node.id)
          .sort(compareText),
        reason:
          `Local helper ${JSON.stringify(symbol.name)} is defined but has no lexical reference outside its declaration.`,
      }];
    })
  );
}

function findUnusedAssignments(
  sources: readonly ParsedSourceFact[],
  attributeAccessNames: ReadonlySet<string>,
): MechanicalFinding[] {
  return sources.flatMap((source) => {
    if (!source.candidateEligible || source.pythonUsage === undefined) return [];
    const results: MechanicalFinding[] = [];
    const lines = source.content.split(/\r?\n/u);
    for (const assignment of source.pythonUsage.assignments) {
      const declarationLine = lines[assignment.lineRange.start - 1] ?? "";
      if (
        assignment.classBodyField ||
        attributeAccessNames.has(assignment.name) ||
        source.pythonUsage.keywordArgumentNamesByScope
          .get(assignment.scopeKey)?.has(assignment.name) === true ||
        declarationLine.includes(";") ||
        hasLexicalReferenceOutsideRange(
          source.content,
          assignment.name,
          assignment.lineRange.start,
          assignment.lineRange.end,
        )
      ) {
        continue;
      }
      results.push({
        category: "assignment",
        file: source.path,
        symbol: assignment.name,
        line: assignment.lineRange.start,
        nodeIds: [],
        reason:
          `Assignment target ${JSON.stringify(assignment.name)} has no lexical read, same-scope keyword-argument use, graph-wide attribute access, or class-field serialization evidence.`,
      });
    }
    return results;
  });
}

function findUnusedTypeAliases(
  sources: readonly ParsedSourceFact[],
  graph: RepositoryGraph,
): MechanicalFinding[] {
  return sources.flatMap((source) => {
    if (!source.candidateEligible) return [];
    const results: MechanicalFinding[] = [];
    const lines = source.content.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      const pythonMatch = source.parsed.language === "python"
        ? /^([A-Z][A-Za-z0-9_]*)\s*=\s*(?:Literal|TypeAlias|Union|Optional|Annotated|Callable|TypeVar)\b/u.exec(
            line,
          )
        : null;
      const typeScriptMatch = source.parsed.language !== "python"
        ? /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/u.exec(line)
        : null;
      const name = pythonMatch?.[1] ?? typeScriptMatch?.[1];
      if (
        name === undefined ||
        hasLexicalReferenceOutsideRange(source.content, name, index + 1, index + 1)
      ) {
        continue;
      }
      results.push({
        category: "type-alias",
        file: source.path,
        symbol: name,
        line: index + 1,
        nodeIds: graph.symbols
          .filter((node) => node.name === name && filePath(graph, node.fileId) === source.path)
          .map((node) => node.id)
          .sort(compareText),
        reason:
          `Type alias ${JSON.stringify(name)} has no lexical reference outside its declaration.`,
      });
    }
    return results;
  });
}

function findUnusedExportedApiMethods(
  sources: readonly ParsedSourceFact[],
): MechanicalFinding[] {
  const allSource = sources.map((source) => source.content).join("\n");
  const results: MechanicalFinding[] = [];
  for (const source of sources) {
    if (
      !source.candidateEligible ||
      (source.parsed.language !== "typescript" && source.parsed.language !== "tsx")
    ) {
      continue;
    }
    const objectPattern = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*\{([\s\S]*?)^\};/gmu;
    for (const objectMatch of source.content.matchAll(objectPattern)) {
      const objectName = objectMatch[1];
      const body = objectMatch[2];
      if (objectName === undefined || body === undefined) continue;
      if (new RegExp(`\\b${escapeRegExp(objectName)}\\s*\\[`, "u").test(allSource)) {
        continue;
      }
      const bodyStart = (objectMatch.index ?? 0) + objectMatch[0].indexOf(body);
      const methodPattern = /^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\(/gmu;
      for (const methodMatch of body.matchAll(methodPattern)) {
        const methodName = methodMatch[1];
        if (methodName === undefined) continue;
        const qualifiedName = `${objectName}.${methodName}`;
        const reference = new RegExp(
          `\\b${escapeRegExp(objectName)}\\s*\\.\\s*${escapeRegExp(methodName)}\\b`,
          "gu",
        );
        if (reference.test(allSource)) continue;
        const offset = bodyStart + (methodMatch.index ?? 0);
        results.push({
          category: "exported-api-method",
          file: source.path,
          symbol: qualifiedName,
          line: lineNumberAtOffset(source.content, offset),
          nodeIds: [],
          reason:
            `Exported API wrapper method ${JSON.stringify(qualifiedName)} has no qualified caller in indexed source.`,
        });
      }
    }
  }
  return results;
}

function findNeverImportedModuleExports(
  sources: readonly ParsedSourceFact[],
  graph: RepositoryGraph,
): MechanicalFinding[] {
  const ownerFileIdByNodeId = new Map<string, string>();
  for (const file of graph.files) ownerFileIdByNodeId.set(file.id, file.id);
  for (const node of [...graph.symbols, ...graph.entrypoints, ...graph.entities]) {
    ownerFileIdByNodeId.set(node.id, node.fileId);
  }

  const referencedSymbolIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type !== "REFERENCES") continue;
    const sourceFileId = ownerFileIdByNodeId.get(edge.source);
    const targetFileId = ownerFileIdByNodeId.get(edge.target);
    if (
      sourceFileId === undefined ||
      targetFileId === undefined ||
      sourceFileId === targetFileId
    ) {
      continue;
    }
    referencedSymbolIds.add(edge.target);
  }

  const results: MechanicalFinding[] = [];
  for (const source of sources) {
    if (
      !source.candidateEligible ||
      source.parsed.language === "python"
    ) {
      continue;
    }
    const lines = source.content.split(/\r?\n/u);
    for (const exported of source.parsed.exports) {
      if (
        exported.typeOnly ||
        exported.source !== undefined ||
        exported.localName === undefined
      ) {
        continue;
      }
      if (isFrameworkLifecycleExport(source.path, exported.exportedName)) {
        continue;
      }
      const statement = lines.slice(
        exported.lineRange.start - 1,
        exported.lineRange.end,
      ).join("\n");
      if (!/^\s*export\s+(?:const\b|default\b)/u.test(statement)) continue;
      const parsedSymbol = source.parsed.symbols.find((symbol) =>
        symbol.name === exported.localName &&
        symbol.type === "variable" &&
        symbol.exported
      );
      if (parsedSymbol === undefined) continue;
      const graphSymbol = graph.symbols.find((symbol) =>
        symbol.fileId === source.fileId &&
        symbol.name === parsedSymbol.name &&
        symbol.type === "variable" &&
        symbol.exported
      );
      if (
        graphSymbol === undefined ||
        referencedSymbolIds.has(graphSymbol.id) ||
        (
          (source.parsed.language === "typescript" ||
            source.parsed.language === "tsx") &&
          hasLexicalReferenceOutsideRanges(source.content, graphSymbol.name, [
            parsedSymbol.lineRange,
            exported.lineRange,
          ])
        )
      ) {
        continue;
      }
      results.push({
        category: "module-export",
        file: source.path,
        symbol: graphSymbol.name,
        line: exported.lineRange.start,
        nodeIds: [graphSymbol.id],
        reason:
          `Explicit JavaScript/TypeScript module export ${JSON.stringify(graphSymbol.name)} has no cross-file import or reference evidence.`,
      });
    }
  }
  return results;
}

function isFrameworkLifecycleExport(
  path: string,
  exportedName: string,
): boolean {
  const normalizedPath = path.replaceAll("\\", "/");
  return DEFAULT_FRAMEWORK_REGISTRY.javascript().lifecycleExports.some(
    (convention) => {
      convention.pathPattern.lastIndex = 0;
      return convention.exportedNames.includes(exportedName) &&
        convention.pathPattern.test(normalizedPath);
    },
  );
}

/**
 * tree-sitter's JS binding throws EINVAL ("Invalid argument") on astral-plane
 * characters (emoji flags, etc.). Replace non-BMP characters with spaces — a
 * 1:1 character replacement that keeps line/column offsets intact for usage
 * facts, and identifiers are ASCII anyway.
 */
function sanitizeForTreeSitter(source: string): string {
  return source.replace(/[^\u0000-\uFFFF]/gu, " ");
}

const PARSER_INPUT_CHUNK_SIZE = 16_384;

function extractPythonUsageFacts(source: string): PythonUsageFacts {
  const parser = new Parser();
  parser.setLanguage(Python);
  // Chunked callback form: parser.parse(string) throws EINVAL ("Invalid
  // argument") on inputs longer than 32KB (2^15 chars) in the node binding.
  // Same pattern as src/languages/python/parsePythonSourceFile.ts.
  const tree = parser.parse((index) =>
    source.slice(index, index + PARSER_INPUT_CHUNK_SIZE),
  );
  const assignments = tree.rootNode.descendantsOfType("assignment")
    .flatMap((assignment): PythonAssignmentFact[] => {
      const target = assignment.childForFieldName("left");
      if (
        target?.type !== "identifier" ||
        !/^[a-z][A-Za-z0-9_]*$/u.test(target.text) ||
        target.text.startsWith("_") ||
        assignment.startPosition.column === 0
      ) {
        return [];
      }
      return [{
        name: target.text,
        lineRange: {
          start: assignment.startPosition.row + 1,
          end: assignment.endPosition.row + 1,
        },
        scopeKey: pythonScopeKey(assignment),
        classBodyField: isDirectClassBodyAssignment(assignment),
      }];
    })
    .sort(
      (left, right) =>
        left.lineRange.start - right.lineRange.start ||
        compareText(left.name, right.name),
    );
  const keywordArgumentNamesByScope = new Map<string, Set<string>>();
  for (const keyword of tree.rootNode.descendantsOfType("keyword_argument")) {
    const name = keyword.childForFieldName("name")?.text;
    if (name === undefined || !SIMPLE_IDENTIFIER.test(name)) continue;
    const scopeKey = pythonScopeKey(keyword);
    const names = keywordArgumentNamesByScope.get(scopeKey) ?? new Set<string>();
    names.add(name);
    keywordArgumentNamesByScope.set(scopeKey, names);
  }
  return { assignments, keywordArgumentNamesByScope };
}

function pythonScopeKey(node: Parser.SyntaxNode): string {
  let current = node.parent;
  while (current !== null) {
    if (
      current.type === "function_definition" ||
      current.type === "lambda" ||
      current.type === "class_definition" ||
      current.type === "module"
    ) {
      return `${current.type}:${current.startIndex}:${current.endIndex}`;
    }
    current = current.parent;
  }
  return "module:0:0";
}

function isDirectClassBodyAssignment(node: Parser.SyntaxNode): boolean {
  const statement = node.parent;
  const block = statement?.parent;
  return statement?.type === "expression_statement" &&
    block?.type === "block" &&
    block.parent?.type === "class_definition";
}

function collectAttributeAccessNames(
  sources: readonly ParsedSourceFact[],
): Set<string> {
  const names = new Set<string>();
  const expression = /\.\s*([A-Za-z_$][\w$]*)\b/gu;
  for (const source of sources) {
    for (const match of source.content.matchAll(expression)) {
      const name = match[1];
      if (name !== undefined) names.add(name);
    }
  }
  return names;
}

function hasLexicalReferenceOutsideRange(
  source: string,
  name: string,
  startLine: number,
  endLine: number,
): boolean {
  return source.split(/\r?\n/u).some((line, index) => {
    const lineNumber = index + 1;
    return (lineNumber < startLine || lineNumber > endLine) &&
      countIdentifier(line, name) > 0;
  });
}

function hasLexicalReferenceOutsideRanges(
  source: string,
  name: string,
  excludedRanges: ReadonlyArray<{ start: number; end: number }>,
): boolean {
  return source.split(/\r?\n/u).some((line, index) => {
    const lineNumber = index + 1;
    const excluded = excludedRanges.some(
      (range) => lineNumber >= range.start && lineNumber <= range.end,
    );
    return !excluded && countIdentifier(line, name) > 0;
  });
}

function countIdentifier(source: string, name: string): number {
  return [...source.matchAll(new RegExp(`\\b${escapeRegExp(name)}\\b`, "gu"))].length;
}

function lineNumberAtOffset(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r?\n/u).length;
}

function filePath(graph: RepositoryGraph, fileId: string): string | undefined {
  return graph.files.find((file) => file.id === fileId)?.path;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
