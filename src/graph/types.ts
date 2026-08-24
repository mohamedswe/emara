export type SymbolKind = "function" | "class" | "variable";

export type EntryPointKind =
  | "http"
  | "websocket"
  | "cli"
  | "event"
  | "scheduled"
  | "graphql"
  | "application"
  | "startup";

export type EntryPointExposure = "external" | "startup";

export type StructuralEdgeType =
  | "CONTAINS"
  | "IMPORTS"
  | "CALLS"
  | "REFERENCES";
export type EvidenceNodeKind =
  | "endpoint"
  | "component"
  | "screen"
  | "schema"
  | "config"
  | "test"
  | "event";

export type SemanticEdgeType =
  | "HANDLED_BY"
  | "VALIDATED_BY"
  | "TESTED_BY"
  | "RENDERS"
  | "PUBLISHES"
  | "SUBSCRIBES_TO"
  | "CONFIGURED_BY";

export type EdgeType = StructuralEdgeType | SemanticEdgeType;

export type EvidenceExtractor = "tree-sitter" | "resolver" | "scanner";

export interface FileNode {
  id: string;
  type: "file";
  path: string;
  language: string;
  contentHash: string;
  lineRange?: {
    start: number;
    end: number;
  };
}

export interface SymbolNode {
  id: string;
  type: SymbolKind;
  name: string;
  fileId: string;
  lineRange: {
    start: number;
    end: number;
  };
  exported: boolean;
}

export interface EntryPointNode {
  id: string;
  type: "entrypoint";
  kind: EntryPointKind;
  name: string;
  exposure: EntryPointExposure;
  httpMethod?: string;
  route?: string;
  fileId: string;
  handlerSymbolId?: string;
  lineRange: {
    start: number;
    end: number;
  };
  evidence: Evidence;
}

interface EvidenceNodeBase {
  id: string;
  type: EvidenceNodeKind;
  name: string;
  fileId: string;
  lineRange: { start: number; end: number };
  evidence: Evidence;
}

export interface EndpointNode extends EvidenceNodeBase {
  type: "endpoint";
  entrypointId: string;
  kind: EntryPointKind;
  httpMethod?: string;
  route?: string;
}

export interface ComponentNode extends EvidenceNodeBase {
  type: "component" | "screen";
  symbolId: string;
}

export interface SchemaNode extends EvidenceNodeBase {
  type: "schema";
  symbolId: string;
}

export interface ConfigNode extends EvidenceNodeBase {
  type: "config";
  symbolId: string;
}

export interface TestNode extends EvidenceNodeBase {
  type: "test";
}

export interface EventNode extends EvidenceNodeBase {
  type: "event";
  operation: "publish" | "subscribe";
}

export type EvidenceGraphNode =
  | EndpointNode
  | ComponentNode
  | SchemaNode
  | ConfigNode
  | TestNode
  | EventNode;

export type RepositoryNode =
  | FileNode
  | SymbolNode
  | EntryPointNode
  | EvidenceGraphNode;

export interface Evidence {
  file: string;
  line?: number;
  extractor: EvidenceExtractor;
}

export interface Edge {
  source: string;
  target: string;
  type: EdgeType;
  evidence: Evidence;
}

export interface RepositoryGraphDiagnostic {
  kind:
    | "parse-error"
    | "parse-missing"
    | "unresolved-decorator"
    | "unresolved-registration";
  message: string;
  file: string;
  line: number;
}

export interface RepositoryGraphAnalysis {
  sourceFileCount: number;
  parsedSourceFileCount: number;
  unparsedSourceFiles: string[];
  diagnostics: RepositoryGraphDiagnostic[];
}

export interface RepositoryGraph {
  version: 4;
  analysis: RepositoryGraphAnalysis;
  files: FileNode[];
  symbols: SymbolNode[];
  entrypoints: EntryPointNode[];
  entities: EvidenceGraphNode[];
  edges: Edge[];
}
