import type {
  ParsedCall,
  ParsedImport,
  ParsedSourceFile,
} from "../parser/types.js";
import { isTestFilePath } from "../scanner/classifyFilePath.ts";
import type {
  Edge,
  EntryPointNode,
  EvidenceGraphNode,
  FileNode,
  SymbolNode,
} from "./types.js";

export interface EvidenceGraphExpansion {
  entities: EvidenceGraphNode[];
  edges: Edge[];
}

export function buildEvidenceGraph(
  files: readonly FileNode[],
  symbols: readonly SymbolNode[],
  entrypoints: readonly EntryPointNode[],
  parsedFiles: readonly ParsedSourceFile[],
  structuralEdges: readonly Edge[],
): EvidenceGraphExpansion {
  const filesById = new Map(files.map((file) => [file.id, file]));
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const symbolsById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const symbolsByFileId = indexSymbolsByFileId(symbols);
  const entrypointsByFileId = indexEntrypointsByFileId(entrypoints);
  const entities: EvidenceGraphNode[] = [];
  const entityIds = new Set<string>();

  for (const file of files) {
    for (const entrypoint of entrypointsByFileId.get(file.id) ?? []) {
      if (entrypoint.exposure !== "external") continue;
      entities.push({
        id: `endpoint:${entrypoint.kind}:${file.path}:${entrypoint.lineRange.start}:${entrypoint.name}`,
        type: "endpoint",
        name: entrypoint.name,
        fileId: file.id,
        entrypointId: entrypoint.id,
        kind: entrypoint.kind,
        ...(entrypoint.httpMethod === undefined
          ? {}
          : { httpMethod: entrypoint.httpMethod }),
        ...(entrypoint.route === undefined ? {} : { route: entrypoint.route }),
        lineRange: { ...entrypoint.lineRange },
        evidence: { ...entrypoint.evidence },
      });
    }

    for (const symbol of symbolsByFileId.get(file.id) ?? []) {
      const entityType = evidenceNodeType(file.path, symbol);
      if (entityType === undefined) continue;
      const baseId = `${entityType}:${file.path}:${symbol.name}`;
      const id = disambiguatedEntityId(baseId, symbol.lineRange.start, entityIds);
      entities.push({
        id,
        type: entityType,
        name: symbol.name,
        fileId: file.id,
        symbolId: symbol.id,
        lineRange: { ...symbol.lineRange },
        evidence: {
          file: file.path,
          line: symbol.lineRange.start,
          extractor: "tree-sitter",
        },
      });
      entityIds.add(id);
    }

    if (isTestFilePath(file.path)) {
      entities.push({
        id: `test:${file.path}`,
        type: "test",
        name: file.path.split("/").at(-1) ?? file.path,
        fileId: file.id,
        lineRange: { start: 1, end: 1 },
        evidence: {
          file: file.path,
          line: 1,
          extractor: "tree-sitter",
        },
      });
    }
  }

  for (const parsedFile of parsedFiles) {
    const file = filesByPath.get(parsedFile.path);
    if (file === undefined) continue;
    for (const event of parsedFile.events ?? []) {
      entities.push({
        id: `event:${parsedFile.path}:${event.lineRange.start}:${event.operation}:${event.name}`,
        type: "event",
        name: event.name,
        operation: event.operation,
        fileId: file.id,
        lineRange: { ...event.lineRange },
        evidence: {
          file: parsedFile.path,
          line: event.lineRange.start,
          extractor: "tree-sitter",
        },
      });
    }
  }

  entities.sort(compareEntities);
  ensureUniqueEntityIds(entities);

  const edges: Edge[] = [];
  const entitiesBySymbolId = new Map(
    entities.flatMap((entity) =>
      "symbolId" in entity ? [[entity.symbolId, entity] as const] : [],
    ),
  );
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));

  for (const entity of entities) {
    edges.push({
      source: entity.fileId,
      target: entity.id,
      type: "CONTAINS",
      evidence: { ...entity.evidence },
    });

    if (entity.type === "endpoint") {
      const entrypoint = entrypoints.find(
        (candidate) => candidate.id === entity.entrypointId,
      );
      if (entrypoint?.handlerSymbolId !== undefined) {
        edges.push({
          source: entity.id,
          target: entrypoint.handlerSymbolId,
          type: "HANDLED_BY",
          evidence: { ...entity.evidence },
        });
      }
    }
  }

  addEventEdges(edges, entities, parsedFiles, filesByPath, symbolsByFileId);
  addRenderEdges(
    edges,
    entitiesBySymbolId,
    parsedFiles,
    filesByPath,
    symbolsByFileId,
    structuralEdges,
    symbolsById,
  );
  addValidationEdges(
    edges,
    entitiesBySymbolId,
    parsedFiles,
    filesByPath,
    symbolsByFileId,
    structuralEdges,
    symbolsById,
  );
  addTestAndConfigEdges(
    edges,
    entitiesById,
    entitiesBySymbolId,
    structuralEdges,
    filesById,
  );

  return {
    entities,
    edges: deduplicateEdges(edges).sort(compareEdges),
  };
}

function disambiguatedEntityId(
  baseId: string,
  startLine: number,
  existingIds: ReadonlySet<string>,
): string {
  return existingIds.has(baseId) ? `${baseId}:line:${startLine}` : baseId;
}

function evidenceNodeType(
  path: string,
  symbol: SymbolNode,
): "component" | "screen" | "schema" | "config" | undefined {
  if (/Schema$/iu.test(symbol.name)) return "schema";
  if (
    symbol.type === "class" &&
    /(?:^|\/)models?(?:\/|$)/iu.test(path) &&
    /\.py$/iu.test(path)
  ) {
    return "schema";
  }
  if (/Config$/iu.test(symbol.name) || /(?:^|\/)config(?:[./]|$)/iu.test(path)) {
    return "config";
  }
  if (
    (symbol.type === "function" || symbol.type === "class") &&
    /^\p{Lu}/u.test(unqualifiedName(symbol.name)) &&
    (/Screen$/u.test(symbol.name) || /(?:^|\/)screens?(?:\/|$)/iu.test(path))
  ) {
    return "screen";
  }
  if (
    (symbol.type === "function" || symbol.type === "class") &&
    /^\p{Lu}/u.test(unqualifiedName(symbol.name)) &&
    (/\.[jt]sx$/iu.test(path) || /(?:Component|Page|Sheet|View)$/u.test(symbol.name))
  ) {
    return "component";
  }
  return undefined;
}

function addEventEdges(
  edges: Edge[],
  entities: readonly EvidenceGraphNode[],
  parsedFiles: readonly ParsedSourceFile[],
  filesByPath: ReadonlyMap<string, FileNode>,
  symbolsByFileId: ReadonlyMap<string, SymbolNode[]>,
): void {
  for (const parsedFile of parsedFiles) {
    const file = filesByPath.get(parsedFile.path);
    if (file === undefined) continue;
    for (const event of parsedFile.events ?? []) {
      if (event.ownerName === undefined) continue;
      const owner = uniqueSymbol(symbolsByFileId.get(file.id) ?? [], event.ownerName);
      const eventNode = entities.find(
        (entity) =>
          entity.type === "event" &&
          entity.fileId === file.id &&
          entity.lineRange.start === event.lineRange.start &&
          entity.name === event.name,
      );
      if (owner === undefined || eventNode === undefined) continue;
      edges.push({
        source: owner.id,
        target: eventNode.id,
        type: event.operation === "publish" ? "PUBLISHES" : "SUBSCRIBES_TO",
        evidence: {
          file: parsedFile.path,
          line: event.lineRange.start,
          extractor: "tree-sitter",
        },
      });
    }
  }
}

function addRenderEdges(
  edges: Edge[],
  _entitiesBySymbolId: ReadonlyMap<string, EvidenceGraphNode>,
  parsedFiles: readonly ParsedSourceFile[],
  filesByPath: ReadonlyMap<string, FileNode>,
  symbolsByFileId: ReadonlyMap<string, SymbolNode[]>,
  structuralEdges: readonly Edge[],
  symbolsById: ReadonlyMap<string, SymbolNode>,
): void {
  for (const parsedFile of parsedFiles) {
    const file = filesByPath.get(parsedFile.path);
    if (file === undefined) continue;
    for (const render of parsedFile.renders ?? []) {
      if (render.ownerName === undefined) continue;
      const owner = uniqueSymbol(symbolsByFileId.get(file.id) ?? [], render.ownerName);
      const target = resolveReferencedSymbol(
        parsedFile,
        file,
        render.componentName.split(".", 1)[0] ?? render.componentName,
        symbolsByFileId,
        structuralEdges,
        symbolsById,
      );
      if (owner === undefined || target === undefined || target.type !== "function") continue;
      edges.push({
        source: owner.id,
        target: target.id,
        type: "RENDERS",
        evidence: {
          file: parsedFile.path,
          line: render.lineRange.start,
          extractor: "tree-sitter",
        },
      });
    }
  }
}

function addValidationEdges(
  edges: Edge[],
  entitiesBySymbolId: ReadonlyMap<string, EvidenceGraphNode>,
  parsedFiles: readonly ParsedSourceFile[],
  filesByPath: ReadonlyMap<string, FileNode>,
  symbolsByFileId: ReadonlyMap<string, SymbolNode[]>,
  structuralEdges: readonly Edge[],
  symbolsById: ReadonlyMap<string, SymbolNode>,
): void {
  for (const parsedFile of parsedFiles) {
    const file = filesByPath.get(parsedFile.path);
    if (file === undefined) continue;
    for (const call of parsedFile.calls) {
      const rootName = call.callee.split(/[.[]/u, 1)[0];
      if (rootName === undefined || call.caller === undefined) continue;
      const target = resolveReferencedSymbol(
        parsedFile,
        file,
        rootName,
        symbolsByFileId,
        structuralEdges,
        symbolsById,
      );
      const schemaEntity = target === undefined ? undefined : entitiesBySymbolId.get(target.id);
      const owner = uniqueSymbol(symbolsByFileId.get(file.id) ?? [], call.caller);
      if (owner === undefined || schemaEntity?.type !== "schema") continue;
      edges.push({
        source: owner.id,
        target: schemaEntity.id,
        type: "VALIDATED_BY",
        evidence: {
          file: parsedFile.path,
          line: call.lineRange.start,
          extractor: "resolver",
        },
      });
    }
    for (const reference of parsedFile.references ?? []) {
      if (reference.ownerName === undefined) continue;
      const rootName = reference.importedLocalName ??
        reference.targetName.split(/[.[]/u, 1)[0];
      if (rootName === undefined) continue;
      const target = resolveReferencedSymbol(
        parsedFile,
        file,
        rootName,
        symbolsByFileId,
        structuralEdges,
        symbolsById,
      );
      const schemaEntity = target === undefined
        ? undefined
        : entitiesBySymbolId.get(target.id);
      const owner = uniqueSymbol(
        symbolsByFileId.get(file.id) ?? [],
        reference.ownerName,
      );
      if (owner === undefined || schemaEntity?.type !== "schema") continue;
      edges.push({
        source: owner.id,
        target: schemaEntity.id,
        type: "VALIDATED_BY",
        evidence: {
          file: parsedFile.path,
          line: reference.lineRange.start,
          extractor: "resolver",
        },
      });
    }
  }
}

function addTestAndConfigEdges(
  edges: Edge[],
  entitiesById: ReadonlyMap<string, EvidenceGraphNode>,
  entitiesBySymbolId: ReadonlyMap<string, EvidenceGraphNode>,
  structuralEdges: readonly Edge[],
  filesById: ReadonlyMap<string, FileNode>,
): void {
  for (const edge of structuralEdges) {
    if (edge.type !== "REFERENCES") continue;
    const sourceFile = filesById.get(edge.source);
    const targetEntity = entitiesBySymbolId.get(edge.target);
    if (sourceFile === undefined) continue;

    const testNode = entitiesById.get(`test:${sourceFile.path}`);
    if (testNode?.type === "test") {
      edges.push({
        source: edge.target,
        target: testNode.id,
        type: "TESTED_BY",
        evidence: { ...edge.evidence },
      });
    }
    if (targetEntity?.type === "config") {
      edges.push({
        source: sourceFile.id,
        target: targetEntity.id,
        type: "CONFIGURED_BY",
        evidence: { ...edge.evidence },
      });
    }
  }
}

function resolveReferencedSymbol(
  parsedFile: ParsedSourceFile,
  file: FileNode,
  localName: string,
  symbolsByFileId: ReadonlyMap<string, SymbolNode[]>,
  structuralEdges: readonly Edge[],
  symbolsById: ReadonlyMap<string, SymbolNode>,
): SymbolNode | undefined {
  const local = uniqueSymbol(symbolsByFileId.get(file.id) ?? [], localName);
  if (local !== undefined) return local;

  const matchingImports = parsedFile.imports.filter(
    (parsedImport) => !parsedImport.typeOnly && parsedImport.localName === localName,
  );
  if (matchingImports.length !== 1) return undefined;
  const parsedImport = matchingImports[0] as ParsedImport;
  const candidates = structuralEdges
    .filter(
      (edge) =>
        edge.type === "REFERENCES" &&
        edge.source === file.id &&
        edge.evidence.line === parsedImport.lineRange.start,
    )
    .flatMap((edge) => {
      const symbol = symbolsById.get(edge.target);
      if (symbol === undefined) return [];
      const importedName = parsedImport.importedName;
      return importedName === "default" ||
        importedName === symbol.name ||
        importedName === unqualifiedName(symbol.name)
        ? [symbol]
        : [];
    });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function indexSymbolsByFileId(
  symbols: readonly SymbolNode[],
): Map<string, SymbolNode[]> {
  const result = new Map<string, SymbolNode[]>();
  for (const symbol of symbols) {
    const values = result.get(symbol.fileId) ?? [];
    values.push(symbol);
    result.set(symbol.fileId, values);
  }
  return result;
}

function indexEntrypointsByFileId(
  entrypoints: readonly EntryPointNode[],
): Map<string, EntryPointNode[]> {
  const result = new Map<string, EntryPointNode[]>();
  for (const entrypoint of entrypoints) {
    const values = result.get(entrypoint.fileId) ?? [];
    values.push(entrypoint);
    result.set(entrypoint.fileId, values);
  }
  return result;
}

function uniqueSymbol(symbols: readonly SymbolNode[], name: string): SymbolNode | undefined {
  const candidates = symbols.filter((symbol) => symbol.name === name);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function unqualifiedName(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1);
}

function ensureUniqueEntityIds(entities: readonly EvidenceGraphNode[]): void {
  const ids = new Set<string>();
  for (const entity of entities) {
    if (ids.has(entity.id)) throw new Error(`Duplicate evidence graph node ID: ${entity.id}`);
    ids.add(entity.id);
  }
}

function deduplicateEdges(edges: readonly Edge[]): Edge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = [
      edge.source,
      edge.target,
      edge.type,
      edge.evidence.file,
      edge.evidence.line ?? "",
      edge.evidence.extractor,
    ].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareEntities(left: EvidenceGraphNode, right: EvidenceGraphNode): number {
  return compareText(left.id, right.id);
}

function compareEdges(left: Edge, right: Edge): number {
  return (
    compareText(left.source, right.source) ||
    compareText(left.target, right.target) ||
    compareText(left.type, right.type) ||
    compareText(left.evidence.file, right.evidence.file) ||
    (left.evidence.line ?? 0) - (right.evidence.line ?? 0)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
