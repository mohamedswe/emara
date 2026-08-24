import type {
  ParsedEntryPointKind,
  ParsedLanguage,
  ParsedSourceFile,
} from "../parser/types.js";

export type FrameworkSupportLevel = "baseline" | "entrypoints" | "semantic";

export interface FrameworkDetectionRules {
  packageNames?: readonly string[];
  importPrefixes?: readonly string[];
  pathPatterns?: readonly RegExp[];
}

export interface JavaScriptFrameworkConventions {
  httpFactoryNames?: readonly string[];
  httpReceivers?: readonly string[];
  httpMethods?: readonly string[];
  websocketMethods?: readonly string[];
  cliReceivers?: readonly string[];
  eventReceivers?: readonly string[];
  eventSubscribeMethods?: readonly string[];
  eventPublishMethods?: readonly string[];
  scheduleReceivers?: readonly string[];
  scheduleMethods?: readonly string[];
  graphqlReceivers?: readonly string[];
  graphqlMethods?: Readonly<Record<string, string>>;
  startupReceivers?: readonly string[];
  startupSymbolNames?: readonly string[];
  exportedApplicationHandlerNames?: readonly string[];
  httpDecorators?: Readonly<Record<string, string>>;
  graphqlDecorators?: Readonly<Record<string, string>>;
  scheduleDecorators?: readonly string[];
  eventDecorators?: readonly string[];
  lifecycleExports?: readonly JavaScriptLifecycleExportConvention[];
}

export interface JavaScriptLifecycleExportConvention {
  pathPattern: RegExp;
  exportedNames: readonly string[];
  namePrefix: string;
}

export interface PythonDecoratorConvention {
  decorator: string;
  kind: ParsedEntryPointKind;
  httpMethod?: string;
  namePrefix?: string;
}

export interface PythonCallConvention {
  callee: string;
  kind: ParsedEntryPointKind;
  httpMethod?: string;
  namePrefix?: string;
  handlerArgumentIndex?: number;
}

export interface PythonFrameworkConventions {
  applicationFactoryNames?: readonly string[];
  decorators?: readonly PythonDecoratorConvention[];
  calls?: readonly PythonCallConvention[];
  startupSymbolNames?: readonly string[];
  exportedApplicationHandlerNames?: readonly string[];
}

export interface FrameworkPack {
  id: string;
  displayName: string;
  family: string;
  languages: readonly ParsedLanguage[];
  support: FrameworkSupportLevel;
  versionPolicy?: "major-fixtures" | "syntax-stable";
  detection: FrameworkDetectionRules;
  javascript?: JavaScriptFrameworkConventions;
  python?: PythonFrameworkConventions;
  notes?: readonly string[];
}

export interface DetectedFramework {
  id: string;
  displayName: string;
  family: string;
  support: FrameworkSupportLevel;
  evidence: readonly string[];
}

export interface FrameworkDiagnostic {
  kind:
    | "parse-error"
    | "parse-missing"
    | "unresolved-decorator"
    | "unresolved-registration";
  message: string;
  file: string;
  line: number;
}

export interface RepositorySupportReport {
  languages: Readonly<Record<string, number>>;
  parsedFiles: number;
  unparsedSourceFiles: readonly string[];
  frameworks: readonly DetectedFramework[];
  diagnostics: readonly FrameworkDiagnostic[];
  supportDefinition: {
    baseline: string;
    entrypoints: string;
    semantic: string;
  };
}

export interface FrameworkDetectionInput {
  parsedFiles: readonly ParsedSourceFile[];
  scannedPaths: readonly string[];
  packageNames?: ReadonlySet<string>;
}
