import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { buildRepositorySupportReport } from "../frameworks/repositorySupport.ts";
import {
  DEFAULT_FRAMEWORK_REGISTRY,
  type FrameworkRegistry,
} from "../frameworks/registry.ts";
import type { RepositorySupportReport } from "../frameworks/types.js";
import {
  isSupportedSourceFile,
  parseWithLanguageFrontend,
} from "../languages/languageFrontends.ts";
import type { ParsedSourceFile } from "../parser/types.js";
import { scanRepository } from "../scanner/scanRepository.ts";
import type { ScannedFile } from "../scanner/types.js";
import { buildRepositoryGraph } from "./buildRepositoryGraph.ts";
import type { IndexedSourceFile } from "./indexedSourceFile.ts";
import { loadTypeScriptModuleResolutionConfigs } from "./loadTypeScriptModuleResolutionConfigs.ts";
import { addPackageScriptEntrypoints } from "./packageScriptEntrypoints.ts";
import { writeRepositoryGraph } from "./persistRepositoryGraph.ts";
import type { RepositoryGraph } from "./types.js";

export interface IndexRepositoryOptions {
  outputPath?: string;
  excludePaths?: readonly string[];
  frameworkRegistry?: FrameworkRegistry;
}

export interface IndexRepositoryResult {
  graph: RepositoryGraph;
  outputPath: string;
  support: RepositorySupportReport;
  sourceFiles: IndexedSourceFile[];
}

export async function indexRepository(
  repositoryPath: string,
  options: IndexRepositoryOptions = {},
): Promise<IndexRepositoryResult> {
  if (repositoryPath.length === 0) {
    throw new Error("Repository path must not be empty");
  }

  const scannedFiles = await scanRepository(repositoryPath);
  const repositoryRoot = await realpath(resolve(repositoryPath));
  const outputPath = resolveOutputPath(repositoryRoot, options.outputPath);
  const excludedRelativePaths = resolveExcludedRelativePaths(
    repositoryRoot,
    outputPath,
    options.excludePaths ?? [],
  );
  const graphFiles = scannedFiles.filter(
    (file) => !excludedRelativePaths.has(file.path),
  );
  const frameworkRegistry = options.frameworkRegistry ?? DEFAULT_FRAMEWORK_REGISTRY;
  const indexedSourceFiles = await parseScannedSourceFiles(
    repositoryRoot,
    graphFiles,
    frameworkRegistry,
  );
  const parsedFiles = await addPackageScriptEntrypoints(
    repositoryRoot,
    graphFiles,
    indexedSourceFiles.map((source) => source.parsed),
  );
  const graphParsedFiles = parsedFiles.filter(
    (file) => file.diagnostics.length === 0,
  );
  const support = await buildRepositorySupportReport(
    repositoryRoot,
    graphFiles,
    parsedFiles,
    frameworkRegistry,
  );
  const typeScriptConfigs = await loadTypeScriptModuleResolutionConfigs(
    repositoryRoot,
    graphFiles,
  );
  const graph = buildRepositoryGraph(graphFiles, graphParsedFiles, {
    typeScriptConfigs,
    analysis: {
      sourceFileCount:
        support.parsedFiles + support.unparsedSourceFiles.length,
      parsedSourceFileCount: support.parsedFiles,
      unparsedSourceFiles: [...support.unparsedSourceFiles],
      diagnostics: support.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    },
  });
  const writtenPath = await writeRepositoryGraph(graph, outputPath);

  return {
    graph,
    outputPath: writtenPath,
    support,
    sourceFiles: indexedSourceFiles.filter((source) =>
      createHash("sha256").update(source.content).digest("hex") ===
        source.file.contentHash
    ),
  };
}

function resolveExcludedRelativePaths(
  repositoryRoot: string,
  outputPath: string,
  excludePaths: readonly string[],
): Set<string> {
  const absolutePaths = [
    outputPath,
    ...excludePaths.map((path) => {
      if (path.length === 0) {
        throw new Error("Excluded path must not be empty");
      }
      return isAbsolute(path) ? resolve(path) : resolve(repositoryRoot, path);
    }),
  ];
  return new Set(
    absolutePaths
      .map((path) => relativePathInside(repositoryRoot, path))
      .filter((path): path is string => path !== undefined),
  );
}

async function parseScannedSourceFiles(
  repositoryRoot: string,
  files: readonly ScannedFile[],
  frameworkRegistry: FrameworkRegistry,
): Promise<IndexedSourceFile[]> {
  return Promise.all(
    files.filter(isSupportedSourceFile).map(async (file) => {
      const absolutePath = join(repositoryRoot, ...file.path.split("/"));
      const content = await readFile(absolutePath, "utf8");
      return {
        file,
        content,
        parsed: parseWithLanguageFrontend(file, content, frameworkRegistry),
      };
    }),
  );
}

function resolveOutputPath(
  repositoryRoot: string,
  outputPath: string | undefined,
): string {
  if (outputPath === undefined) {
    return join(repositoryRoot, "graph.json");
  }

  if (outputPath.length === 0) {
    throw new Error("Graph output path must not be empty");
  }

  return isAbsolute(outputPath)
    ? resolve(outputPath)
    : resolve(repositoryRoot, outputPath);
}

function relativePathInside(
  repositoryRoot: string,
  targetPath: string,
): string | undefined {
  const relativePath = relative(repositoryRoot, targetPath);
  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    return undefined;
  }

  return relativePath.split(sep).join("/");
}
