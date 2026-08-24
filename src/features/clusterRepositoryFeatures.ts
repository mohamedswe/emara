import type {
  EdgeType,
  EntryPointNode,
  RepositoryGraph,
  RepositoryNode,
} from "../graph/types.js";
import { validateRepositoryGraph } from "../graph/validateRepositoryGraph.ts";
import {
  buildReachabilityLedger,
  type ProductReachabilityStatus,
  type ReachabilityLedger,
  type ReachabilityLedgerEntry,
} from "../retrieval/reachabilityLedger.ts";

export type FeatureClusterMemberRole =
  | "entrypoint"
  | "ui"
  | "handler"
  | "service"
  | "schema"
  | "event"
  | "test"
  | "config"
  | "file";

export type FeatureClusterRelationship =
  | EdgeType
  | "EQUIVALENT_TO"
  | "EVENT_CONSUMED_BY"
  | "INITIALIZED_BY"
  | "MEMBER_OF"
  | "DECLARED_IN";

export interface FeatureDocumentationSeed {
  id: string;
  evidenceNodeId: string;
  text: string;
  heading?: string | null;
}

export interface FeatureClusterPathStep {
  source: string;
  target: string;
  relationship: FeatureClusterRelationship;
  weight: number;
}

export interface FeatureClusterMember {
  nodeId: string;
  role: FeatureClusterMemberRole;
  score: number;
  path: FeatureClusterPathStep[];
  reachabilityStatus: ProductReachabilityStatus;
}

export interface FeatureCluster {
  id: string;
  label: string;
  seedEntrypointIds: string[];
  documentationSeedIds: string[];
  members: FeatureClusterMember[];
}

export interface DocumentationClusterMapping {
  documentationSeedId: string;
  featureClusterIds: string[];
  score: number;
  matchedTerms: string[];
  status: "matched" | "unmatched";
}

export interface SharedSubsystemCluster {
  id: string;
  label: string;
  memberNodeIds: string[];
  featureClusterIds: string[];
}

export interface UnassignedCodeCandidate {
  nodeId: string;
  name: string;
  nodeType: string;
  fileId: string;
  exported: boolean | null;
  meaningfulIncidentEdges: number;
  reviewKind: "isolated" | "disconnected";
  reason: string;
  reachabilityStatus: ProductReachabilityStatus;
  confidence: ReachabilityLedgerEntry["confidence"];
  blockers: string[];
}

export interface FeatureClusteringResult {
  clusters: FeatureCluster[];
  sharedSubsystems: SharedSubsystemCluster[];
  documentationMappings: DocumentationClusterMapping[];
  unassignedCode: UnassignedCodeCandidate[];
  reachabilityLedger: ReachabilityLedger;
  statistics: {
    externalEntrypoints: number;
    clusteredNodes: number;
    overlappingNodes: number;
    unassignedCodeNodes: number;
  };
}

export interface FeatureImpact {
  nodeId: string;
  featureClusterIds: string[];
  sharedSubsystemIds: string[];
  relatedNodeIds: string[];
}

export interface FeatureClusteringOptions {
  documentationSeeds?: FeatureDocumentationSeed[];
  maxDepth?: number;
  minimumMembershipScore?: number;
  minimumSharedScore?: number;
  minimumDocumentationScore?: number;
  edgeWeights?: Partial<Record<EdgeType, number>>;
  reachabilityLedger?: ReachabilityLedger;
}

interface Traversal {
  target: string;
  relationship: FeatureClusterRelationship;
  weight: number;
}

interface ScoredPath {
  nodeId: string;
  score: number;
  depth: number;
  path: FeatureClusterPathStep[];
}

const DEFAULT_EDGE_WEIGHTS: Record<EdgeType, number> = {
  CONTAINS: 0,
  IMPORTS: 0,
  CALLS: 0.92,
  REFERENCES: 0.64,
  HANDLED_BY: 1,
  VALIDATED_BY: 0.86,
  TESTED_BY: 0.72,
  RENDERS: 0.88,
  PUBLISHES: 0.86,
  SUBSCRIBES_TO: 0.84,
  CONFIGURED_BY: 0.72,
};
const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MINIMUM_MEMBERSHIP_SCORE = 0.28;
const DEFAULT_MINIMUM_SHARED_SCORE = 0.4;
const DEFAULT_MINIMUM_DOCUMENTATION_SCORE = 0.12;
const FILE_CONTEXT_WEIGHT = 0.72;
const EVENT_CONSUMER_WEIGHT = 0.82;
const EQUIVALENCE_WEIGHT = 1;
const CLASS_MEMBERSHIP_WEIGHT = 0.72;
const INSTANCE_INITIALIZATION_WEIGHT = 0.78;
const SCORE_EPSILON = 1e-9;
const NON_SUBSYSTEM_ROLES = new Set<FeatureClusterMemberRole>([
  "entrypoint",
  "handler",
  "test",
  "file",
]);
const NON_TRAVERSAL_EDGE_TYPES = new Set<EdgeType>(["CONTAINS", "IMPORTS"]);
const GENERIC_TERMS = new Set([
  "app",
  "application",
  "component",
  "feature",
  "file",
  "function",
  "handler",
  "index",
  "main",
  "module",
  "route",
  "service",
  "source",
  "src",
  "support",
  "system",
  "that",
  "their",
  "this",
  "with",
]);

/**
 * Creates deterministic, overlapping feature slices from external entrypoints.
 * This is deliberately graph-first: an LLM may label or merge the candidates
 * later, but it is not required to discover their implementation membership.
 */
export function clusterRepositoryFeatures(
  graph: RepositoryGraph,
  options: FeatureClusteringOptions = {},
): FeatureClusteringResult {
  validateRepositoryGraph(graph);
  const resolved = resolveOptions(options);
  assertDocumentationSeeds(resolved.documentationSeeds);

  const nodes = allNodes(graph);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const reachabilityLedger = options.reachabilityLedger ??
    buildReachabilityLedger(graph);
  if (reachabilityLedger.graphVersion !== graph.version) {
    throw new Error("Reachability ledger graph version does not match repository graph");
  }
  const reachabilityById = new Map(
    reachabilityLedger.entries.map((entry) => [entry.nodeId, entry]),
  );
  const handlerIds = new Set(
    graph.entrypoints.flatMap((entrypoint) =>
      entrypoint.handlerSymbolId === undefined
        ? []
        : [entrypoint.handlerSymbolId],
    ),
  );
  const adjacency = buildAdjacency(graph, resolved.edgeWeights);
  const externalEntrypoints = graph.entrypoints
    .filter((entrypoint) => entrypoint.exposure === "external")
    .sort((left, right) => compareText(left.id, right.id));

  const clusters = externalEntrypoints.map((entrypoint) =>
    buildEntrypointCluster(
      graph,
      entrypoint,
      adjacency,
      nodesById,
      handlerIds,
      resolved.maxDepth,
      resolved.minimumMembershipScore,
      resolved.edgeWeights.CONFIGURED_BY,
      reachabilityById,
    ),
  );

  const documentationMappings = mapDocumentation(
    resolved.documentationSeeds,
    clusters,
    nodesById,
    resolved.minimumDocumentationScore,
  );
  const documentationIdsByCluster = new Map<string, string[]>();
  for (const mapping of documentationMappings) {
    for (const clusterId of mapping.featureClusterIds) {
      const values = documentationIdsByCluster.get(clusterId) ?? [];
      values.push(mapping.documentationSeedId);
      documentationIdsByCluster.set(clusterId, values);
    }
  }
  const documentedClusters = clusters.map((cluster) => ({
    ...cluster,
    documentationSeedIds: [
      ...(documentationIdsByCluster.get(cluster.id) ?? []),
    ].sort(compareText),
  }));

  const sharedSubsystems = buildSharedSubsystems(
    graph,
    documentedClusters,
    nodesById,
    resolved.minimumSharedScore,
  );
  const assignedNodeIds = new Set(
    [
      ...documentedClusters.flatMap((cluster) =>
        cluster.members.map((member) => member.nodeId),
      ),
      ...sharedSubsystems.flatMap((subsystem) => subsystem.memberNodeIds),
    ],
  );
  const unassignedCode = buildUnassignedCandidates(
    graph,
    assignedNodeIds,
    reachabilityById,
  );
  const membershipCounts = countMemberships(documentedClusters);

  const result: FeatureClusteringResult = {
    clusters: documentedClusters,
    sharedSubsystems,
    documentationMappings,
    unassignedCode,
    reachabilityLedger,
    statistics: {
      externalEntrypoints: externalEntrypoints.length,
      clusteredNodes: membershipCounts.size,
      overlappingNodes: [...membershipCounts.values()].filter(
        (count) => count > 1,
      ).length,
      unassignedCodeNodes: unassignedCode.length,
    },
  };
  assertFeatureClustersRespectReachability(result);
  return result;
}

/** Fails closed if cluster membership contradicts deterministic liveness. */
export function assertFeatureClustersRespectReachability(
  result: FeatureClusteringResult,
): void {
  const entries = new Map(
    result.reachabilityLedger.entries.map((entry) => [entry.nodeId, entry]),
  );
  for (const cluster of result.clusters) {
    for (const member of cluster.members) {
      const ledgerEntry = entries.get(member.nodeId);
      if (ledgerEntry === undefined) {
        throw new Error(
          `Feature cluster ${JSON.stringify(cluster.id)} contains node without reachability evidence: ${JSON.stringify(member.nodeId)}`,
        );
      }
      if (ledgerEntry.status !== member.reachabilityStatus) {
        throw new Error(
          `Feature cluster ${JSON.stringify(cluster.id)} has stale reachability for ${JSON.stringify(member.nodeId)}`,
        );
      }
      if (!featureMemberAllowed(member, ledgerEntry.status)) {
        throw new Error(
          `Feature cluster ${JSON.stringify(cluster.id)} contains disallowed ${ledgerEntry.status} node ${JSON.stringify(member.nodeId)}`,
        );
      }
    }
  }
}

/** Returns the feature and shared-subsystem blast radius for an existing node. */
export function findFeatureImpact(
  result: FeatureClusteringResult,
  nodeId: string,
): FeatureImpact {
  if (nodeId.trim().length === 0) throw new Error("Node ID must not be empty");
  const featureClusters = result.clusters.filter((cluster) =>
    cluster.members.some((member) => member.nodeId === nodeId),
  );
  const sharedSubsystems = result.sharedSubsystems.filter((subsystem) =>
    subsystem.memberNodeIds.includes(nodeId),
  );
  return {
    nodeId,
    featureClusterIds: featureClusters
      .map((cluster) => cluster.id)
      .sort(compareText),
    sharedSubsystemIds: sharedSubsystems
      .map((subsystem) => subsystem.id)
      .sort(compareText),
    relatedNodeIds: [...new Set(
      featureClusters.flatMap((cluster) =>
        cluster.members.map((member) => member.nodeId),
      ),
    )]
      .filter((candidate) => candidate !== nodeId)
      .sort(compareText),
  };
}

function buildEntrypointCluster(
  graph: RepositoryGraph,
  entrypoint: EntryPointNode,
  adjacency: ReadonlyMap<string, Traversal[]>,
  nodesById: ReadonlyMap<string, RepositoryNode>,
  handlerIds: ReadonlySet<string>,
  maxDepth: number,
  minimumScore: number,
  configurationWeight: number,
  reachabilityById: ReadonlyMap<string, ReachabilityLedgerEntry>,
): FeatureCluster {
  const seeds = new Set([entrypoint.id]);
  if (entrypoint.handlerSymbolId !== undefined) {
    seeds.add(entrypoint.handlerSymbolId);
  }
  for (const entity of graph.entities) {
    if (entity.type === "endpoint" && entity.entrypointId === entrypoint.id) {
      seeds.add(entity.id);
    }
  }
  const paths = propagate(seeds, adjacency, maxDepth, minimumScore);
  attachOwningFiles(paths, nodesById, minimumScore);
  attachConfiguration(graph, paths, minimumScore, configurationWeight);

  const members = [...paths.values()]
    .map((path): FeatureClusterMember => ({
      nodeId: path.nodeId,
      role: memberRole(
        nodesById.get(path.nodeId),
        path.nodeId === entrypoint.handlerSymbolId,
        handlerIds,
      ),
      score: roundScore(path.score),
      path: path.path.map((step) => ({ ...step })),
      reachabilityStatus:
        reachabilityById.get(path.nodeId)?.status ?? "dynamic_unknown",
    }))
    .filter((member) =>
      featureMemberAllowed(member, member.reachabilityStatus)
    )
    .sort(compareMembers);

  return {
    id: `feature:${entrypoint.id}`,
    label: entrypointLabel(entrypoint),
    seedEntrypointIds: [entrypoint.id],
    documentationSeedIds: [],
    members,
  };
}

function propagate(
  seeds: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, Traversal[]>,
  maxDepth: number,
  minimumScore: number,
): Map<string, ScoredPath> {
  const best = new Map<string, ScoredPath>();
  const queue = new MaxScoreQueue();
  for (const nodeId of [...seeds].sort(compareText)) {
    const seed = { nodeId, score: 1, depth: 0, path: [] };
    best.set(nodeId, seed);
    queue.push(seed);
  }

  while (queue.size > 0) {
    const current = queue.pop();
    if (current === undefined) break;
    const known = best.get(current.nodeId);
    if (known === undefined || current.score + SCORE_EPSILON < known.score) {
      continue;
    }
    if (current.depth >= maxDepth) continue;

    for (const edge of adjacency.get(current.nodeId) ?? []) {
      const score = current.score * edge.weight;
      if (score + SCORE_EPSILON < minimumScore) continue;
      const previous = best.get(edge.target);
      if (previous !== undefined && previous.score + SCORE_EPSILON >= score) {
        continue;
      }
      const next: ScoredPath = {
        nodeId: edge.target,
        score,
        depth: current.depth + 1,
        path: [
          ...current.path,
          {
            source: current.nodeId,
            target: edge.target,
            relationship: edge.relationship,
            weight: edge.weight,
          },
        ],
      };
      best.set(edge.target, next);
      queue.push(next);
    }
  }
  return best;
}

function buildAdjacency(
  graph: RepositoryGraph,
  edgeWeights: Readonly<Record<EdgeType, number>>,
): Map<string, Traversal[]> {
  const adjacency = new Map<string, Traversal[]>();
  for (const edge of graph.edges) {
    const weight = edgeWeights[edge.type];
    if (weight <= 0) continue;
    addTraversal(adjacency, edge.source, {
      target: edge.target,
      relationship: edge.type,
      weight,
    });
    if (edge.type === "SUBSCRIBES_TO") {
      addTraversal(adjacency, edge.target, {
        target: edge.source,
        relationship: "EVENT_CONSUMED_BY",
        weight: Math.min(weight, EVENT_CONSUMER_WEIGHT),
      });
    }
  }

  for (const entity of graph.entities) {
    if ("symbolId" in entity) {
      addEquivalence(adjacency, entity.id, entity.symbolId);
    }
    if (entity.type === "endpoint") {
      addEquivalence(adjacency, entity.id, entity.entrypointId);
    }
  }
  addClassContext(adjacency, graph);
  for (const values of adjacency.values()) {
    values.sort(
      (left, right) =>
        compareText(left.target, right.target) ||
        compareText(left.relationship, right.relationship),
    );
  }
  return adjacency;
}

function addClassContext(
  adjacency: Map<string, Traversal[]>,
  graph: RepositoryGraph,
): void {
  const symbolsByFile = new Map<string, typeof graph.symbols>();
  for (const symbol of graph.symbols) {
    const values = symbolsByFile.get(symbol.fileId) ?? [];
    values.push(symbol);
    symbolsByFile.set(symbol.fileId, values);
  }

  for (const symbols of symbolsByFile.values()) {
    for (const method of symbols) {
      if (method.type !== "function") continue;
      const separator = method.name.lastIndexOf(".");
      if (separator <= 0) continue;
      const className = method.name.slice(0, separator);
      const memberName = method.name.slice(separator + 1);
      const classCandidates = symbols.filter(
        (symbol) => symbol.type === "class" && symbol.name === className,
      );
      if (classCandidates.length !== 1) continue;
      const classSymbol = classCandidates[0];
      if (classSymbol === undefined) continue;
      addTraversal(adjacency, method.id, {
        target: classSymbol.id,
        relationship: "MEMBER_OF",
        weight: CLASS_MEMBERSHIP_WEIGHT,
      });

      if (memberName === "__init__" || memberName === "constructor") continue;
      const constructors = symbols.filter(
        (symbol) =>
          symbol.type === "function" &&
          (symbol.name === `${className}.__init__` ||
            symbol.name === `${className}.constructor`),
      );
      if (constructors.length !== 1 || constructors[0] === undefined) continue;
      addTraversal(adjacency, method.id, {
        target: constructors[0].id,
        relationship: "INITIALIZED_BY",
        weight: INSTANCE_INITIALIZATION_WEIGHT,
      });
    }
  }
}

function addEquivalence(
  adjacency: Map<string, Traversal[]>,
  left: string,
  right: string,
): void {
  addTraversal(adjacency, left, {
    target: right,
    relationship: "EQUIVALENT_TO",
    weight: EQUIVALENCE_WEIGHT,
  });
  addTraversal(adjacency, right, {
    target: left,
    relationship: "EQUIVALENT_TO",
    weight: EQUIVALENCE_WEIGHT,
  });
}

function addTraversal(
  adjacency: Map<string, Traversal[]>,
  source: string,
  traversal: Traversal,
): void {
  const values = adjacency.get(source) ?? [];
  values.push(traversal);
  adjacency.set(source, values);
}

function attachOwningFiles(
  paths: Map<string, ScoredPath>,
  nodesById: ReadonlyMap<string, RepositoryNode>,
  minimumScore: number,
): void {
  for (const path of [...paths.values()]) {
    const node = nodesById.get(path.nodeId);
    const fileId = owningFileId(node);
    if (fileId === undefined) continue;
    const score = path.score * FILE_CONTEXT_WEIGHT;
    if (score + SCORE_EPSILON < minimumScore) continue;
    const previous = paths.get(fileId);
    if (previous !== undefined && previous.score + SCORE_EPSILON >= score) {
      continue;
    }
    paths.set(fileId, {
      nodeId: fileId,
      score,
      depth: path.depth + 1,
      path: [
        ...path.path,
        {
          source: path.nodeId,
          target: fileId,
          relationship: "DECLARED_IN",
          weight: FILE_CONTEXT_WEIGHT,
        },
      ],
    });
  }
}

function attachConfiguration(
  graph: RepositoryGraph,
  paths: Map<string, ScoredPath>,
  minimumScore: number,
  configurationWeight: number,
): void {
  for (const edge of graph.edges) {
    if (edge.type !== "CONFIGURED_BY") continue;
    const source = paths.get(edge.source);
    if (source === undefined) continue;
    const score = source.score * configurationWeight;
    if (score + SCORE_EPSILON < minimumScore) continue;
    const previous = paths.get(edge.target);
    if (previous !== undefined && previous.score + SCORE_EPSILON >= score) {
      continue;
    }
    paths.set(edge.target, {
      nodeId: edge.target,
      score,
      depth: source.depth + 1,
      path: [
        ...source.path,
        {
          source: edge.source,
          target: edge.target,
          relationship: edge.type,
          weight: configurationWeight,
        },
      ],
    });
  }
}

function buildSharedSubsystems(
  graph: RepositoryGraph,
  clusters: FeatureCluster[],
  nodesById: ReadonlyMap<string, RepositoryNode>,
  minimumSharedScore: number,
): SharedSubsystemCluster[] {
  const memberships = new Map<string, Set<string>>();
  const sharedMemberships = new Map<string, Set<string>>();
  for (const cluster of clusters) {
    for (const member of cluster.members) {
      const allValues = memberships.get(member.nodeId) ?? new Set<string>();
      allValues.add(cluster.id);
      memberships.set(member.nodeId, allValues);
      if (
        member.score + SCORE_EPSILON < minimumSharedScore ||
        NON_SUBSYSTEM_ROLES.has(member.role)
      ) {
        continue;
      }
      const values = sharedMemberships.get(member.nodeId) ?? new Set<string>();
      values.add(cluster.id);
      sharedMemberships.set(member.nodeId, values);
    }
  }
  const sharedIds = new Set(
    [...sharedMemberships.entries()]
      .filter(([, clusterIds]) => clusterIds.size > 1)
      .map(([nodeId]) => nodeId),
  );
  const components = connectedSharedComponents(graph, sharedIds, nodesById);

  return components.map((component, index) => {
    const featureClusterIds = new Set<string>();
    const memberNodeIds = expandSubsystemMembers(graph, component, nodesById);
    for (const nodeId of memberNodeIds) {
      for (const clusterId of memberships.get(nodeId) ?? []) {
        featureClusterIds.add(clusterId);
      }
    }
    const label = subsystemLabel(component, nodesById);
    return {
      id: `subsystem:${slug(label)}:${index + 1}`,
      label,
      memberNodeIds: [...memberNodeIds].sort(compareText),
      featureClusterIds: [...featureClusterIds].sort(compareText),
    };
  });
}

function expandSubsystemMembers(
  graph: RepositoryGraph,
  component: string[],
  nodesById: ReadonlyMap<string, RepositoryNode>,
): Set<string> {
  const result = new Set(component);
  const fileIds = new Set(
    component.flatMap((nodeId) => {
      const fileId = owningFileId(nodesById.get(nodeId));
      return fileId === undefined ? [] : [fileId];
    }),
  );
  for (const fileId of fileIds) result.add(fileId);
  for (const node of [...graph.symbols, ...graph.entities]) {
    if (fileIds.has(node.fileId)) result.add(node.id);
  }
  return result;
}

function connectedSharedComponents(
  graph: RepositoryGraph,
  sharedIds: ReadonlySet<string>,
  nodesById: ReadonlyMap<string, RepositoryNode>,
): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const nodeId of sharedIds) adjacency.set(nodeId, new Set());
  for (const edge of graph.edges) {
    if (
      NON_TRAVERSAL_EDGE_TYPES.has(edge.type) ||
      !sharedIds.has(edge.source) ||
      !sharedIds.has(edge.target)
    ) {
      continue;
    }
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  const byFile = new Map<string, string[]>();
  for (const nodeId of sharedIds) {
    const fileId = owningFileId(nodesById.get(nodeId));
    if (fileId === undefined) continue;
    const values = byFile.get(fileId) ?? [];
    values.push(nodeId);
    byFile.set(fileId, values);
  }
  for (const values of byFile.values()) {
    for (const left of values) {
      for (const right of values) {
        if (left !== right) adjacency.get(left)?.add(right);
      }
    }
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const start of [...sharedIds].sort(compareText)) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const queue = [start];
    visited.add(start);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (current === undefined) continue;
      component.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort(compareText)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component.sort(compareText));
  }
  return components.sort((left, right) =>
    compareText(left[0] ?? "", right[0] ?? ""),
  );
}

function mapDocumentation(
  seeds: FeatureDocumentationSeed[],
  clusters: FeatureCluster[],
  nodesById: ReadonlyMap<string, RepositoryNode>,
  minimumScore: number,
): DocumentationClusterMapping[] {
  const vocabularies = new Map(
    clusters.map((cluster) => [
      cluster.id,
      clusterVocabulary(cluster, nodesById),
    ]),
  );
  const documentFrequency = new Map<string, number>();
  for (const vocabulary of vocabularies.values()) {
    for (const term of vocabulary) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  return [...seeds]
    .sort((left, right) => compareText(left.id, right.id))
    .map((seed) => {
      const terms = tokenize(`${seed.heading ?? ""} ${seed.text}`);
      const scored = clusters
        .map((cluster) => {
          const vocabulary = vocabularies.get(cluster.id) ?? new Set<string>();
          const matchedTerms = [...terms]
            .filter((term) => vocabulary.has(term))
            .sort(compareText);
          const totalWeight = [...terms].reduce(
            (total, term) =>
              total + inverseDocumentFrequency(
                term,
                clusters.length,
                documentFrequency,
              ),
            0,
          );
          const matchedWeight = matchedTerms.reduce(
            (total, term) =>
              total + inverseDocumentFrequency(
                term,
                clusters.length,
                documentFrequency,
              ),
            0,
          );
          return {
            clusterId: cluster.id,
            score: totalWeight === 0 ? 0 : matchedWeight / totalWeight,
            matchedTerms,
          };
        })
        .sort(
          (left, right) =>
            right.score - left.score ||
            compareText(left.clusterId, right.clusterId),
        );
      const bestScore = scored[0]?.score ?? 0;
      const accepted = scored.filter(
        (candidate) =>
          candidate.matchedTerms.length > 0 &&
          candidate.score + SCORE_EPSILON >= minimumScore &&
          candidate.score + SCORE_EPSILON >= bestScore * 0.8,
      );
      return {
        documentationSeedId: seed.id,
        featureClusterIds: accepted
          .map((candidate) => candidate.clusterId)
          .sort(compareText),
        score: roundScore(bestScore),
        matchedTerms: [...new Set(
          accepted.flatMap((candidate) => candidate.matchedTerms),
        )].sort(compareText),
        status: accepted.length > 0 ? "matched" : "unmatched",
      };
    });
}

function clusterVocabulary(
  cluster: FeatureCluster,
  nodesById: ReadonlyMap<string, RepositoryNode>,
): Set<string> {
  const values = [cluster.label];
  for (const member of cluster.members) {
    const node = nodesById.get(member.nodeId);
    if (node !== undefined) values.push(nodeSearchText(node));
  }
  return tokenize(values.join(" "));
}

function buildUnassignedCandidates(
  graph: RepositoryGraph,
  assignedNodeIds: ReadonlySet<string>,
  reachabilityById: ReadonlyMap<string, ReachabilityLedgerEntry>,
): UnassignedCodeCandidate[] {
  const meaningfulEdges = graph.edges.filter(
    (edge) => !NON_TRAVERSAL_EDGE_TYPES.has(edge.type),
  );
  const supportSymbolIds = new Set(
    graph.entities.flatMap((entity) =>
      (entity.type === "config" || entity.type === "test") && "symbolId" in entity
        ? [entity.symbolId]
        : [],
    ),
  );
  const testFileIds = new Set(
    graph.entities
      .filter((entity) => entity.type === "test")
      .map((entity) => entity.fileId),
  );
  return [
    ...graph.symbols,
    ...graph.entities.filter(
      (entity) =>
        entity.type !== "endpoint" &&
        entity.type !== "test" &&
        entity.type !== "config",
    ),
  ]
    .filter(
      (node) =>
        !assignedNodeIds.has(node.id) &&
        !supportSymbolIds.has(node.id) &&
        !testFileIds.has(node.fileId),
    )
    .map((node): UnassignedCodeCandidate => {
      const incident = meaningfulEdges.filter(
        (edge) => edge.source === node.id || edge.target === node.id,
      ).length;
      const isolated = incident === 0;
      const ledgerEntry = reachabilityById.get(node.id);
      const reachabilityStatus = ledgerEntry?.status ?? "dynamic_unknown";
      return {
        nodeId: node.id,
        name: node.name,
        nodeType: node.type,
        fileId: node.fileId,
        exported: "exported" in node ? node.exported : null,
        meaningfulIncidentEdges: incident,
        reviewKind: isolated ? "isolated" : "disconnected",
        reason: ledgerEntry?.reason ?? (isolated
          ? "No meaningful graph edge connects this node to a recognized external feature. Treat it as a dead-code candidate, not proof of dead code."
          : "The node has graph relationships but no weighted path from a recognized external feature entrypoint."),
        reachabilityStatus,
        confidence: ledgerEntry?.confidence ?? "tentative",
        blockers: [...(ledgerEntry?.blockers ?? [
          "Reachability evidence is incomplete.",
        ])],
      };
    })
    .sort((left, right) => compareText(left.nodeId, right.nodeId));
}

function featureMemberAllowed(
  member: FeatureClusterMember,
  status: ProductReachabilityStatus,
): boolean {
  if (status === "product_reachable") return true;
  if (status === "test_only") return member.role === "test";
  if (
    status === "dynamic_unknown" ||
    status === "disconnected_candidate"
  ) {
    return member.path.some(
      (step) =>
        step.relationship === "MEMBER_OF" ||
        step.relationship === "INITIALIZED_BY",
    );
  }
  return false;
}

function countMemberships(clusters: FeatureCluster[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const cluster of clusters) {
    for (const member of cluster.members) {
      result.set(member.nodeId, (result.get(member.nodeId) ?? 0) + 1);
    }
  }
  return result;
}

function memberRole(
  node: RepositoryNode | undefined,
  isSeedHandler: boolean,
  handlerIds: ReadonlySet<string>,
): FeatureClusterMemberRole {
  if (node === undefined) return "service";
  if (node.type === "entrypoint" || node.type === "endpoint") {
    return "entrypoint";
  }
  if (node.type === "component" || node.type === "screen") return "ui";
  if (node.type === "schema") return "schema";
  if (node.type === "event") return "event";
  if (node.type === "test") return "test";
  if (node.type === "config") return "config";
  if (node.type === "file") return "file";
  if (isSeedHandler || handlerIds.has(node.id)) return "handler";
  return "service";
}

function owningFileId(node: RepositoryNode | undefined): string | undefined {
  return node === undefined || node.type === "file" ? undefined : node.fileId;
}

function entrypointLabel(entrypoint: EntryPointNode): string {
  if (entrypoint.route !== undefined) {
    return `${entrypoint.httpMethod ?? entrypoint.kind} ${entrypoint.route}`;
  }
  return entrypoint.name;
}

function subsystemLabel(
  memberNodeIds: string[],
  nodesById: ReadonlyMap<string, RepositoryNode>,
): string {
  const scores = new Map<string, number>();
  for (const nodeId of memberNodeIds) {
    const node = nodesById.get(nodeId);
    if (node === undefined) continue;
    const file = nodesById.get(owningFileId(node) ?? "");
    for (const term of tokenize("name" in node ? node.name : "")) {
      scores.set(term, (scores.get(term) ?? 0) + 1);
    }
    if (file?.type === "file") {
      const basename = file.path.split("/").at(-1)?.replace(/\.[^.]+$/u, "") ?? "";
      for (const term of tokenize(basename)) {
        scores.set(term, (scores.get(term) ?? 0) + 2);
      }
    }
  }
  const term = [...scores.entries()]
    .sort(
      (left, right) =>
        right[1] - left[1] ||
        right[0].length - left[0].length ||
        compareText(left[0], right[0]),
    )[0]?.[0] ?? "shared";
  return `${term[0]?.toUpperCase() ?? "S"}${term.slice(1)} subsystem`;
}

function nodeSearchText(node: RepositoryNode): string {
  if (node.type === "file") return node.path;
  if (node.type === "entrypoint") {
    return `${node.name} ${node.route ?? ""} ${node.httpMethod ?? ""}`;
  }
  return `${node.name} ${node.fileId}`;
}

function tokenize(value: string): Set<string> {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase();
  return new Set(
    normalized
      .split(/[^a-z0-9]+/gu)
      .filter(
        (term) =>
          term.length >= 3 &&
          !/^\d+$/u.test(term) &&
          !GENERIC_TERMS.has(term),
      ),
  );
}

function inverseDocumentFrequency(
  term: string,
  clusterCount: number,
  frequency: ReadonlyMap<string, number>,
): number {
  return Math.log((clusterCount + 1) / ((frequency.get(term) ?? 0) + 1)) + 1;
}

function resolveOptions(options: FeatureClusteringOptions): {
  documentationSeeds: FeatureDocumentationSeed[];
  maxDepth: number;
  minimumMembershipScore: number;
  minimumSharedScore: number;
  minimumDocumentationScore: number;
  edgeWeights: Record<EdgeType, number>;
} {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 50) {
    throw new Error("maxDepth must be an integer between 1 and 50");
  }
  const minimumMembershipScore = boundedScore(
    options.minimumMembershipScore,
    DEFAULT_MINIMUM_MEMBERSHIP_SCORE,
    "minimumMembershipScore",
  );
  const minimumSharedScore = boundedScore(
    options.minimumSharedScore,
    DEFAULT_MINIMUM_SHARED_SCORE,
    "minimumSharedScore",
  );
  const minimumDocumentationScore = boundedScore(
    options.minimumDocumentationScore,
    DEFAULT_MINIMUM_DOCUMENTATION_SCORE,
    "minimumDocumentationScore",
  );
  const edgeWeights = { ...DEFAULT_EDGE_WEIGHTS, ...options.edgeWeights };
  for (const [edgeType, weight] of Object.entries(edgeWeights)) {
    boundedScore(weight, weight, `edgeWeights.${edgeType}`, true);
  }
  return {
    documentationSeeds: [...(options.documentationSeeds ?? [])],
    maxDepth,
    minimumMembershipScore,
    minimumSharedScore,
    minimumDocumentationScore,
    edgeWeights,
  };
}

function boundedScore(
  value: number | undefined,
  fallback: number,
  name: string,
  allowZero = false,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isFinite(resolved) ||
    resolved > 1 ||
    (allowZero ? resolved < 0 : resolved <= 0)
  ) {
    throw new Error(`${name} must be ${allowZero ? "between 0 and 1" : "greater than 0 and at most 1"}`);
  }
  return resolved;
}

function assertDocumentationSeeds(seeds: FeatureDocumentationSeed[]): void {
  const ids = new Set<string>();
  for (const seed of seeds) {
    if (
      seed.id.trim().length === 0 ||
      seed.evidenceNodeId.trim().length === 0 ||
      seed.text.trim().length === 0
    ) {
      throw new Error("Documentation seeds require non-empty id, evidenceNodeId, and text");
    }
    if (ids.has(seed.id)) {
      throw new Error(`Duplicate documentation seed ID: ${JSON.stringify(seed.id)}`);
    }
    ids.add(seed.id);
  }
}

function allNodes(graph: RepositoryGraph): RepositoryNode[] {
  return [
    ...graph.files,
    ...graph.symbols,
    ...graph.entrypoints,
    ...graph.entities,
  ];
}

function compareMembers(
  left: FeatureClusterMember,
  right: FeatureClusterMember,
): number {
  return (
    right.score - left.score ||
    compareText(left.role, right.role) ||
    compareText(left.nodeId, right.nodeId)
  );
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "") || "shared";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

class MaxScoreQueue {
  readonly #values: ScoredPath[] = [];

  get size(): number {
    return this.#values.length;
  }

  push(value: ScoredPath): void {
    this.#values.push(value);
    let index = this.#values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentValue = this.#values[parent];
      if (parentValue === undefined || compareQueue(parentValue, value) >= 0) break;
      this.#values[index] = parentValue;
      index = parent;
    }
    this.#values[index] = value;
  }

  pop(): ScoredPath | undefined {
    const first = this.#values[0];
    const last = this.#values.pop();
    if (first === undefined || last === undefined || this.#values.length === 0) {
      return first;
    }
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let child = left;
      if (
        right < this.#values.length &&
        compareQueue(this.#values[right] as ScoredPath, this.#values[left] as ScoredPath) > 0
      ) {
        child = right;
      }
      const childValue = this.#values[child];
      if (childValue === undefined || compareQueue(last, childValue) >= 0) break;
      this.#values[index] = childValue;
      index = child;
    }
    this.#values[index] = last;
    return first;
  }
}

function compareQueue(left: ScoredPath, right: ScoredPath): number {
  return (
    left.score - right.score ||
    right.depth - left.depth ||
    compareText(right.nodeId, left.nodeId)
  );
}
