import type {
  ParsedImport,
  ParsedSourceFile,
} from "../parser/types.js";
import {
  resolveInternalModulePath,
  type InternalModuleResolutionOptions,
} from "./resolveInternalImports.ts";
import type { Edge, FileNode, SymbolNode } from "./types.js";

export function resolveSymbolReferenceEdges(
  files: readonly FileNode[],
  symbols: readonly SymbolNode[],
  parsedFiles: readonly ParsedSourceFile[],
  options: InternalModuleResolutionOptions = {},
): Edge[] {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const filePaths = new Set(filesByPath.keys());
  const parsedFilesByPath = new Map(parsedFiles.map((file) => [file.path, file]));
  const symbolsByFileId = new Map<string, SymbolNode[]>();
  for (const symbol of symbols) {
    const values = symbolsByFileId.get(symbol.fileId) ?? [];
    values.push(symbol);
    symbolsByFileId.set(symbol.fileId, values);
  }

  const edges: Edge[] = [];
  const keys = new Set<string>();
  for (const parsedFile of [...parsedFiles].sort(compareParsedFiles)) {
    const sourceFile = filesByPath.get(parsedFile.path);
    if (sourceFile === undefined) continue;

    for (const parsedImport of [...parsedFile.imports].sort(compareImports)) {
      const importedName = exactImportedName(parsedImport);
      if (importedName === undefined) continue;

      const targetPath = resolveInternalModulePath(
        parsedFile.path,
        parsedImport.source,
        filePaths,
        options,
      );
      if (targetPath === undefined || targetPath === parsedFile.path) continue;

      const targetFile = filesByPath.get(targetPath);
      const targetParsedFile = parsedFilesByPath.get(targetPath);
      if (targetFile === undefined || targetParsedFile === undefined) continue;

      const target = resolveExportedSymbol(
        targetParsedFile,
        symbolsByFileId.get(targetFile.id) ?? [],
        importedName,
      );
      if (target === undefined) continue;

      const edge: Edge = {
        source: sourceFile.id,
        target: target.id,
        type: "REFERENCES",
        evidence: {
          file: parsedFile.path,
          line: parsedImport.lineRange.start,
          extractor: "resolver",
        },
      };
      const key = edgeKey(edge);
      if (!keys.has(key)) {
        keys.add(key);
        edges.push(edge);
      }
    }

    for (const entrypoint of parsedFile.entrypoints) {
      if (
        entrypoint.name !== "React render" ||
        entrypoint.handlerName === undefined
      ) {
        continue;
      }
      const fileSymbols = symbolsByFileId.get(sourceFile.id) ?? [];
      const localTarget = uniqueReactComponent(fileSymbols, entrypoint.handlerName);
      const importedTarget = resolveImportedReference(
        parsedFile,
        entrypoint.handlerName,
        entrypoint.handlerName,
        filePaths,
        filesByPath,
        parsedFilesByPath,
        symbolsByFileId,
        options,
      );
      const targets = [localTarget, importedTarget].filter(
        (target): target is SymbolNode => target !== undefined,
      );
      const target = targets[0];
      if (target === undefined || targets.length !== 1) continue;

      const edge: Edge = {
        source: sourceFile.id,
        target: target.id,
        type: "REFERENCES",
        evidence: {
          file: parsedFile.path,
          line: entrypoint.lineRange.start,
          extractor: "tree-sitter",
        },
      };
      const key = edgeKey(edge);
      if (!keys.has(key)) {
        keys.add(key);
        edges.push(edge);
      }
    }

    for (const reference of parsedFile.references ?? []) {
      if (reference.ownerName === undefined) continue;
      const fileSymbols = symbolsByFileId.get(sourceFile.id) ?? [];
      const owner = uniqueSymbol(fileSymbols, reference.ownerName);
      const target = reference.importedLocalName === undefined
        ? uniqueSymbol(fileSymbols, reference.targetName)
        : resolveImportedReference(
            parsedFile,
            reference.targetName,
            reference.importedLocalName,
            filePaths,
            filesByPath,
            parsedFilesByPath,
            symbolsByFileId,
            options,
          );
      if (owner === undefined || target === undefined || owner.id === target.id) continue;
      const edge: Edge = {
        source: owner.id,
        target: target.id,
        type: "REFERENCES",
        evidence: {
          file: parsedFile.path,
          line: reference.lineRange.start,
          extractor: "tree-sitter",
        },
      };
      const key = edgeKey(edge);
      if (!keys.has(key)) {
        keys.add(key);
        edges.push(edge);
      }
    }
  }

  return edges;
}

function resolveImportedReference(
  parsedFile: ParsedSourceFile,
  targetName: string,
  importedLocalName: string,
  filePaths: ReadonlySet<string>,
  filesByPath: ReadonlyMap<string, FileNode>,
  parsedFilesByPath: ReadonlyMap<string, ParsedSourceFile>,
  symbolsByFileId: ReadonlyMap<string, SymbolNode[]>,
  options: InternalModuleResolutionOptions,
): SymbolNode | undefined {
  const imports = parsedFile.imports.filter(
    (parsedImport) =>
      !parsedImport.typeOnly && parsedImport.localName === importedLocalName,
  );
  if (imports.length !== 1) return undefined;
  const parsedImport = imports[0];
  if (parsedImport === undefined) return undefined;
  const targetPath = resolveInternalModulePath(
    parsedFile.path,
    parsedImport.source,
    filePaths,
    options,
  );
  if (targetPath === undefined || targetPath === parsedFile.path) return undefined;
  const targetFile = filesByPath.get(targetPath);
  const targetParsedFile = parsedFilesByPath.get(targetPath);
  if (targetFile === undefined || targetParsedFile === undefined) return undefined;
  const targetSymbols = symbolsByFileId.get(targetFile.id) ?? [];

  if (targetName === importedLocalName) {
    const importedName = exactImportedName(parsedImport);
    return importedName === undefined
      ? undefined
      : resolveExportedSymbol(targetParsedFile, targetSymbols, importedName);
  }

  const prefix = `${importedLocalName}.`;
  if (
    parsedImport.kind !== "named" ||
    parsedImport.importedName === undefined ||
    !targetName.startsWith(prefix)
  ) {
    return undefined;
  }
  const memberName = targetName.slice(prefix.length);
  if (memberName.length === 0 || /[.\[\]?]/u.test(memberName)) return undefined;
  return resolveExportedInstanceMethod(
    targetParsedFile,
    targetSymbols,
    parsedImport.importedName,
    memberName,
  );
}

function resolveExportedInstanceMethod(
  parsedFile: ParsedSourceFile,
  symbols: readonly SymbolNode[],
  exportedVariableName: string,
  memberName: string,
): SymbolNode | undefined {
  const exportedVariable = resolveExportedSymbol(
    parsedFile,
    symbols,
    exportedVariableName,
  );
  if (exportedVariable?.type !== "variable") return undefined;
  const constructors = parsedFile.calls.filter((call) =>
    call.caller === undefined &&
    call.kind === "identifier" &&
    call.lineRange.start >= exportedVariable.lineRange.start &&
    call.lineRange.end <= exportedVariable.lineRange.end &&
    !/[.\[\]?]/u.test(call.callee)
  );
  if (constructors.length !== 1) return undefined;
  const className = constructors[0]?.callee;
  if (className === undefined) return undefined;
  if (symbols.filter((symbol) => symbol.type === "class" && symbol.name === className).length !== 1) {
    return undefined;
  }
  return uniqueSymbol(symbols, `${className}.${memberName}`);
}

function uniqueSymbol(
  symbols: readonly SymbolNode[],
  name: string,
): SymbolNode | undefined {
  const candidates = symbols.filter((symbol) => symbol.name === name);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function uniqueReactComponent(
  symbols: readonly SymbolNode[],
  name: string,
): SymbolNode | undefined {
  const candidates = symbols.filter(
    (symbol) =>
      (symbol.type === "function" || symbol.type === "class") &&
      symbol.name === name,
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function exactImportedName(parsedImport: ParsedImport): string | undefined {
  if (parsedImport.typeOnly) return undefined;
  if (parsedImport.kind === "default") return "default";
  if (parsedImport.kind === "named") return parsedImport.importedName;
  if (
    parsedImport.kind === "commonjs" &&
    parsedImport.importedName !== "*"
  ) {
    return parsedImport.importedName;
  }
  return undefined;
}

function resolveExportedSymbol(
  parsedFile: ParsedSourceFile,
  symbols: readonly SymbolNode[],
  exportedName: string,
): SymbolNode | undefined {
  const exports = parsedFile.exports.filter(
    (entry) =>
      !entry.typeOnly &&
      entry.source === undefined &&
      entry.exportedName === exportedName,
  );
  const localNames =
    exports.length > 0
      ? new Set(exports.map((entry) => entry.localName ?? exportedName))
      : exportedName === "default"
        ? new Set(["default"])
        : undefined;
  if (localNames === undefined) return undefined;

  const candidates = symbols.filter(
    (symbol) => symbol.exported && localNames.has(symbol.name),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function edgeKey(edge: Edge): string {
  return [
    edge.source,
    edge.target,
    edge.type,
    edge.evidence.file,
    edge.evidence.line ?? "",
    edge.evidence.extractor,
  ].join("\u0000");
}

function compareParsedFiles(left: ParsedSourceFile, right: ParsedSourceFile): number {
  return compareText(left.path, right.path);
}

function compareImports(left: ParsedImport, right: ParsedImport): number {
  return (
    left.lineRange.start - right.lineRange.start ||
    left.lineRange.end - right.lineRange.end ||
    compareText(left.source, right.source) ||
    compareText(left.importedName ?? "", right.importedName ?? "")
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
