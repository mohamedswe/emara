import type {
  EdgeType,
  EvidenceNodeKind,
  EntryPointExposure,
  EntryPointKind,
  EvidenceExtractor,
  RepositoryGraph,
  SymbolKind,
} from "./types.js";

const SYMBOL_KINDS = new Set<SymbolKind>(["function", "class", "variable"]);
const EDGE_TYPES = new Set<EdgeType>([
  "CONTAINS",
  "IMPORTS",
  "CALLS",
  "REFERENCES",
  "HANDLED_BY",
  "VALIDATED_BY",
  "TESTED_BY",
  "RENDERS",
  "PUBLISHES",
  "SUBSCRIBES_TO",
  "CONFIGURED_BY",
]);
const EVIDENCE_NODE_KINDS = new Set<EvidenceNodeKind>([
  "endpoint",
  "component",
  "screen",
  "schema",
  "config",
  "test",
  "event",
]);
const EVIDENCE_EXTRACTORS = new Set<EvidenceExtractor>([
  "tree-sitter",
  "resolver",
  "scanner",
]);
const ENTRYPOINT_KINDS = new Set<EntryPointKind>([
  "http",
  "websocket",
  "cli",
  "event",
  "scheduled",
  "graphql",
  "application",
  "startup",
]);
const ENTRYPOINT_EXPOSURES = new Set<EntryPointExposure>([
  "external",
  "startup",
]);
const GRAPH_DIAGNOSTIC_KINDS = new Set([
  "parse-error",
  "parse-missing",
  "unresolved-decorator",
  "unresolved-registration",
]);

interface FileNodeInfo {
  kind: "file";
  path: string;
}

interface SymbolNodeInfo {
  kind: SymbolKind;
  fileId: string;
}

interface EntryPointNodeInfo {
  kind: "entrypoint";
  fileId: string;
}

interface EvidenceNodeInfo {
  kind: EvidenceNodeKind;
  fileId: string;
}

type NodeInfo =
  | FileNodeInfo
  | SymbolNodeInfo
  | EntryPointNodeInfo
  | EvidenceNodeInfo;

export function validateRepositoryGraph(
  value: unknown,
): asserts value is RepositoryGraph {
  const issues: string[] = [];

  if (!isRecord(value)) {
    throw new Error("Invalid repository graph:\n- graph must be an object");
  }

  if (value.version !== 4) {
    issues.push("version must be 4");
  }

  const analysis = validateGraphAnalysis(value.analysis, issues);

  const files = arrayField(value, "files", issues);
  const symbols = arrayField(value, "symbols", issues);
  const entrypoints = arrayField(value, "entrypoints", issues);
  const entities = arrayField(value, "entities", issues);
  const edges = arrayField(value, "edges", issues);
  const nodesById = new Map<string, NodeInfo>();
  const fileIdsByPath = new Map<string, string>();

  for (const [index, rawFile] of files.entries()) {
    const location = `files[${index}]`;
    if (!isRecord(rawFile)) {
      issues.push(`${location} must be an object`);
      continue;
    }

    const id = nonEmptyStringField(rawFile, "id", location, issues);
    const path = nonEmptyStringField(rawFile, "path", location, issues);
    nonEmptyStringField(rawFile, "language", location, issues);
    nonEmptyStringField(rawFile, "contentHash", location, issues);
    if (rawFile.lineRange !== undefined) {
      validateLineRange(rawFile.lineRange, `${location}.lineRange`, issues);
    }

    if (rawFile.type !== "file") {
      issues.push(`${location}.type must be "file"`);
    }

    if (id !== undefined && path !== undefined) {
      registerNode(nodesById, id, { kind: "file", path }, location, issues);

      const existingId = fileIdsByPath.get(path);
      if (existingId !== undefined) {
        issues.push(
          `${location}.path duplicates file path ${JSON.stringify(path)} from node ${JSON.stringify(existingId)}`,
        );
      } else {
        fileIdsByPath.set(path, id);
      }
    }
  }

  if (analysis !== undefined) {
    for (const [index, path] of analysis.unparsedSourceFiles.entries()) {
      if (!fileIdsByPath.has(path)) {
        issues.push(
          `analysis.unparsedSourceFiles[${index}] references missing file ${JSON.stringify(path)}`,
        );
      }
    }
    for (const [index, diagnostic] of analysis.diagnostics.entries()) {
      if (!fileIdsByPath.has(diagnostic.file)) {
        issues.push(
          `analysis.diagnostics[${index}].file references missing file ${JSON.stringify(diagnostic.file)}`,
        );
      }
    }
  }

  for (const [index, rawSymbol] of symbols.entries()) {
    const location = `symbols[${index}]`;
    if (!isRecord(rawSymbol)) {
      issues.push(`${location} must be an object`);
      continue;
    }

    const id = nonEmptyStringField(rawSymbol, "id", location, issues);
    const name = nonEmptyStringField(rawSymbol, "name", location, issues);
    const fileId = nonEmptyStringField(rawSymbol, "fileId", location, issues);
    const kind = rawSymbol.type;

    if (typeof kind !== "string" || !SYMBOL_KINDS.has(kind as SymbolKind)) {
      issues.push(`${location}.type must be "function", "class", or "variable"`);
    }

    if (typeof rawSymbol.exported !== "boolean") {
      issues.push(`${location}.exported must be a boolean`);
    }

    validateLineRange(rawSymbol.lineRange, `${location}.lineRange`, issues);

    if (
      id !== undefined &&
      name !== undefined &&
      fileId !== undefined &&
      typeof kind === "string" &&
      SYMBOL_KINDS.has(kind as SymbolKind)
    ) {
      registerNode(
        nodesById,
        id,
        { kind: kind as SymbolKind, fileId },
        location,
        issues,
      );
    }
  }

  for (const [index, rawEntity] of entities.entries()) {
    const location = `entities[${index}]`;
    if (!isRecord(rawEntity)) {
      issues.push(`${location} must be an object`);
      continue;
    }

    const id = nonEmptyStringField(rawEntity, "id", location, issues);
    const name = nonEmptyStringField(rawEntity, "name", location, issues);
    const fileId = nonEmptyStringField(rawEntity, "fileId", location, issues);
    const rawKind = rawEntity.type;
    const kind =
      typeof rawKind === "string" &&
      EVIDENCE_NODE_KINDS.has(rawKind as EvidenceNodeKind)
        ? (rawKind as EvidenceNodeKind)
        : undefined;
    if (kind === undefined) {
      issues.push(
        `${location}.type must be endpoint, component, screen, schema, config, test, or event`,
      );
    }

    validateLineRange(rawEntity.lineRange, `${location}.lineRange`, issues);
    const evidence = validateEvidence(
      rawEntity.evidence,
      location,
      fileIdsByPath,
      issues,
    );

    if (id !== undefined && name !== undefined && fileId !== undefined && kind !== undefined) {
      registerNode(nodesById, id, { kind, fileId }, location, issues);
    }

    const owner = fileId === undefined ? undefined : nodesById.get(fileId);
    if (fileId !== undefined && owner?.kind !== "file") {
      issues.push(
        `${location}.fileId must reference a File node; received ${JSON.stringify(fileId)}`,
      );
    }
    if (owner?.kind === "file" && evidence !== undefined) {
      if (evidence.file !== owner.path) {
        issues.push(`${location}.evidence.file must match the entity file ${JSON.stringify(owner.path)}`);
      }
      const start = isRecord(rawEntity.lineRange)
        ? rawEntity.lineRange.start
        : undefined;
      if (evidence.line !== start) {
        issues.push(`${location}.evidence.line must match lineRange.start`);
      }
    }

    if (kind === "endpoint") {
      nonEmptyStringField(rawEntity, "entrypointId", location, issues);
    } else if (
      kind === "component" ||
      kind === "screen" ||
      kind === "schema" ||
      kind === "config"
    ) {
      const symbolId = nonEmptyStringField(rawEntity, "symbolId", location, issues);
      const symbol = symbolId === undefined ? undefined : nodesById.get(symbolId);
      if (
        symbolId !== undefined &&
        (symbol === undefined ||
          symbol.kind === "file" ||
          symbol.kind === "entrypoint" ||
          EVIDENCE_NODE_KINDS.has(symbol.kind as EvidenceNodeKind))
      ) {
        issues.push(`${location}.symbolId must reference a Symbol node`);
      } else if (
        symbol !== undefined &&
        symbol.kind !== "file" &&
        symbol.kind !== "entrypoint" &&
        "fileId" in symbol &&
        fileId !== undefined &&
        symbol.fileId !== fileId
      ) {
        issues.push(`${location}.symbolId must belong to the entity file`);
      }
    } else if (
      kind === "event" &&
      rawEntity.operation !== "publish" &&
      rawEntity.operation !== "subscribe"
    ) {
      issues.push(`${location}.operation must be publish or subscribe`);
    }
  }

  for (const [index, rawEntryPoint] of entrypoints.entries()) {
    const location = `entrypoints[${index}]`;
    if (!isRecord(rawEntryPoint)) {
      issues.push(`${location} must be an object`);
      continue;
    }

    const id = nonEmptyStringField(rawEntryPoint, "id", location, issues);
    const name = nonEmptyStringField(rawEntryPoint, "name", location, issues);
    const fileId = nonEmptyStringField(rawEntryPoint, "fileId", location, issues);
    const entrypointKind = rawEntryPoint.kind;
    const exposure = rawEntryPoint.exposure;

    if (rawEntryPoint.type !== "entrypoint") {
      issues.push(`${location}.type must be "entrypoint"`);
    }

    if (
      typeof entrypointKind !== "string" ||
      !ENTRYPOINT_KINDS.has(entrypointKind as EntryPointKind)
    ) {
      issues.push(
        `${location}.kind must be http, websocket, cli, event, scheduled, graphql, application, or startup`,
      );
    }

    if (
      typeof exposure !== "string" ||
      !ENTRYPOINT_EXPOSURES.has(exposure as EntryPointExposure)
    ) {
      issues.push(`${location}.exposure must be external or startup`);
    } else if (
      (entrypointKind === "startup") !== (exposure === "startup")
    ) {
      issues.push(`${location}.startup kind and exposure must agree`);
    }

    optionalNonEmptyStringField(rawEntryPoint, "httpMethod", location, issues);
    optionalNonEmptyStringField(rawEntryPoint, "route", location, issues);
    if (
      (entrypointKind === "http" || entrypointKind === "websocket") &&
      typeof rawEntryPoint.httpMethod !== "string"
    ) {
      issues.push(`${location}.httpMethod is required for HTTP and WebSocket entrypoints`);
    }
    if (entrypointKind === "websocket" && typeof rawEntryPoint.route !== "string") {
      issues.push(`${location}.route is required for WebSocket entrypoints`);
    }

    validateLineRange(rawEntryPoint.lineRange, `${location}.lineRange`, issues);

    const evidence = validateEvidence(
      rawEntryPoint.evidence,
      location,
      fileIdsByPath,
      issues,
    );

    if (id !== undefined && name !== undefined && fileId !== undefined) {
      registerNode(
        nodesById,
        id,
        { kind: "entrypoint", fileId },
        location,
        issues,
      );
    }

    const owner =
      fileId === undefined ? undefined : nodesById.get(fileId);
    if (fileId !== undefined && owner?.kind !== "file") {
      issues.push(
        `${location}.fileId must reference a File node; received ${JSON.stringify(fileId)}`,
      );
    }

    if (owner?.kind === "file" && evidence !== undefined) {
      if (evidence.file !== owner.path) {
        issues.push(
          `${location}.evidence.file must match the entrypoint file ${JSON.stringify(owner.path)}`,
        );
      }

      const start = isRecord(rawEntryPoint.lineRange)
        ? rawEntryPoint.lineRange.start
        : undefined;
      if (evidence.line === undefined) {
        issues.push(`${location}.evidence.line is required`);
      } else if (evidence.line !== start) {
        issues.push(`${location}.evidence.line must match lineRange.start`);
      }
    }

    if (rawEntryPoint.handlerSymbolId !== undefined) {
      const handlerSymbolId = nonEmptyStringField(
        rawEntryPoint,
        "handlerSymbolId",
        location,
        issues,
      );
      const handler =
        handlerSymbolId === undefined
          ? undefined
          : nodesById.get(handlerSymbolId);
      if (handlerSymbolId !== undefined && handler?.kind !== "function") {
        issues.push(
          `${location}.handlerSymbolId must reference a Function node; received ${JSON.stringify(handlerSymbolId)}`,
        );
      }
    }
  }

  for (const [index, rawEntity] of entities.entries()) {
    if (!isRecord(rawEntity) || rawEntity.type !== "endpoint") continue;
    const entrypointId = rawEntity.entrypointId;
    if (
      typeof entrypointId === "string" &&
      nodesById.get(entrypointId)?.kind !== "entrypoint"
    ) {
      issues.push(`entities[${index}].entrypointId must reference an EntryPoint node`);
    }
  }

  for (const [index, rawSymbol] of symbols.entries()) {
    if (!isRecord(rawSymbol) || typeof rawSymbol.fileId !== "string") {
      continue;
    }

    const owner = nodesById.get(rawSymbol.fileId);
    if (owner?.kind !== "file") {
      issues.push(
        `symbols[${index}].fileId must reference a File node; received ${JSON.stringify(rawSymbol.fileId)}`,
      );
    }
  }

  const edgeKeys = new Set<string>();

  for (const [index, rawEdge] of edges.entries()) {
    validateEdge(
      rawEdge,
      index,
      nodesById,
      fileIdsByPath,
      edgeKeys,
      issues,
    );
  }

  if (issues.length > 0) {
    throw new Error(
      `Invalid repository graph:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
    );
  }
}

function validateGraphAnalysis(
  value: unknown,
  issues: string[],
): {
  unparsedSourceFiles: string[];
  diagnostics: Array<{ file: string }>;
} | undefined {
  if (!isRecord(value)) {
    issues.push("analysis must be an object");
    return undefined;
  }
  const sourceFileCount = nonNegativeIntegerField(
    value,
    "sourceFileCount",
    "analysis",
    issues,
  );
  const parsedSourceFileCount = nonNegativeIntegerField(
    value,
    "parsedSourceFileCount",
    "analysis",
    issues,
  );
  const rawUnparsed = arrayField(value, "unparsedSourceFiles", issues);
  const unparsedSourceFiles: string[] = [];
  const unparsedSeen = new Set<string>();
  for (const [index, item] of rawUnparsed.entries()) {
    if (typeof item !== "string" || item.length === 0) {
      issues.push(
        `analysis.unparsedSourceFiles[${index}] must be a non-empty string`,
      );
    } else if (unparsedSeen.has(item)) {
      issues.push(
        `analysis.unparsedSourceFiles[${index}] duplicates ${JSON.stringify(item)}`,
      );
    } else {
      unparsedSeen.add(item);
      unparsedSourceFiles.push(item);
    }
  }
  if (
    sourceFileCount !== undefined &&
    parsedSourceFileCount !== undefined &&
    sourceFileCount !== parsedSourceFileCount + unparsedSourceFiles.length
  ) {
    issues.push(
      "analysis.sourceFileCount must equal parsedSourceFileCount plus unparsedSourceFiles.length",
    );
  }

  const rawDiagnostics = arrayField(value, "diagnostics", issues);
  const diagnostics: Array<{ file: string }> = [];
  for (const [index, item] of rawDiagnostics.entries()) {
    const location = `analysis.diagnostics[${index}]`;
    if (!isRecord(item)) {
      issues.push(`${location} must be an object`);
      continue;
    }
    if (
      typeof item.kind !== "string" ||
      !GRAPH_DIAGNOSTIC_KINDS.has(item.kind)
    ) {
      issues.push(`${location}.kind is invalid`);
    }
    const file = nonEmptyStringField(item, "file", location, issues);
    nonEmptyStringField(item, "message", location, issues);
    if (!Number.isInteger(item.line) || (item.line as number) < 1) {
      issues.push(`${location}.line must be a positive integer`);
    }
    if (file !== undefined) diagnostics.push({ file });
  }
  return { unparsedSourceFiles, diagnostics };
}

function validateEdge(
  rawEdge: unknown,
  index: number,
  nodesById: ReadonlyMap<string, NodeInfo>,
  fileIdsByPath: ReadonlyMap<string, string>,
  edgeKeys: Set<string>,
  issues: string[],
): void {
  const location = `edges[${index}]`;
  if (!isRecord(rawEdge)) {
    issues.push(`${location} must be an object`);
    return;
  }

  const source = nonEmptyStringField(rawEdge, "source", location, issues);
  const target = nonEmptyStringField(rawEdge, "target", location, issues);
  const rawType = rawEdge.type;
  const type =
    typeof rawType === "string" && EDGE_TYPES.has(rawType as EdgeType)
      ? (rawType as EdgeType)
      : undefined;

  if (type === undefined) {
    issues.push(`${location}.type is not a supported repository relationship`);
  }

  const sourceNode = source === undefined ? undefined : nodesById.get(source);
  const targetNode = target === undefined ? undefined : nodesById.get(target);

  if (source !== undefined && sourceNode === undefined) {
    issues.push(`${location}.source references missing node ${JSON.stringify(source)}`);
  }

  if (target !== undefined && targetNode === undefined) {
    issues.push(`${location}.target references missing node ${JSON.stringify(target)}`);
  }

  if (type !== undefined && sourceNode !== undefined && targetNode !== undefined) {
    validateEndpointKinds(
      type,
      source ?? "",
      sourceNode,
      targetNode,
      location,
      issues,
    );
  }

  const evidence = validateEvidence(
    rawEdge.evidence,
    location,
    fileIdsByPath,
    issues,
  );

  if (sourceNode !== undefined && evidence !== undefined) {
    const evidenceOwner = type === "TESTED_BY" ? targetNode : sourceNode;
    const evidenceFilePath =
      evidenceOwner === undefined
        ? undefined
        : owningFilePath(evidenceOwner, nodesById);
    if (evidenceFilePath !== undefined && evidence.file !== evidenceFilePath) {
      issues.push(
        `${location}.evidence.file must match the relationship evidence owner file ${JSON.stringify(evidenceFilePath)}`,
      );
    }
  }

  if (
    source !== undefined &&
    target !== undefined &&
    type !== undefined &&
    evidence !== undefined
  ) {
    const edgeKey = [
      source,
      target,
      type,
      evidence.file,
      evidence.line ?? "",
      evidence.extractor,
    ].join("\u0000");

    if (edgeKeys.has(edgeKey)) {
      issues.push(`${location} duplicates an existing evidence-bearing edge`);
    } else {
      edgeKeys.add(edgeKey);
    }
  }
}

function validateEvidence(
  value: unknown,
  edgeLocation: string,
  fileIdsByPath: ReadonlyMap<string, string>,
  issues: string[],
): { file: string; line?: number; extractor: EvidenceExtractor } | undefined {
  const location = `${edgeLocation}.evidence`;
  if (!isRecord(value)) {
    issues.push(`${location} must be an object`);
    return undefined;
  }

  const file = nonEmptyStringField(value, "file", location, issues);
  const rawExtractor = value.extractor;
  const extractor =
    typeof rawExtractor === "string" &&
    EVIDENCE_EXTRACTORS.has(rawExtractor as EvidenceExtractor)
      ? (rawExtractor as EvidenceExtractor)
      : undefined;

  if (extractor === undefined) {
    issues.push(
      `${location}.extractor must be "tree-sitter", "resolver", or "scanner"`,
    );
  }

  if (file !== undefined && !fileIdsByPath.has(file)) {
    issues.push(`${location}.file references missing file ${JSON.stringify(file)}`);
  }

  const rawLine = value.line;
  if (
    rawLine !== undefined &&
    (!Number.isInteger(rawLine) || (rawLine as number) < 1)
  ) {
    issues.push(`${location}.line must be a positive integer when present`);
  }

  if (file === undefined || extractor === undefined) {
    return undefined;
  }

  return {
    file,
    ...(typeof rawLine === "number" && Number.isInteger(rawLine) && rawLine >= 1
      ? { line: rawLine }
      : {}),
    extractor,
  };
}

function validateEndpointKinds(
  type: EdgeType,
  sourceId: string,
  source: NodeInfo,
  target: NodeInfo,
  location: string,
  issues: string[],
): void {
  if (type === "CONTAINS") {
    if (source.kind !== "file" || target.kind === "file") {
      issues.push(
        `${location} CONTAINS endpoints must be File -> Symbol or EntryPoint`,
      );
      return;
    }

    if (target.fileId !== sourceId) {
      issues.push(`${location} CONTAINS target must belong to its source File`);
    }
    return;
  }

  if (type === "IMPORTS") {
    if (source.kind !== "file" || target.kind !== "file") {
      issues.push(`${location} IMPORTS endpoints must be File -> File`);
    }
    return;
  }

  if (type === "REFERENCES") {
    if (
      (source.kind !== "file" && source.kind !== "function") ||
      target.kind === "file" ||
      target.kind === "entrypoint"
    ) {
      issues.push(
        `${location} REFERENCES endpoints must be File or Function -> Symbol`,
      );
    }
    return;
  }

  if (type === "HANDLED_BY") {
    if (source.kind !== "endpoint" || target.kind !== "function") {
      issues.push(`${location} HANDLED_BY endpoints must be Endpoint -> Function`);
    }
    return;
  }

  if (type === "VALIDATED_BY") {
    if (source.kind !== "function" || target.kind !== "schema") {
      issues.push(`${location} VALIDATED_BY endpoints must be Function -> Schema`);
    }
    return;
  }

  if (type === "TESTED_BY") {
    if (
      source.kind === "file" ||
      source.kind === "entrypoint" ||
      EVIDENCE_NODE_KINDS.has(source.kind as EvidenceNodeKind) ||
      target.kind !== "test"
    ) {
      issues.push(`${location} TESTED_BY endpoints must be Symbol -> Test`);
    }
    return;
  }

  if (type === "RENDERS") {
    if (
      !(
        (source.kind === "function" && target.kind === "function") ||
        ((source.kind === "component" || source.kind === "screen") &&
          (target.kind === "component" || target.kind === "screen"))
      )
    ) {
      issues.push(
        `${location} RENDERS endpoints must be Function -> Function or Component/Screen -> Component/Screen`,
      );
    }
    return;
  }

  if (type === "PUBLISHES" || type === "SUBSCRIBES_TO") {
    if (source.kind !== "function" || target.kind !== "event") {
      issues.push(`${location} ${type} endpoints must be Function -> Event`);
    }
    return;
  }

  if (type === "CONFIGURED_BY") {
    if (source.kind !== "file" || target.kind !== "config") {
      issues.push(`${location} CONFIGURED_BY endpoints must be File -> Config`);
    }
    return;
  }

  if (source.kind !== "function" || target.kind !== "function") {
    issues.push(`${location} CALLS endpoints must be Function -> Function`);
  }
}

function owningFilePath(
  node: NodeInfo,
  nodesById: ReadonlyMap<string, NodeInfo>,
): string | undefined {
  if (node.kind === "file") {
    return node.path;
  }

  const owner = nodesById.get(node.fileId);
  return owner?.kind === "file" ? owner.path : undefined;
}

function registerNode(
  nodesById: Map<string, NodeInfo>,
  id: string,
  node: NodeInfo,
  location: string,
  issues: string[],
): void {
  if (nodesById.has(id)) {
    issues.push(`${location}.id duplicates node ID ${JSON.stringify(id)}`);
    return;
  }

  nodesById.set(id, node);
}

function validateLineRange(
  value: unknown,
  location: string,
  issues: string[],
): void {
  if (!isRecord(value)) {
    issues.push(`${location} must be an object`);
    return;
  }

  const { start, end } = value;
  if (!Number.isInteger(start) || (start as number) < 1) {
    issues.push(`${location}.start must be a positive integer`);
  }

  if (!Number.isInteger(end) || (end as number) < 1) {
    issues.push(`${location}.end must be a positive integer`);
  }

  if (
    typeof start === "number" &&
    Number.isInteger(start) &&
    typeof end === "number" &&
    Number.isInteger(end) &&
    end < start
  ) {
    issues.push(`${location}.end must be greater than or equal to start`);
  }
}

function arrayField(
  record: Record<string, unknown>,
  field: string,
  issues: string[],
): unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`);
    return [];
  }

  return value;
}

function nonEmptyStringField(
  record: Record<string, unknown>,
  field: string,
  location: string,
  issues: string[],
): string | undefined {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    issues.push(`${location}.${field} must be a non-empty string`);
    return undefined;
  }

  return value;
}

function nonNegativeIntegerField(
  record: Record<string, unknown>,
  field: string,
  location: string,
  issues: string[],
): number | undefined {
  const value = record[field];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    issues.push(`${location}.${field} must be a non-negative safe integer`);
    return undefined;
  }
  return value as number;
}

function optionalNonEmptyStringField(
  value: Record<string, unknown>,
  field: string,
  location: string,
  issues: string[],
): string | undefined {
  if (value[field] === undefined) {
    return undefined;
  }

  return nonEmptyStringField(value, field, location, issues);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
