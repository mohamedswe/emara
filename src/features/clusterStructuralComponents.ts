import createGraph from "ngraph.graph";
import { detectClusters } from "ngraph.leiden";

import type {
  FileNode,
  RepositoryGraph,
  RepositoryNode,
} from "../graph/types.js";
import { validateRepositoryGraph } from "../graph/validateRepositoryGraph.ts";

const LEIDEN_RANDOM_SEED = 42;
const CODE_LANGUAGES = new Set([
  "astro",
  "javascript",
  "python",
  "svelte",
  "typescript",
  "vue",
]);
const EXCLUDED_PATH_PREFIXES = [
  ".git/",
  ".next/",
  "audit-results/",
  "benchmark-results/",
  "build/",
  "dist/",
  "graphify-out/",
  "node_modules/",
] as const;

export interface StructuralComponent {
  id: string;
  label: string;
  fileNodeIds: string[];
  memberNodeIds: string[];
  isolatedFileNodeIds: string[];
  internalEdgeWeight: number;
}

export interface StructuralComponentEdge {
  sourceComponentId: string;
  targetComponentId: string;
  weight: number;
}

export interface StructuralClusteringResult {
  algorithm: "leiden-modularity";
  randomSeed: 42;
  components: StructuralComponent[];
  crossComponentEdges: StructuralComponentEdge[];
  excludedFileNodeIds: string[];
}

interface WeightedFileEdge {
  left: string;
  right: string;
  weight: number;
}

/**
 * Finds coarse code components independently of product entrypoints.
 *
 * The repository graph remains untouched. Symbols and evidence nodes are first
 * collapsed to their containing files, then Leiden tags the deterministic,
 * weighted file graph. Isolated code files are attached by module directory so
 * CLI/library repositories do not disappear merely because they lack routes.
 */
export function clusterStructuralComponents(
  graph: RepositoryGraph,
): StructuralClusteringResult {
  validateRepositoryGraph(graph);
  const eligibleFiles = graph.files
    .filter(isEligibleCodeFile)
    .sort((left, right) => compareText(left.id, right.id));
  const eligibleFileIds = new Set(eligibleFiles.map((file) => file.id));
  const excludedFileNodeIds = graph.files
    .filter((file) => !eligibleFileIds.has(file.id))
    .map((file) => file.id)
    .sort(compareText);
  if (eligibleFiles.length === 0) {
    return {
      algorithm: "leiden-modularity",
      randomSeed: LEIDEN_RANDOM_SEED,
      components: [],
      crossComponentEdges: [],
      excludedFileNodeIds,
    };
  }

  const ownerFileByNodeId = buildOwnerFileIndex(graph);
  const weightedEdges = collapseFileEdges(
    graph,
    ownerFileByNodeId,
    eligibleFileIds,
  );
  const incidentFileIds = new Set(
    weightedEdges.flatMap((edge) => [edge.left, edge.right]),
  );
  const connectedFiles = eligibleFiles.filter((file) => incidentFileIds.has(file.id));
  const isolatedFiles = eligibleFiles.filter((file) => !incidentFileIds.has(file.id));
  const communities = connectedFiles.length === 0
    ? []
    : detectFileCommunities(connectedFiles, weightedEdges);
  attachIsolatedFiles(communities, isolatedFiles, graph.files);

  const filesById = new Map(graph.files.map((file) => [file.id, file]));
  const allNodes = repositoryNodes(graph);
  const nodesByOwner = groupNodesByOwner(
    allNodes,
    ownerFileByNodeId,
    eligibleFileIds,
  );
  const sortedCommunities = communities
    .filter((community) => community.size > 0)
    .map((community) => [...community].sort(compareText))
    .sort(
      (left, right) =>
        right.length - left.length ||
        compareText(componentDirectoryKey(left, filesById), componentDirectoryKey(right, filesById)) ||
        compareText(left[0] ?? "", right[0] ?? ""),
    );
  const usedLabels = new Set<string>();
  const components = sortedCommunities.map((fileNodeIds, index): StructuralComponent => {
    const baseLabel = structuralComponentLabel(fileNodeIds, filesById);
    const label = allocateLabel(baseLabel, fileNodeIds, filesById, usedLabels);
    usedLabels.add(label);
    const fileSet = new Set(fileNodeIds);
    const internalEdgeWeight = weightedEdges.reduce(
      (total, edge) =>
        fileSet.has(edge.left) && fileSet.has(edge.right)
          ? total + edge.weight
          : total,
      0,
    );
    return {
      id: `structural-component-${String(index + 1).padStart(3, "0")}-${slugify(label)}`,
      label,
      fileNodeIds,
      memberNodeIds: sortedUnique(
        fileNodeIds.flatMap((fileId) => nodesByOwner.get(fileId) ?? [fileId]),
      ),
      isolatedFileNodeIds: fileNodeIds.filter((fileId) => !incidentFileIds.has(fileId)),
      internalEdgeWeight,
    };
  });
  const componentIdByFile = new Map<string, string>();
  for (const component of components) {
    for (const fileId of component.fileNodeIds) {
      componentIdByFile.set(fileId, component.id);
    }
  }
  const crossWeights = new Map<string, number>();
  for (const edge of weightedEdges) {
    const leftComponent = componentIdByFile.get(edge.left);
    const rightComponent = componentIdByFile.get(edge.right);
    if (
      leftComponent === undefined ||
      rightComponent === undefined ||
      leftComponent === rightComponent
    ) {
      continue;
    }
    const [source, target] = [leftComponent, rightComponent].sort(compareText);
    const key = `${source}\u0000${target}`;
    crossWeights.set(key, (crossWeights.get(key) ?? 0) + edge.weight);
  }
  const crossComponentEdges = [...crossWeights.entries()]
    .map(([key, weight]) => {
      const [sourceComponentId = "", targetComponentId = ""] = key.split("\u0000");
      return { sourceComponentId, targetComponentId, weight };
    })
    .sort(
      (left, right) =>
        right.weight - left.weight ||
        compareText(left.sourceComponentId, right.sourceComponentId) ||
        compareText(left.targetComponentId, right.targetComponentId),
    );

  return {
    algorithm: "leiden-modularity",
    randomSeed: LEIDEN_RANDOM_SEED,
    components,
    crossComponentEdges,
    excludedFileNodeIds,
  };
}

function isEligibleCodeFile(file: FileNode): boolean {
  const path = normalizePath(file.path);
  return CODE_LANGUAGES.has(file.language.toLowerCase()) &&
    !EXCLUDED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function buildOwnerFileIndex(graph: RepositoryGraph): Map<string, string> {
  const result = new Map<string, string>();
  for (const file of graph.files) result.set(file.id, file.id);
  for (const node of [...graph.symbols, ...graph.entrypoints, ...graph.entities]) {
    result.set(node.id, node.fileId);
  }
  for (const edge of graph.edges) {
    if (edge.type !== "CONTAINS") continue;
    if (!result.has(edge.source) || result.get(edge.source) !== edge.source) continue;
    result.set(edge.target, edge.source);
  }
  return result;
}

function collapseFileEdges(
  graph: RepositoryGraph,
  ownerFileByNodeId: ReadonlyMap<string, string>,
  eligibleFileIds: ReadonlySet<string>,
): WeightedFileEdge[] {
  const weights = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.type === "CONTAINS") continue;
    const sourceFileId = ownerFileByNodeId.get(edge.source);
    const targetFileId = ownerFileByNodeId.get(edge.target);
    if (
      sourceFileId === undefined ||
      targetFileId === undefined ||
      sourceFileId === targetFileId ||
      !eligibleFileIds.has(sourceFileId) ||
      !eligibleFileIds.has(targetFileId)
    ) {
      continue;
    }
    const [left, right] = [sourceFileId, targetFileId].sort(compareText);
    const key = `${left}\u0000${right}`;
    weights.set(key, (weights.get(key) ?? 0) + 1);
  }
  return [...weights.entries()]
    .map(([key, weight]) => {
      const [left = "", right = ""] = key.split("\u0000");
      return { left, right, weight };
    })
    .sort(
      (left, right) =>
        compareText(left.left, right.left) || compareText(left.right, right.right),
    );
}

function detectFileCommunities(
  files: readonly FileNode[],
  edges: readonly WeightedFileEdge[],
): Array<Set<string>> {
  const graph = createGraph<Record<string, never>, { weight: number }>();
  for (const file of files) graph.addNode(file.id, {});
  for (const edge of edges) graph.addLink(edge.left, edge.right, { weight: edge.weight });
  const result = detectClusters(graph, {
    directed: false,
    quality: "modularity",
    randomSeed: LEIDEN_RANDOM_SEED,
    linkWeight: (link) => {
      if (
        typeof link.data === "object" &&
        link.data !== null &&
        "weight" in link.data &&
        typeof link.data.weight === "number"
      ) {
        return link.data.weight;
      }
      return 1;
    },
  });
  return [...result.getCommunities().values()]
    .map((members) => new Set(members.map(String)))
    .filter((members) => members.size > 0);
}

function attachIsolatedFiles(
  communities: Array<Set<string>>,
  isolatedFiles: readonly FileNode[],
  allFiles: readonly FileNode[],
): void {
  const filesById = new Map(allFiles.map((file) => [file.id, file]));
  const looseByDirectory = new Map<string, Set<string>>();
  for (const file of isolatedFiles) {
    const path = normalizePath(file.path);
    let selected: Set<string> | undefined;
    let selectedDepth = -1;
    for (const community of communities) {
      const directory = componentDirectoryKey([...community], filesById);
      if (directory.length === 0 || !path.startsWith(`${directory}/`)) continue;
      const depth = directory.split("/").length;
      if (depth > selectedDepth) {
        selected = community;
        selectedDepth = depth;
      }
    }
    if (selected !== undefined) {
      selected.add(file.id);
      continue;
    }
    const directory = fileDirectoryKey(path);
    const loose = looseByDirectory.get(directory) ?? new Set<string>();
    loose.add(file.id);
    looseByDirectory.set(directory, loose);
  }
  for (const directory of [...looseByDirectory.keys()].sort(compareText)) {
    const community = looseByDirectory.get(directory);
    if (community !== undefined) communities.push(community);
  }
}

function repositoryNodes(graph: RepositoryGraph): RepositoryNode[] {
  return [...graph.files, ...graph.symbols, ...graph.entrypoints, ...graph.entities];
}

function groupNodesByOwner(
  nodes: readonly RepositoryNode[],
  ownerFileByNodeId: ReadonlyMap<string, string>,
  eligibleFileIds: ReadonlySet<string>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const node of nodes) {
    const fileId = ownerFileByNodeId.get(node.id);
    if (fileId === undefined || !eligibleFileIds.has(fileId)) continue;
    const values = result.get(fileId) ?? [];
    values.push(node.id);
    result.set(fileId, values);
  }
  for (const [fileId, values] of result) result.set(fileId, sortedUnique(values));
  return result;
}

function structuralComponentLabel(
  fileNodeIds: readonly string[],
  filesById: ReadonlyMap<string, FileNode>,
): string {
  const counts = new Map<string, number>();
  for (const fileId of fileNodeIds) {
    const file = filesById.get(fileId);
    if (file === undefined) continue;
    const directory = fileDirectoryKey(normalizePath(file.path));
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || compareText(left[0], right[0]),
  );
  const primary = ranked[0]?.[0] ?? "code";
  const minimumSecondaryCount = Math.max(2, Math.ceil(fileNodeIds.length * 0.2));
  const directories = ranked
    .filter(([, count], index) => index === 0 || count >= minimumSecondaryCount)
    .slice(0, 2)
    .map(([directory]) => directory);
  return directories.map(humanizeDirectory).join(" / ") || humanizeDirectory(primary);
}

function allocateLabel(
  baseLabel: string,
  fileNodeIds: readonly string[],
  filesById: ReadonlyMap<string, FileNode>,
  usedLabels: ReadonlySet<string>,
): string {
  if (!usedLabels.has(baseLabel)) return baseLabel;
  const hub = fileNodeIds
    .map((fileId) => filesById.get(fileId)?.path ?? "")
    .filter((path) => path.length > 0)
    .sort(compareText)[0] ?? "component";
  const fileName = hub.split("/").at(-1)?.replace(/\.[^.]+$/u, "") ?? "component";
  let candidate = `${baseLabel} / ${humanize(fileName)}`;
  let suffix = 2;
  while (usedLabels.has(candidate)) {
    candidate = `${baseLabel} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function componentDirectoryKey(
  fileNodeIds: readonly string[],
  filesById: ReadonlyMap<string, FileNode>,
): string {
  const counts = new Map<string, number>();
  for (const fileId of fileNodeIds) {
    const file = filesById.get(fileId);
    if (file === undefined) continue;
    const key = fileDirectoryKey(normalizePath(file.path));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || compareText(left[0], right[0]),
  )[0]?.[0] ?? "";
}

function fileDirectoryKey(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) return segments[0] ?? "root";
  return segments.slice(0, 2).join("/");
}

function humanizeDirectory(directory: string): string {
  const segments = directory.split("/").filter((segment) => segment.length > 0);
  const meaningful = segments[0] === "src" && segments.length > 1
    ? segments.slice(1)
    : segments;
  if (meaningful[0] === "fixtures" && meaningful.length > 1) {
    return `${humanize(meaningful[1] ?? "")} Fixtures`.trim();
  }
  return meaningful.map(humanize).join(" / ") || "Code";
}

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[-_.]+/gu, " ")
    .replace(/\b\w/gu, (character) => character.toUpperCase())
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizePath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function slugify(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized.length > 0 ? normalized : "code";
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
