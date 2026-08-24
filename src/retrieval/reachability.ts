import type {
  Edge,
  RepositoryGraph,
  RepositoryNode,
} from "../graph/types.js";
import { isTestFilePath } from "../scanner/classifyFilePath.ts";
import { validateRepositoryGraph } from "../graph/validateRepositoryGraph.ts";

export type ReachabilityStatus =
  | "reachable"
  | "internally_reachable"
  | "test_only"
  | "dead_or_unreferenced"
  | "unknown";

export interface EvidencePath {
  nodeIds: string[];
  edges: Edge[];
}

export interface ReachabilityOptions {
  maxDepth?: number;
  maxPaths?: number;
}

export interface ReachabilityResult {
  nodeId: string;
  status: ReachabilityStatus;
  reachable: boolean;
  confidence: "proven" | "tentative";
  reason: string;
  paths: EvidencePath[];
}

export interface ReachabilityPathsResult {
  nodeId: string;
  resolvedTargetIds: string[];
  paths: EvidencePath[];
  total: number;
  truncated: boolean;
  limits: { maxDepth: number; maxPaths: number };
}

type ReachabilityRootKind = "external" | "internal" | "test";

interface ReachabilityGraphIndex {
  nodesById: Map<string, RepositoryNode>;
  entitiesById: Map<string, RepositoryGraph["entities"][number]>;
  entityIdsBySymbolId: Map<string, string[]>;
  endpointIdsByEntrypointId: Map<string, string[]>;
  adjacency: Map<string, Array<{ nodeId: string; edge: Edge }>>;
  externalAdjacency: Map<string, Array<{ nodeId: string; edge: Edge }>>;
  externalRoots: Set<string>;
  internalRoots: Set<string>;
  testRoots: Set<string>;
  meaningfulIncidentNodeIds: Set<string>;
  traversalsByMaxDepth: Map<number, MultiSourceTraversal>;
}

interface RootTraversal {
  distances: Map<string, number>;
  predecessors: Map<string, Array<{ nodeId: string; edge: Edge }>>;
  pathsByNodeId: Map<string, EvidencePath[]>;
}

interface MultiSourceTraversal {
  external: RootTraversal;
  internal: RootTraversal;
  test: RootTraversal;
}

const DEFAULT_MAX_DEPTH = 20;
const DEFAULT_MAX_PATHS = 20;
const MAX_DEPTH = 50;
const MAX_PATHS = 100;
const PRODUCT_TRAVERSAL_EDGE_TYPES = new Set([
  "HANDLED_BY",
  "CALLS",
  "REFERENCES",
  "VALIDATED_BY",
  "RENDERS",
  "PUBLISHES",
  "SUBSCRIBES_TO",
  "CONFIGURED_BY",
]);
const REACT_BOOTSTRAP_ENTRYPOINT_NAMES = new Set([
  "React createRoot",
  "React hydrateRoot",
]);
const validatedGraphs = new WeakSet<RepositoryGraph>();
const graphIndexes = new WeakMap<RepositoryGraph, ReachabilityGraphIndex>();

export function isReachable(
  graph: RepositoryGraph,
  nodeId: string,
  options: ReachabilityOptions = {},
): ReachabilityResult {
  const result = buildReachabilityResults(graph, [nodeId], options).get(nodeId);
  if (result === undefined) {
    throw new Error(`Graph node not found: ${JSON.stringify(nodeId)}`);
  }
  return result;
}

/**
 * Classify many nodes from one traversal of each root class. The three root
 * classes remain separate so the legacy priority (external, startup, test) is
 * preserved even when a lower-priority path is shorter.
 */
export function buildReachabilityResults(
  graph: RepositoryGraph,
  nodeIds?: readonly string[],
  options: ReachabilityOptions = {},
): Map<string, ReachabilityResult> {
  const index = reachabilityGraphIndex(graph);
  const limits = resolveLimits(options);
  const traversal = multiSourceTraversal(index, limits.maxDepth);
  const requestedNodeIds = nodeIds ?? [
    ...graph.symbols.map((node) => node.id),
    ...graph.entrypoints.map((node) => node.id),
    ...graph.entities.map((node) => node.id),
  ];
  const results = new Map<string, ReachabilityResult>();
  for (const nodeId of requestedNodeIds) {
    assertNode(index, nodeId);
    const targets = equivalentTargetIds(index, nodeId);
    results.set(
      nodeId,
      classifyReachability(index, traversal, nodeId, targets, limits.maxPaths),
    );
  }
  return results;
}

export function findPathsFromEntrypoints(
  graph: RepositoryGraph,
  nodeId: string,
  options: ReachabilityOptions = {},
): ReachabilityPathsResult {
  const index = reachabilityGraphIndex(graph);
  assertNode(index, nodeId);
  const limits = resolveLimits(options);
  const targets = equivalentTargetIds(index, nodeId);
  const found = findPaths(
    index.externalRoots,
    targets,
    index.externalAdjacency,
    limits,
  );
  return {
    nodeId,
    resolvedTargetIds: [...targets].sort(compareText),
    paths: found.paths,
    total: found.total,
    truncated: found.truncated,
    limits,
  };
}

export function findPathsToExternalBehavior(
  graph: RepositoryGraph,
  nodeId: string,
  options: ReachabilityOptions = {},
): ReachabilityPathsResult {
  const index = reachabilityGraphIndex(graph);
  assertNode(index, nodeId);
  const limits = resolveLimits(options);
  const starts = equivalentTargetIds(index, nodeId);
  const externalBehavior = new Set([
    ...index.externalRoots,
    ...graph.entities
      .filter((entity) => entity.type === "event" && entity.operation === "publish")
      .map((entity) => entity.id),
  ]);
  const found = findPaths(
    starts,
    externalBehavior,
    index.adjacency,
    limits,
  );
  return {
    nodeId,
    resolvedTargetIds: [...externalBehavior].sort(compareText),
    paths: found.paths,
    total: found.total,
    truncated: found.truncated,
    limits,
  };
}

function findPaths(
  roots: ReadonlySet<string>,
  targets: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, Array<{ nodeId: string; edge: Edge }>>,
  limits: { maxDepth: number; maxPaths: number },
): { paths: EvidencePath[]; total: number; truncated: boolean } {
  const paths: EvidencePath[] = [];
  let total = 0;
  const queue = [...roots]
    .sort(compareText)
    .map((root) => ({ nodeIds: [root], edges: [] as Edge[] }));
  const bestDepth = new Map(queue.map((path) => [path.nodeIds[0] as string, 0]));

  for (let index = 0; index < queue.length; index += 1) {
    const path = queue[index];
    if (path === undefined) continue;
    const current = path.nodeIds.at(-1);
    if (current === undefined) continue;

    if (targets.has(current)) {
      total += 1;
      if (paths.length < limits.maxPaths) {
        paths.push({
          nodeIds: [...path.nodeIds],
          edges: path.edges.map((edge) => ({
            ...edge,
            evidence: { ...edge.evidence },
          })),
        });
      }
      continue;
    }
    if (path.edges.length >= limits.maxDepth) continue;

    for (const neighbor of adjacency.get(current) ?? []) {
      if (path.nodeIds.includes(neighbor.nodeId)) continue;
      const nextDepth = path.edges.length + 1;
      const knownDepth = bestDepth.get(neighbor.nodeId);
      if (knownDepth !== undefined && knownDepth < nextDepth) continue;
      bestDepth.set(neighbor.nodeId, nextDepth);
      queue.push({
        nodeIds: [...path.nodeIds, neighbor.nodeId],
        edges: [...path.edges, neighbor.edge],
      });
    }
  }

  paths.sort(comparePaths);
  return { paths, total, truncated: total > paths.length };
}

function buildProductAdjacency(
  graph: RepositoryGraph,
  includeImports = false,
): Map<string, Array<{ nodeId: string; edge: Edge }>> {
  const result = new Map<string, Array<{ nodeId: string; edge: Edge }>>();
  for (const edge of graph.edges) {
    if (
      !PRODUCT_TRAVERSAL_EDGE_TYPES.has(edge.type) &&
      !(includeImports && edge.type === "IMPORTS")
    ) {
      continue;
    }
    const values = result.get(edge.source) ?? [];
    values.push({ nodeId: edge.target, edge });
    result.set(edge.source, values);
  }
  for (const values of result.values()) {
    values.sort(
      (left, right) =>
        compareText(left.nodeId, right.nodeId) ||
        compareText(left.edge.type, right.edge.type) ||
        (left.edge.evidence.line ?? 0) - (right.edge.evidence.line ?? 0),
    );
  }
  return result;
}

function buildExternalRoots(graph: RepositoryGraph): Set<string> {
  return new Set(
    [
      ...graph.entities
        .filter((entity) => entity.type === "endpoint")
        .map((entity) => entity.id),
      ...graph.entrypoints
        .filter((entrypoint) =>
          entrypoint.exposure === "external" &&
          entrypoint.kind === "cli" &&
          entrypoint.handlerSymbolId === undefined
        )
        .map((entrypoint) => entrypoint.fileId),
    ],
  );
}

function buildInternalRoots(graph: RepositoryGraph): Set<string> {
  return new Set(
    graph.entrypoints
      .filter((entrypoint) => entrypoint.exposure === "startup")
      .flatMap((entrypoint) => [
        entrypoint.id,
        ...(REACT_BOOTSTRAP_ENTRYPOINT_NAMES.has(entrypoint.name)
          ? [entrypoint.fileId]
          : []),
        ...(entrypoint.handlerSymbolId === undefined
          ? []
          : [entrypoint.handlerSymbolId]),
      ]),
  );
}

function buildTestRoots(graph: RepositoryGraph): Set<string> {
  return new Set(
    graph.files
      .filter((file) => isTestFilePath(file.path))
      .map((file) => file.id),
  );
}

function equivalentTargetIds(
  index: ReachabilityGraphIndex,
  nodeId: string,
): Set<string> {
  const result = new Set([nodeId]);
  const entity = index.entitiesById.get(nodeId);
  if (entity !== undefined && "symbolId" in entity) result.add(entity.symbolId);
  if (entity?.type === "endpoint") result.add(entity.entrypointId);
  for (const id of index.entityIdsBySymbolId.get(nodeId) ?? []) result.add(id);
  for (const id of index.endpointIdsByEntrypointId.get(nodeId) ?? []) result.add(id);
  return result;
}

function hasMeaningfulIncidentEdge(
  index: ReachabilityGraphIndex,
  targetIds: ReadonlySet<string>,
): boolean {
  return [...targetIds].some((id) => index.meaningfulIncidentNodeIds.has(id));
}

function assertNode(
  index: ReachabilityGraphIndex,
  nodeId: string,
): RepositoryNode {
  if (nodeId.trim().length === 0) throw new Error("Node ID must not be empty");
  const node = index.nodesById.get(nodeId);
  if (node === undefined) throw new Error(`Graph node not found: ${JSON.stringify(nodeId)}`);
  return node;
}

function reachabilityGraphIndex(graph: RepositoryGraph): ReachabilityGraphIndex {
  const cached = graphIndexes.get(graph);
  if (cached !== undefined) return cached;
  if (!validatedGraphs.has(graph)) {
    validateRepositoryGraph(graph);
    validatedGraphs.add(graph);
  }

  const nodesById = new Map<string, RepositoryNode>();
  for (const node of [
    ...graph.files,
    ...graph.symbols,
    ...graph.entrypoints,
    ...graph.entities,
  ]) {
    nodesById.set(node.id, node);
  }

  const entitiesById = new Map(
    graph.entities.map((entity) => [entity.id, entity]),
  );
  const entityIdsBySymbolId = new Map<string, string[]>();
  const endpointIdsByEntrypointId = new Map<string, string[]>();
  for (const entity of graph.entities) {
    if ("symbolId" in entity) {
      appendIndexValue(entityIdsBySymbolId, entity.symbolId, entity.id);
    }
    if (entity.type === "endpoint") {
      appendIndexValue(endpointIdsByEntrypointId, entity.entrypointId, entity.id);
    }
  }

  const meaningfulIncidentNodeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === "CONTAINS" || edge.type === "IMPORTS") continue;
    meaningfulIncidentNodeIds.add(edge.source);
    meaningfulIncidentNodeIds.add(edge.target);
  }

  const created: ReachabilityGraphIndex = {
    nodesById,
    entitiesById,
    entityIdsBySymbolId,
    endpointIdsByEntrypointId,
    adjacency: buildProductAdjacency(graph),
    externalAdjacency: buildProductAdjacency(graph, true),
    externalRoots: buildExternalRoots(graph),
    internalRoots: buildInternalRoots(graph),
    testRoots: buildTestRoots(graph),
    meaningfulIncidentNodeIds,
    traversalsByMaxDepth: new Map(),
  };
  graphIndexes.set(graph, created);
  return created;
}

function appendIndexValue(
  index: Map<string, string[]>,
  key: string,
  value: string,
): void {
  const values = index.get(key) ?? [];
  values.push(value);
  index.set(key, values);
}

function multiSourceTraversal(
  index: ReachabilityGraphIndex,
  maxDepth: number,
): MultiSourceTraversal {
  const cached = index.traversalsByMaxDepth.get(maxDepth);
  if (cached !== undefined) return cached;

  const result: MultiSourceTraversal = {
    external: emptyRootTraversal(),
    internal: emptyRootTraversal(),
    test: emptyRootTraversal(),
  };
  const rootsByKind: Record<ReachabilityRootKind, ReadonlySet<string>> = {
    external: index.externalRoots,
    internal: index.internalRoots,
    test: index.testRoots,
  };
  const kinds: ReachabilityRootKind[] = ["external", "internal", "test"];
  const queue: Array<{ kind: ReachabilityRootKind; nodeId: string }> = [];
  for (const kind of kinds) {
    for (const root of [...rootsByKind[kind]].sort(compareText)) {
      result[kind].distances.set(root, 0);
      queue.push({ kind, nodeId: root });
    }
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (current === undefined) continue;
    const traversal = result[current.kind];
    const depth = traversal.distances.get(current.nodeId);
    if (depth === undefined || depth >= maxDepth) continue;
    const nextDepth = depth + 1;
    const adjacency = current.kind === "external"
      ? index.externalAdjacency
      : index.adjacency;
    for (const neighbor of adjacency.get(current.nodeId) ?? []) {
      const knownDepth = traversal.distances.get(neighbor.nodeId);
      if (knownDepth === undefined) {
        traversal.distances.set(neighbor.nodeId, nextDepth);
        traversal.predecessors.set(neighbor.nodeId, [{
          nodeId: current.nodeId,
          edge: neighbor.edge,
        }]);
        queue.push({ kind: current.kind, nodeId: neighbor.nodeId });
      } else if (knownDepth === nextDepth) {
        const values = traversal.predecessors.get(neighbor.nodeId) ?? [];
        values.push({ nodeId: current.nodeId, edge: neighbor.edge });
        traversal.predecessors.set(neighbor.nodeId, values);
      }
    }
  }

  index.traversalsByMaxDepth.set(maxDepth, result);
  return result;
}

function emptyRootTraversal(): RootTraversal {
  return {
    distances: new Map(),
    predecessors: new Map(),
    pathsByNodeId: new Map(),
  };
}

function classifyReachability(
  index: ReachabilityGraphIndex,
  traversal: MultiSourceTraversal,
  nodeId: string,
  targets: ReadonlySet<string>,
  maxPaths: number,
): ReachabilityResult {
  if (reachesAnyTarget(traversal.external, targets)) {
    return {
      nodeId,
      status: "reachable",
      reachable: true,
      confidence: "proven",
      reason: "At least one directed evidence path starts at an external endpoint.",
      paths: pathsToTargets(traversal.external, targets, maxPaths),
    };
  }
  if (reachesAnyTarget(traversal.internal, targets)) {
    return {
      nodeId,
      status: "internally_reachable",
      reachable: false,
      confidence: "proven",
      reason: "The node is reachable from startup infrastructure but not from an external endpoint.",
      paths: pathsToTargets(traversal.internal, targets, maxPaths),
    };
  }
  if (reachesAnyTarget(traversal.test, targets)) {
    return {
      nodeId,
      status: "test_only",
      reachable: false,
      confidence: "proven",
      reason: "The only discovered directed path starts in test code.",
      paths: pathsToTargets(traversal.test, targets, maxPaths),
    };
  }
  if (!hasMeaningfulIncidentEdge(index, targets)) {
    return {
      nodeId,
      status: "unknown",
      reachable: false,
      confidence: "tentative",
      reason: "No external, startup, test, or meaningful incident path was found. Absence of a graph path cannot prove dead code, so reachability remains unresolved.",
      paths: [],
    };
  }
  return {
    nodeId,
    status: "unknown",
    reachable: false,
    confidence: "tentative",
    reason: "Graph evidence is connected but does not establish a path from a recognized root.",
    paths: [],
  };
}

function reachesAnyTarget(
  traversal: RootTraversal,
  targets: ReadonlySet<string>,
): boolean {
  return [...targets].some((target) => traversal.distances.has(target));
}

function pathsToTargets(
  traversal: RootTraversal,
  targets: ReadonlySet<string>,
  maxPaths: number,
): EvidencePath[] {
  const paths = [...targets]
    .flatMap((target) => shortestPathsToNode(traversal, target))
    .filter((path) =>
      path.nodeIds
        .slice(0, -1)
        .every((nodeId) => !targets.has(nodeId))
    );
  paths.sort(comparePaths);
  return paths.slice(0, maxPaths);
}

function shortestPathsToNode(
  traversal: RootTraversal,
  nodeId: string,
): EvidencePath[] {
  const cached = traversal.pathsByNodeId.get(nodeId);
  if (cached !== undefined) return cached;
  const depth = traversal.distances.get(nodeId);
  if (depth === undefined) return [];
  if (depth === 0) {
    const rootPath = [{ nodeIds: [nodeId], edges: [] }];
    traversal.pathsByNodeId.set(nodeId, rootPath);
    return rootPath;
  }

  const paths: EvidencePath[] = [];
  for (const predecessor of traversal.predecessors.get(nodeId) ?? []) {
    for (const path of shortestPathsToNode(traversal, predecessor.nodeId)) {
      paths.push({
        nodeIds: [...path.nodeIds, nodeId],
        edges: [...path.edges, predecessor.edge],
      });
    }
  }
  paths.sort(comparePaths);
  const limited = paths.slice(0, MAX_PATHS);
  traversal.pathsByNodeId.set(nodeId, limited);
  return limited;
}

function resolveLimits(options: ReachabilityOptions): {
  maxDepth: number;
  maxPaths: number;
} {
  return {
    maxDepth: boundedInteger(options.maxDepth, DEFAULT_MAX_DEPTH, MAX_DEPTH, "maxDepth"),
    maxPaths: boundedInteger(options.maxPaths, DEFAULT_MAX_PATHS, MAX_PATHS, "maxPaths"),
  };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return Math.min(resolved, maximum);
}

function comparePaths(left: EvidencePath, right: EvidencePath): number {
  return (
    left.edges.length - right.edges.length ||
    compareText(left.nodeIds.join("\u0000"), right.nodeIds.join("\u0000"))
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
