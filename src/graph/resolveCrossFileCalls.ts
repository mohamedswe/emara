import type {
  ParsedCall,
  ParsedImport,
  ParsedSourceFile,
} from "../parser/types.js";
import {
  resolveInternalModulePath,
  type InternalModuleResolutionOptions,
} from "./resolveInternalImports.ts";
import type { Edge, FileNode, SymbolNode } from "./types.js";

export function resolveCrossFileCallEdges(
  files: readonly FileNode[],
  symbols: readonly SymbolNode[],
  parsedFiles: readonly ParsedSourceFile[],
  options: InternalModuleResolutionOptions = {},
): Edge[] {
  const filesByPath = indexFilesByPath(files);
  const filePaths = new Set(filesByPath.keys());
  const parsedFilesByPath = indexParsedFilesByPath(parsedFiles);
  const symbolsByFileId = indexSymbolsByFileId(symbols);
  const edges: Edge[] = [];
  const edgeKeys = new Set<string>();

  for (const parsedFile of [...parsedFiles].sort(compareParsedFiles)) {
    const sourceFile = filesByPath.get(parsedFile.path);
    if (sourceFile === undefined) {
      continue;
    }

    for (const call of [...parsedFile.calls].sort(compareCalls)) {
      if (call.caller === undefined) {
        continue;
      }

      const caller = uniqueFunctionSymbol(
        symbolsByFileId.get(sourceFile.id) ?? [],
        call.caller,
      );
      if (caller === undefined) {
        continue;
      }

      if (call.localTargetName !== undefined) {
        const target = uniqueFunctionSymbol(
          symbolsByFileId.get(sourceFile.id) ?? [],
          call.localTargetName,
        );
        if (target !== undefined && target.id !== caller.id) {
          addCallEdge(edges, edgeKeys, caller, target, parsedFile, call);
        }
        continue;
      }

      const localMethodTarget = resolveLocalMethodCall(
        symbolsByFileId.get(sourceFile.id) ?? [],
        call,
      );
      if (localMethodTarget !== undefined && localMethodTarget.id !== caller.id) {
        addCallEdge(
          edges,
          edgeKeys,
          caller,
          localMethodTarget,
          parsedFile,
          call,
        );
        continue;
      }

      const localCommonJsTarget = resolveLocalCommonJsExportCall(
        symbolsByFileId.get(sourceFile.id) ?? [],
        call,
      );
      if (localCommonJsTarget !== undefined && localCommonJsTarget.id !== caller.id) {
        addCallEdge(
          edges,
          edgeKeys,
          caller,
          localCommonJsTarget,
          parsedFile,
          call,
        );
        continue;
      }

      if (call.importedLocalName === undefined) continue;

      const matchingImports = parsedFile.imports.filter(
        (parsedImport) =>
          !parsedImport.typeOnly &&
          parsedImport.localName === call.importedLocalName,
      );
      if (matchingImports.length !== 1) {
        continue;
      }

      const parsedImport = matchingImports[0];
      if (parsedImport === undefined) {
        continue;
      }

      const importedCall = importedTargetForCall(call, parsedImport);
      if (importedCall === undefined) {
        continue;
      }

      const targetPath = resolveInternalModulePath(
        parsedFile.path,
        parsedImport.source,
        filePaths,
        options,
      );
      if (targetPath === undefined || targetPath === parsedFile.path) {
        continue;
      }

      const targetFile = filesByPath.get(targetPath);
      const targetParsedFile = parsedFilesByPath.get(targetPath);
      if (targetFile === undefined || targetParsedFile === undefined) {
        continue;
      }

      const targetSymbols = symbolsByFileId.get(targetFile.id) ?? [];
      const target = importedCall.memberName === undefined
        ? resolveExportedFunction(
            targetParsedFile,
            targetSymbols,
            importedCall.exportedName,
          )
        : resolveExportedMemberFunction(
            targetParsedFile,
            targetSymbols,
            importedCall.exportedName,
            importedCall.memberName,
          );
      if (target === undefined) {
        continue;
      }

      addCallEdge(edges, edgeKeys, caller, target, parsedFile, call);
    }
  }

  return edges;
}

function addCallEdge(
  edges: Edge[],
  edgeKeys: Set<string>,
  caller: SymbolNode,
  target: SymbolNode,
  parsedFile: ParsedSourceFile,
  call: ParsedCall,
): void {
  const edge: Edge = {
    source: caller.id,
    target: target.id,
    type: "CALLS",
    evidence: {
      file: parsedFile.path,
      line: call.lineRange.start,
      extractor: "resolver",
    },
  };
  const edgeKey = callEdgeKey(edge);
  if (!edgeKeys.has(edgeKey)) {
    edgeKeys.add(edgeKey);
    edges.push(edge);
  }
}

interface ImportedCallTarget {
  exportedName: string;
  memberName?: string;
}

function importedTargetForCall(
  call: ParsedCall,
  parsedImport: ParsedImport,
): ImportedCallTarget | undefined {
  if (
    call.kind === "identifier" &&
    call.callee === parsedImport.localName
  ) {
    if (parsedImport.kind === "default") {
      return { exportedName: "default" };
    }

    if (
      parsedImport.kind === "named" ||
      (parsedImport.kind === "commonjs" &&
        parsedImport.importedName !== "*")
    ) {
      return parsedImport.importedName === undefined
        ? undefined
        : { exportedName: parsedImport.importedName };
    }

    return undefined;
  }

  if (call.kind !== "member") {
    return undefined;
  }

  const prefix = `${parsedImport.localName}.`;
  if (!call.callee.startsWith(prefix)) {
    return undefined;
  }

  const memberPath = simpleMemberPath(call.callee.slice(prefix.length));
  if (memberPath === undefined) return undefined;

  if (
    parsedImport.kind === "namespace" ||
    (parsedImport.kind === "commonjs" && parsedImport.importedName === "*")
  ) {
    if (memberPath.length === 1) {
      return { exportedName: memberPath[0] as string };
    }
    if (memberPath.length === 2) {
      return {
        exportedName: memberPath[0] as string,
        memberName: memberPath[1] as string,
      };
    }
    return undefined;
  }

  if (
    memberPath.length === 1 &&
    parsedImport.kind === "named" &&
    parsedImport.importedName !== undefined
  ) {
    return {
      exportedName: parsedImport.importedName,
      memberName: memberPath[0] as string,
    };
  }

  if (memberPath.length === 1 && parsedImport.kind === "default") {
    return { exportedName: "default", memberName: memberPath[0] as string };
  }

  return undefined;
}

function simpleMemberName(value: string): string | undefined {
  return value.length > 0 && !/[.\[\]?]/u.test(value) ? value : undefined;
}

function simpleMemberPath(value: string): string[] | undefined {
  const parts = value.split(".");
  return parts.length > 0 && parts.every((part) => simpleMemberName(part) !== undefined)
    ? parts
    : undefined;
}

function resolveLocalMethodCall(
  symbols: readonly SymbolNode[],
  call: ParsedCall,
): SymbolNode | undefined {
  if (call.kind !== "member" || call.caller === undefined) return undefined;
  const separator = call.caller.lastIndexOf(".");
  if (separator <= 0) return undefined;

  const receiverSeparator = call.callee.indexOf(".");
  if (receiverSeparator <= 0) return undefined;
  const receiver = call.callee.slice(0, receiverSeparator);
  if (receiver !== "self" && receiver !== "cls") return undefined;

  const memberName = simpleMemberName(call.callee.slice(receiverSeparator + 1));
  if (memberName === undefined) return undefined;
  return uniqueFunctionSymbol(
    symbols,
    `${call.caller.slice(0, separator)}.${memberName}`,
  );
}

function resolveLocalCommonJsExportCall(
  symbols: readonly SymbolNode[],
  call: ParsedCall,
): SymbolNode | undefined {
  if (call.kind !== "member") return undefined;
  const match = /^(?:exports|module\.exports)\.([A-Za-z_$][\w$]*)$/u.exec(
    call.callee,
  );
  const name = match?.[1];
  if (name === undefined) return undefined;
  const candidates = symbols.filter(
    (symbol) =>
      symbol.type === "function" && symbol.exported && symbol.name === name,
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function resolveExportedMemberFunction(
  parsedFile: ParsedSourceFile,
  symbols: readonly SymbolNode[],
  exportedOwnerName: string,
  memberName: string,
): SymbolNode | undefined {
  const exportedClass = resolveExportedSymbol(
    parsedFile,
    symbols,
    exportedOwnerName,
    "class",
  );
  if (exportedClass !== undefined) {
    return uniqueFunctionSymbol(
      symbols,
      `${exportedClass.name}.${memberName}`,
    );
  }

  const exportedVariable = resolveExportedSymbol(
    parsedFile,
    symbols,
    exportedOwnerName,
    "variable",
  );
  if (exportedVariable === undefined) return undefined;

  const constructors = parsedFile.calls.filter((call) =>
    call.caller === undefined &&
    call.kind === "identifier" &&
    call.lineRange.start >= exportedVariable.lineRange.start &&
    call.lineRange.end <= exportedVariable.lineRange.end &&
    !/[.\[\]?]/u.test(call.callee)
  );
  if (constructors.length !== 1) return undefined;

  const constructor = constructors[0];
  if (constructor === undefined) return undefined;
  const classes = symbols.filter(
    (symbol) => symbol.type === "class" && symbol.name === constructor.callee,
  );
  if (classes.length !== 1) return undefined;

  return uniqueFunctionSymbol(
    symbols,
    `${constructor.callee}.${memberName}`,
  );
}

function resolveExportedFunction(
  parsedFile: ParsedSourceFile,
  symbols: readonly SymbolNode[],
  exportedName: string,
): SymbolNode | undefined {
  return resolveExportedSymbol(parsedFile, symbols, exportedName, "function");
}

function resolveExportedSymbol(
  parsedFile: ParsedSourceFile,
  symbols: readonly SymbolNode[],
  exportedName: string,
  symbolType: SymbolNode["type"],
): SymbolNode | undefined {
  const matchingExports = parsedFile.exports.filter(
    (parsedExport) =>
      !parsedExport.typeOnly &&
      parsedExport.source === undefined &&
      parsedExport.exportedName === exportedName,
  );
  let localNames: Set<string>;

  if (matchingExports.length > 0) {
    localNames = new Set(
      matchingExports.map(
        (parsedExport) => parsedExport.localName ?? exportedName,
      ),
    );
  } else if (exportedName === "default") {
    localNames = new Set(["default"]);
  } else {
    return undefined;
  }

  const candidates = symbols.filter(
    (symbol) =>
      symbol.type === symbolType &&
      symbol.exported &&
      localNames.has(symbol.name),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function uniqueFunctionSymbol(
  symbols: readonly SymbolNode[],
  name: string,
): SymbolNode | undefined {
  const candidates = symbols.filter(
    (symbol) => symbol.type === "function" && symbol.name === name,
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function indexFilesByPath(files: readonly FileNode[]): Map<string, FileNode> {
  const result = new Map<string, FileNode>();

  for (const file of files) {
    if (result.has(file.path)) {
      throw new Error(`Duplicate file path during call resolution: ${file.path}`);
    }

    result.set(file.path, file);
  }

  return result;
}

function indexParsedFilesByPath(
  parsedFiles: readonly ParsedSourceFile[],
): Map<string, ParsedSourceFile> {
  const result = new Map<string, ParsedSourceFile>();

  for (const parsedFile of parsedFiles) {
    if (result.has(parsedFile.path)) {
      throw new Error(
        `Duplicate parsed file path during call resolution: ${parsedFile.path}`,
      );
    }

    result.set(parsedFile.path, parsedFile);
  }

  return result;
}

function indexSymbolsByFileId(
  symbols: readonly SymbolNode[],
): Map<string, SymbolNode[]> {
  const result = new Map<string, SymbolNode[]>();

  for (const symbol of symbols) {
    const fileSymbols = result.get(symbol.fileId) ?? [];
    fileSymbols.push(symbol);
    result.set(symbol.fileId, fileSymbols);
  }

  return result;
}

function callEdgeKey(edge: Edge): string {
  return [
    edge.source,
    edge.target,
    edge.type,
    edge.evidence.file,
    edge.evidence.line ?? "",
    edge.evidence.extractor,
  ].join("\u0000");
}

function compareParsedFiles(
  left: ParsedSourceFile,
  right: ParsedSourceFile,
): number {
  return compareStrings(left.path, right.path);
}

function compareCalls(left: ParsedCall, right: ParsedCall): number {
  return (
    left.lineRange.start - right.lineRange.start ||
    left.lineRange.end - right.lineRange.end ||
    compareStrings(left.caller ?? "", right.caller ?? "") ||
    compareStrings(left.callee, right.callee)
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
