import { posix } from "node:path";

import type {
  LineRange,
  ParsedSourceFile,
} from "../parser/types.js";
import type { Edge, FileNode } from "./types.js";

const MODULE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".d.ts",
  ".d.mts",
  ".d.cts",
  ".json",
  ".astro",
  ".svelte",
  ".vue",
] as const;

const TYPESCRIPT_SUBSTITUTIONS: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx", ".d.ts", ".js", ".jsx"],
  ".jsx": [".tsx", ".d.ts", ".jsx"],
  ".mjs": [".mts", ".d.mts", ".mjs"],
  ".cjs": [".cts", ".d.cts", ".cjs"],
};

interface ModuleReference {
  source: string;
  lineRange: LineRange;
}

export interface TypeScriptModuleResolutionConfig {
  directory: string;
  baseUrl: string;
  paths: Readonly<Record<string, readonly string[]>>;
}

export interface InternalModuleResolutionOptions {
  typeScriptConfigs?: readonly TypeScriptModuleResolutionConfig[];
}

export function resolveInternalImportEdges(
  files: readonly FileNode[],
  parsedFiles: readonly ParsedSourceFile[],
  options: InternalModuleResolutionOptions = {},
): Edge[] {
  const filesByPath = indexFilesByPath(files);
  const filePaths = new Set(filesByPath.keys());
  const edges: Edge[] = [];
  const edgeKeys = new Set<string>();

  for (const parsedFile of [...parsedFiles].sort(compareParsedFiles)) {
    const sourceFile = filesByPath.get(parsedFile.path);
    if (sourceFile === undefined) {
      continue;
    }

    for (const reference of moduleReferences(parsedFile)) {
      const targetPath = resolveInternalModulePath(
        parsedFile.path,
        reference.source,
        filePaths,
        options,
      );
      if (targetPath === undefined) {
        continue;
      }

      const targetFile = filesByPath.get(targetPath);
      if (targetFile === undefined) {
        continue;
      }

      const edge: Edge = {
        source: sourceFile.id,
        target: targetFile.id,
        type: "IMPORTS",
        evidence: {
          file: parsedFile.path,
          line: reference.lineRange.start,
          extractor: "resolver",
        },
      };
      const edgeKey = importEdgeKey(edge);

      if (!edgeKeys.has(edgeKey)) {
        edgeKeys.add(edgeKey);
        edges.push(edge);
      }
    }
  }

  return edges;
}

function indexFilesByPath(files: readonly FileNode[]): Map<string, FileNode> {
  const filesByPath = new Map<string, FileNode>();

  for (const file of files) {
    if (filesByPath.has(file.path)) {
      throw new Error(`Duplicate file path during import resolution: ${file.path}`);
    }

    filesByPath.set(file.path, file);
  }

  return filesByPath;
}

function moduleReferences(parsedFile: ParsedSourceFile): ModuleReference[] {
  const references: ModuleReference[] = parsedFile.imports.map(
    ({ source, lineRange }) => ({ source, lineRange }),
  );

  for (const parsedExport of parsedFile.exports) {
    if (parsedExport.source !== undefined) {
      references.push({
        source: parsedExport.source,
        lineRange: parsedExport.lineRange,
      });
    }
  }

  return references.sort(compareModuleReferences);
}

export function resolveInternalModulePath(
  importerPath: string,
  specifier: string,
  filePaths: ReadonlySet<string>,
  options: InternalModuleResolutionOptions = {},
): string | undefined {
  if (/\.pyi?$/iu.test(importerPath)) {
    return resolvePythonModulePath(importerPath, specifier, filePaths);
  }

  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return resolveConfiguredTypeScriptPath(
      importerPath,
      specifier,
      filePaths,
      options.typeScriptConfigs ?? [],
    );
  }

  const basePath = posix.normalize(
    posix.join(posix.dirname(importerPath), specifier),
  );
  if (
    posix.isAbsolute(basePath) ||
    basePath === ".." ||
    basePath.startsWith("../")
  ) {
    return undefined;
  }

  return resolveJavaScriptBasePath(basePath, filePaths);
}

function resolveJavaScriptBasePath(
  basePath: string,
  filePaths: ReadonlySet<string>,
): string | undefined {
  const explicitExtension = posix.extname(basePath);
  if (explicitExtension !== "") {
    return uniqueExistingPath(
      explicitModuleCandidates(basePath, explicitExtension),
      filePaths,
    );
  }

  if (filePaths.has(basePath)) {
    return basePath;
  }

  const fileMatches = existingPaths(
    MODULE_EXTENSIONS.map((extension) => `${basePath}${extension}`),
    filePaths,
  );
  if (fileMatches.length > 0) {
    return fileMatches.length === 1 ? fileMatches[0] : undefined;
  }

  return uniqueExistingPath(
    MODULE_EXTENSIONS.map(
      (extension) => `${basePath}/index${extension}`,
    ),
    filePaths,
  );
}

function resolvePythonModulePath(
  importerPath: string,
  specifier: string,
  filePaths: ReadonlySet<string>,
): string | undefined {
  const relativePrefix = /^\.+/u.exec(specifier)?.[0] ?? "";
  const moduleName = specifier.slice(relativePrefix.length);
  let baseDirectory = "";

  if (relativePrefix.length > 0) {
    baseDirectory = posix.dirname(importerPath);
    for (let level = 1; level < relativePrefix.length; level += 1) {
      baseDirectory = posix.dirname(baseDirectory);
    }
    if (baseDirectory === ".") baseDirectory = "";
  }

  const modulePath = moduleName.split(".").filter(Boolean).join("/");
  const basePath = posix.normalize(
    baseDirectory.length === 0
      ? modulePath
      : posix.join(baseDirectory, modulePath),
  );
  if (
    basePath.length === 0 ||
    posix.isAbsolute(basePath) ||
    basePath === ".." ||
    basePath.startsWith("../")
  ) {
    return undefined;
  }

  const directCandidates = pythonModuleCandidates(basePath);
  if (relativePrefix.length > 0) {
    return uniqueExistingPath(directCandidates, filePaths);
  }

  const suffixes = directCandidates.map((candidate) => `/${candidate}`);
  const sourceRootCandidates = [...filePaths].filter((path) =>
    directCandidates.includes(path) || suffixes.some((suffix) => path.endsWith(suffix))
  );
  return uniqueExistingPath(sourceRootCandidates, filePaths);
}

function pythonModuleCandidates(basePath: string): string[] {
  return [
    `${basePath}.py`,
    `${basePath}.pyi`,
    `${basePath}/__init__.py`,
    `${basePath}/__init__.pyi`,
  ];
}

function resolveConfiguredTypeScriptPath(
  importerPath: string,
  specifier: string,
  filePaths: ReadonlySet<string>,
  configs: readonly TypeScriptModuleResolutionConfig[],
): string | undefined {
  const applicable = configs
    .filter((config) => pathIsInside(importerPath, config.directory))
    .sort(
      (left, right) =>
        right.directory.length - left.directory.length ||
        compareStrings(left.directory, right.directory),
    );

  for (const config of applicable) {
    const mapped = mappedTypeScriptCandidates(specifier, config);
    if (mapped.matched) {
      return uniqueResolvedJavaScriptPath(mapped.basePaths, filePaths);
    }

    const basePath = joinRepositoryPath(
      config.directory,
      config.baseUrl,
      specifier,
    );
    const resolved = resolveJavaScriptBasePath(basePath, filePaths);
    if (resolved !== undefined) return resolved;
  }

  return undefined;
}

function mappedTypeScriptCandidates(
  specifier: string,
  config: TypeScriptModuleResolutionConfig,
): { matched: boolean; basePaths: string[] } {
  const basePaths: string[] = [];
  let matched = false;
  for (const [pattern, substitutions] of Object.entries(config.paths).sort(
    ([left], [right]) => compareStrings(left, right),
  )) {
    const wildcard = matchPathPattern(specifier, pattern);
    if (wildcard === undefined) continue;
    matched = true;
    for (const substitution of substitutions) {
      const replaced = substitution.includes("*")
        ? substitution.replaceAll("*", wildcard)
        : substitution;
      basePaths.push(
        joinRepositoryPath(config.directory, config.baseUrl, replaced),
      );
    }
  }
  return { matched, basePaths };
}

function matchPathPattern(specifier: string, pattern: string): string | undefined {
  const wildcardIndex = pattern.indexOf("*");
  if (wildcardIndex === -1) return specifier === pattern ? "" : undefined;
  if (pattern.indexOf("*", wildcardIndex + 1) !== -1) return undefined;
  const prefix = pattern.slice(0, wildcardIndex);
  const suffix = pattern.slice(wildcardIndex + 1);
  return specifier.startsWith(prefix) && specifier.endsWith(suffix)
    ? specifier.slice(prefix.length, specifier.length - suffix.length)
    : undefined;
}

function uniqueResolvedJavaScriptPath(
  basePaths: readonly string[],
  filePaths: ReadonlySet<string>,
): string | undefined {
  const resolved = basePaths.flatMap((basePath) => {
    const match = resolveJavaScriptBasePath(basePath, filePaths);
    return match === undefined ? [] : [match];
  });
  return resolved.length === 1 ? resolved[0] : undefined;
}

function joinRepositoryPath(...parts: readonly string[]): string {
  const result = posix.normalize(posix.join(...parts.filter((part) => part.length > 0)));
  return result === "." ? "" : result.replace(/^\.\//u, "");
}

function pathIsInside(filePath: string, directory: string): boolean {
  return directory.length === 0 || filePath.startsWith(`${directory}/`);
}

function explicitModuleCandidates(
  basePath: string,
  extension: string,
): string[] {
  const substitutions = TYPESCRIPT_SUBSTITUTIONS[extension.toLowerCase()];
  if (substitutions === undefined) {
    return [basePath];
  }

  const pathWithoutExtension = basePath.slice(0, -extension.length);
  return substitutions.map(
    (substitution) => `${pathWithoutExtension}${substitution}`,
  );
}

function uniqueExistingPath(
  candidates: readonly string[],
  filePaths: ReadonlySet<string>,
): string | undefined {
  const matches = existingPaths(candidates, filePaths);
  return matches.length === 1 ? matches[0] : undefined;
}

function existingPaths(
  candidates: readonly string[],
  filePaths: ReadonlySet<string>,
): string[] {
  return [...new Set(candidates.filter((candidate) => filePaths.has(candidate)))];
}

function importEdgeKey(edge: Edge): string {
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

function compareModuleReferences(
  left: ModuleReference,
  right: ModuleReference,
): number {
  return (
    left.lineRange.start - right.lineRange.start ||
    left.lineRange.end - right.lineRange.end ||
    compareStrings(left.source, right.source)
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
