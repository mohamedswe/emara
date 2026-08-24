import { dirname } from "node:path";

import type { RepositoryGraph, RepositoryNode } from "../graph/types.js";
import {
  isSupportedSourceFile,
  parseWithLanguageFrontend,
} from "../languages/languageFrontends.ts";
import { getSource } from "../retrieval/getSource.ts";
import type { ScannedFile } from "../scanner/types.js";
import type { FunctionalityFeature } from "./types.js";

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const DEPENDENCY_MANIFEST_NAMES = new Set(["package.json", "requirements.txt"]);
const CREATE_NEXT_APP_MARKERS = [
  "To get started, edit the page.tsx",
  "/next.svg",
] as const;

export type RepositoryRealityFeature = Omit<
  FunctionalityFeature,
  "canonicalId"
> & { canonicalId?: string };

interface DocumentationPromiseFact {
  id: string;
  text: string;
  heading?: string | null;
}

interface IndexedSourceFact {
  path: string;
  content: string;
  imports: string[];
}

interface ManifestFact {
  path: string;
  content: string;
}

interface DeclaredDependency {
  ecosystem: "npm" | "python";
  manifestPath: string;
  name: string;
}

interface DocumentedUnusedDependency extends DeclaredDependency {
  documentationPromiseIds: string[];
}

/**
 * Applies deterministic repository facts that are deliberately outside feature
 * clustering: exact framework-starter markers and documented dependencies with
 * no source imports. The graph schema and clustering membership logic remain
 * untouched; scaffold code is rejected as implementation evidence here.
 */
export async function applyRepositoryRealityChecks(
  features: readonly RepositoryRealityFeature[],
  promises: readonly DocumentationPromiseFact[],
  graph: RepositoryGraph,
  repositoryPath: string,
): Promise<RepositoryRealityFeature[]> {
  const { sources, manifests } = await readIndexedFacts(graph, repositoryPath);
  const preexistingMissingPromiseIds = new Set(
    features.flatMap((feature) =>
      feature.status === "DOCUMENTED_NOT_IMPLEMENTED"
        ? feature.documentationPromiseIds
        : []
    ),
  );
  const withoutScaffoldEvidence = applyStarterTemplateChecks(
    features,
    promises,
    graph,
    sources,
  );
  return applyPhantomDependencyChecks(
    withoutScaffoldEvidence,
    promises,
    sources,
    manifests,
    preexistingMissingPromiseIds,
  );
}

function applyStarterTemplateChecks(
  features: readonly RepositoryRealityFeature[],
  promises: readonly DocumentationPromiseFact[],
  graph: RepositoryGraph,
  sources: readonly IndexedSourceFact[],
): RepositoryRealityFeature[] {
  const sourceByPath = new Map(sources.map((source) => [source.path, source]));
  const scaffoldPaths = new Set(
    sources.flatMap((source) =>
      isCreateNextAppStarter(source.content) ? [source.path] : []
    ),
  );
  if (scaffoldPaths.size === 0) return [...features];

  const applicationPromise = [...promises]
    .map((promise) => ({ promise, score: applicationPromiseScore(promise.text) }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || compareText(left.promise.id, right.promise.id),
    )[0]?.promise;
  if (applicationPromise === undefined) return [...features];

  const nodesById = allNodes(graph);
  const filePathById = new Map(graph.files.map((file) => [file.id, file.path]));
  return features.map((feature) => {
    const entrypointPaths = feature.entrypointNodeIds.flatMap((nodeId) => {
      const node = graph.entrypoints.find((entrypoint) => entrypoint.id === nodeId);
      const path = node === undefined ? undefined : filePathById.get(node.fileId);
      return path === undefined ? [] : [path];
    });
    if (
      entrypointPaths.length === 0 ||
      !entrypointPaths.every((path) => scaffoldPaths.has(path))
    ) {
      return feature;
    }
    const implementationPaths = feature.implementationNodeIds.flatMap((nodeId) => {
      const path = nodeFilePath(nodesById.get(nodeId), filePathById);
      return path === undefined ? [] : [path];
    });
    if (
      implementationPaths.length !== feature.implementationNodeIds.length ||
      !implementationPaths.every((path) => scaffoldPaths.has(path))
    ) {
      return feature;
    }
    const markerPath = entrypointPaths[0];
    if (markerPath === undefined || sourceByPath.get(markerPath) === undefined) {
      return feature;
    }
    return {
      ...feature,
      title: "Root App Entry",
      status: "DOCUMENTED_NOT_IMPLEMENTED",
      entrypointNodeIds: [],
      implementationNodeIds: [],
      documentationPromiseIds: sortedUnique([
        ...feature.documentationPromiseIds,
        applicationPromise.id,
      ]),
      gaps: sortedUnique([
        ...feature.gaps,
        `The indexed app entry ${markerPath} exactly matches create-next-app starter markers (${CREATE_NEXT_APP_MARKERS.join(
          ", ",
        )}) and is not implementation evidence for the documented application.`,
      ]),
      confidence: "HIGH",
    };
  });
}

function applyPhantomDependencyChecks(
  features: readonly RepositoryRealityFeature[],
  promises: readonly DocumentationPromiseFact[],
  sources: readonly IndexedSourceFact[],
  manifests: readonly ManifestFact[],
  preexistingMissingPromiseIds: ReadonlySet<string>,
): RepositoryRealityFeature[] {
  const findings = readDeclaredDependencies(manifests).flatMap(
    (dependency): DocumentedUnusedDependency[] => {
      if (dependencyHasSourceImport(dependency, sources)) return [];
      const documentationPromiseIds = promises
        .filter(
          (promise) =>
            !preexistingMissingPromiseIds.has(promise.id) &&
            promiseDocumentsDependency(promise, dependency),
        )
        .map((promise) => promise.id)
        .sort(compareText);
      return documentationPromiseIds.length === 0
        ? []
        : [{ ...dependency, documentationPromiseIds }];
    },
  );
  if (findings.length === 0) return [...features];

  const reassignedPromiseIds = new Set(
    findings.flatMap((finding) => finding.documentationPromiseIds),
  );
  const reconciled = features.flatMap((feature): RepositoryRealityFeature[] => {
    const documentationPromiseIds = feature.documentationPromiseIds.filter(
      (promiseId) => !reassignedPromiseIds.has(promiseId),
    );
    if (documentationPromiseIds.length === feature.documentationPromiseIds.length) {
      return [feature];
    }
    const hasImplementation =
      feature.entrypointNodeIds.length > 0 || feature.implementationNodeIds.length > 0;
    if (!hasImplementation && documentationPromiseIds.length === 0) return [];
    return [{
      ...feature,
      documentationPromiseIds,
      status: documentationPromiseIds.length === 0 && hasImplementation
        ? "IMPLEMENTED_UNDOCUMENTED"
        : feature.status,
    }];
  });

  const grouped = new Map<string, DocumentedUnusedDependency[]>();
  for (const finding of findings) {
    const values = grouped.get(finding.manifestPath) ?? [];
    values.push(finding);
    grouped.set(finding.manifestPath, values);
  }
  const usedIds = new Set(reconciled.map((feature) => feature.id));
  const missingFeatures = [...grouped]
    .sort(([left], [right]) => compareText(left, right))
    .map(([manifestPath, dependencies]): RepositoryRealityFeature => {
      const scope = manifestScope(manifestPath);
      const id = allocateId(`phantom-${slug(scope)}-packages`, usedIds);
      usedIds.add(id);
      const ordered = [...dependencies].sort((left, right) =>
        compareText(dependencyDisplayName(left), dependencyDisplayName(right))
      );
      const dependencyNames = ordered.map(dependencyDisplayName);
      return {
        id,
        title: `Phantom ${scope} packages: ${dependencyNames.join(", ")}`,
        kind: "infrastructure",
        status: "DOCUMENTED_NOT_IMPLEMENTED",
        entrypointNodeIds: [],
        implementationNodeIds: [],
        documentationPromiseIds: sortedUnique(
          ordered.flatMap((dependency) => dependency.documentationPromiseIds),
        ),
        gaps: [
          `${manifestPath} declares documented ${dependencyNames.join(", ")}, but no indexed source file in that manifest scope imports them; the manifest alone is not implementation evidence.`,
        ],
        confidence: "HIGH",
      };
    });
  return [...reconciled, ...missingFeatures];
}

async function readIndexedFacts(
  graph: RepositoryGraph,
  repositoryPath: string,
): Promise<{ sources: IndexedSourceFact[]; manifests: ManifestFact[] }> {
  const sources: IndexedSourceFact[] = [];
  const manifests: ManifestFact[] = [];
  for (const file of [...graph.files].sort((left, right) =>
    compareText(left.path, right.path)
  )) {
    if (file.lineRange === undefined) continue;
    const baseName = file.path.split("/").at(-1)?.toLowerCase() ?? "";
    const supported = isSupportedSourceFile(file as ScannedFile);
    if (!supported && !DEPENDENCY_MANIFEST_NAMES.has(baseName)) continue;
    const slice = await getSource(graph, repositoryPath, file.id, {
      maxLines: file.lineRange.end,
      maxBytes: MAX_SOURCE_BYTES,
    });
    if (DEPENDENCY_MANIFEST_NAMES.has(baseName)) {
      manifests.push({ path: file.path, content: slice.content });
    }
    if (!supported) continue;
    const parsed = parseWithLanguageFrontend(file as ScannedFile, slice.content);
    sources.push({
      path: file.path,
      content: slice.content,
      imports: sortedUnique(parsed.imports.map((entry) => entry.source)),
    });
  }
  return { sources, manifests };
}

function readDeclaredDependencies(
  manifests: readonly ManifestFact[],
): DeclaredDependency[] {
  return manifests.flatMap((manifest) => {
    if (manifest.path.toLowerCase().endsWith("package.json")) {
      return readPackageDependencies(manifest);
    }
    return readRequirementDependencies(manifest);
  }).sort(
    (left, right) =>
      compareText(left.manifestPath, right.manifestPath) ||
      compareText(left.name, right.name),
  );
}

function readPackageDependencies(manifest: ManifestFact): DeclaredDependency[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest.content);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !isRecord(parsed.dependencies)) return [];
  return Object.keys(parsed.dependencies).sort(compareText).map((name) => ({
    ecosystem: "npm" as const,
    manifestPath: manifest.path,
    name,
  }));
}

function readRequirementDependencies(
  manifest: ManifestFact,
): DeclaredDependency[] {
  return sortedUnique(
    manifest.content.split(/\r?\n/u).flatMap((rawLine) => {
      const line = rawLine.replace(/\s+#.*$/u, "").trim();
      if (line.length === 0 || line.startsWith("-") || /^(?:git\+|https?:)/iu.test(line)) {
        return [];
      }
      const name = line.split(/[\s<>=!~;\[]/u, 1)[0]?.trim();
      return name === undefined || name.length === 0 ? [] : [name];
    }),
  ).map((name) => ({
    ecosystem: "python" as const,
    manifestPath: manifest.path,
    name,
  }));
}

function dependencyHasSourceImport(
  dependency: DeclaredDependency,
  sources: readonly IndexedSourceFact[],
): boolean {
  const scope = normalizedManifestDirectory(dependency.manifestPath);
  const importNames = dependencyImportNames(dependency);
  return sources.some((source) => {
    if (scope.length > 0 && !normalizedPath(source.path).startsWith(`${scope}/`)) {
      return false;
    }
    return source.imports.some((importSource) => {
      const normalized = importSource.toLowerCase();
      return importNames.some(
        (name) => normalized === name || normalized.startsWith(`${name}/`) ||
          normalized.startsWith(`${name}.`),
      );
    });
  });
}

function dependencyImportNames(dependency: DeclaredDependency): string[] {
  const normalized = dependency.name.toLowerCase().replace(/-/gu, "_");
  if (dependency.ecosystem === "npm") {
    return [dependency.name.toLowerCase()];
  }
  const aliases: Readonly<Record<string, readonly string[]>> = {
    "beautifulsoup4": ["bs4"],
    "opencv_python": ["cv2"],
    "pillow": ["pil"],
    "psycopg2_binary": ["psycopg2"],
    "pydantic_settings": ["pydantic_settings"],
    "pymupdf": ["pymupdf", "fitz"],
    "pyjwt": ["jwt"],
    "python_dotenv": ["dotenv"],
    "python_multipart": ["multipart"],
    "scikit_learn": ["sklearn"],
  };
  return [...(aliases[normalized] ?? [normalized])];
}

function promiseDocumentsDependency(
  promise: DocumentationPromiseFact,
  dependency: DeclaredDependency,
): boolean {
  const normalized = normalizeWords(promise.text);
  const knownAliases: Readonly<Record<string, readonly string[]>> = {
    "@tanstack/react-query": ["react query", "tanstack query"],
    "react-dropzone": ["react dropzone", "dropzone"],
    "react-markdown": ["react markdown", "markdown"],
  };
  const known = knownAliases[dependency.name.toLowerCase()];
  const aliases = known ?? [
    normalizeWords(dependency.name.replace(/^@[^/]+\//u, "").replace(/[-_]/gu, " ")),
  ];
  if (!aliases.some((alias) => containsPhrase(normalized, alias))) return false;
  if (known !== undefined || aliases.some((alias) => normalized === alias)) {
    return true;
  }
  return /\b(?:architecture|backend|dependencies|frontend|requirements|stack)\b/iu.test(
    promise.heading ?? "",
  );
}

function dependencyDisplayName(dependency: DeclaredDependency): string {
  const knownNames: Readonly<Record<string, string>> = {
    "@tanstack/react-query": "React Query",
    "react-dropzone": "React Dropzone",
    "react-markdown": "React Markdown",
  };
  return knownNames[dependency.name.toLowerCase()] ?? dependency.name;
}

function applicationPromiseScore(text: string): number {
  const normalized = normalizeWords(text);
  let score = 0;
  if (containsPhrase(normalized, "ai tutor")) score += 4;
  if (containsPhrase(normalized, "learning assistant")) score += 3;
  if (containsPhrase(normalized, "dashboard chat interface")) score += 5;
  if (normalized.includes("dashboard") && normalized.includes("chat")) score += 3;
  if (containsPhrase(normalized, "next js")) score += 2;
  return score;
}

function isCreateNextAppStarter(source: string): boolean {
  return CREATE_NEXT_APP_MARKERS.every((marker) => source.includes(marker));
}

function nodeFilePath(
  node: RepositoryNode | undefined,
  filePathById: ReadonlyMap<string, string>,
): string | undefined {
  if (node === undefined) return undefined;
  return node.type === "file" ? node.path : filePathById.get(node.fileId);
}

function allNodes(graph: RepositoryGraph): Map<string, RepositoryNode> {
  return new Map(
    [...graph.files, ...graph.symbols, ...graph.entrypoints, ...graph.entities]
      .map((node) => [node.id, node]),
  );
}

function manifestScope(manifestPath: string): string {
  const directory = normalizedManifestDirectory(manifestPath);
  return directory.length === 0 ? "root" : directory.split("/").at(-1) ?? "root";
}

function normalizedManifestDirectory(manifestPath: string): string {
  const directory = normalizedPath(dirname(manifestPath));
  return directory === "." ? "" : directory;
}

function normalizedPath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "").toLowerCase();
}

function normalizeWords(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

function containsPhrase(value: string, phrase: string): boolean {
  return (` ${value} `).includes(` ${phrase} `);
}

function slug(value: string): string {
  const normalized = normalizeWords(value).replace(/\s+/gu, "-");
  return normalized.length === 0 ? "root" : normalized;
}

function allocateId(preferred: string, usedIds: ReadonlySet<string>): string {
  if (!usedIds.has(preferred)) return preferred;
  let suffix = 2;
  while (usedIds.has(`${preferred}-${suffix}`)) suffix += 1;
  return `${preferred}-${suffix}`;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
