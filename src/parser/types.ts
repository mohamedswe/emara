export interface LineRange {
  start: number;
  end: number;
}

export type ParsedLanguage = "javascript" | "python" | "typescript" | "tsx";

export interface ParsedSymbol {
  type: "function" | "class" | "variable";
  name: string;
  exported: boolean;
  lineRange: LineRange;
}

export type ParsedImportKind =
  | "commonjs"
  | "default"
  | "dynamic"
  | "named"
  | "namespace"
  | "side-effect";

export interface ParsedImport {
  kind: ParsedImportKind;
  source: string;
  importedName?: string;
  localName?: string;
  typeOnly: boolean;
  lineRange: LineRange;
}

export type ParsedExportKind = "named" | "default" | "all" | "namespace";

export interface ParsedExport {
  kind: ParsedExportKind;
  exportedName: string;
  localName?: string;
  source?: string;
  typeOnly: boolean;
  lineRange: LineRange;
}

export type ParsedCallKind = "identifier" | "member" | "other";

export interface ParsedCall {
  callee: string;
  kind: ParsedCallKind;
  caller?: string;
  importedLocalName?: string;
  localTargetName?: string;
  lineRange: LineRange;
}

export type ParsedEntryPointKind =
  | "http"
  | "websocket"
  | "cli"
  | "event"
  | "scheduled"
  | "graphql"
  | "application"
  | "startup";

export type ParsedEntryPointExposure = "external" | "startup";

export interface ParsedEntryPoint {
  kind: ParsedEntryPointKind;
  name: string;
  exposure: ParsedEntryPointExposure;
  httpMethod?: string;
  route?: string;
  handlerName?: string;
  lineRange: LineRange;
}

export interface ParsedEvent {
  name: string;
  operation: "publish" | "subscribe";
  ownerName?: string;
  lineRange: LineRange;
}

export interface ParsedRender {
  componentName: string;
  ownerName?: string;
  lineRange: LineRange;
}

export interface ParsedReference {
  targetName: string;
  ownerName?: string;
  importedLocalName?: string;
  lineRange: LineRange;
}

export interface ParseDiagnostic {
  kind: "error" | "missing";
  nodeType: string;
  lineRange: LineRange;
}

export interface ParsedSourceFile {
  path: string;
  language: ParsedLanguage;
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  exports: ParsedExport[];
  calls: ParsedCall[];
  entrypoints: ParsedEntryPoint[];
  events: ParsedEvent[];
  renders: ParsedRender[];
  references?: ParsedReference[];
  diagnostics: ParseDiagnostic[];
  detectedFrameworks?: string[];
  frameworkDiagnostics?: Array<{
    kind: "unresolved-decorator" | "unresolved-registration";
    message: string;
    lineRange: LineRange;
  }>;
}
