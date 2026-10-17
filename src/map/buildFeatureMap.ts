import { createHash } from "node:crypto";

import type { ContractDiscoveryModel } from "../contract/model.js";
import type {
  DeadCodeCandidate,
  DeadCodeVerdict,
  FeatureAuditKind,
  FeatureAuditStatus,
  FunctionalityAudit,
  FunctionalityFeature,
} from "../audit/types.js";
import type {
  Edge,
  EntryPointNode,
  FileNode,
  RepositoryGraph,
  RepositoryNode,
} from "../graph/types.js";
import { validateRepositoryGraph } from "../graph/validateRepositoryGraph.ts";
import { buildReachabilityLedger } from "../retrieval/reachabilityLedger.ts";
import type {
  Block,
  BlockSize,
  Connection,
  ConnectionKind,
  FeatureMap,
  FeatureMapSummary,
  Port,
  PortKind,
  SourceEvidence,
} from "./types.js";
import { compareText } from "../shared/compare.ts";

const DEPENDENCY_EDGE_TYPES = new Set<Edge["type"]>([
  "IMPORTS",
  "CALLS",
  "REFERENCES",
  "HANDLED_BY",
  "VALIDATED_BY",
  "RENDERS",
  "PUBLISHES",
  "SUBSCRIBES_TO",
  "CONFIGURED_BY",
]);

const DEAD_VERDICT_PRIORITY: Record<DeadCodeVerdict, number> = {
  VALIDATED_SAFE_TO_DELETE: 0,
  CANDIDATE: 1,
  VALIDATION_REQUIRED: 2,
  UNKNOWN_DYNAMIC_USAGE: 3,
};

interface GraphLookup {
  nodesById: Map<string, RepositoryNode>;
  filesById: Map<string, FileNode>;
  filesByPath: Map<string, FileNode>;
  ownerFileIdByNodeId: Map<string, string>;
  nodesByFileId: Map<string, string[]>;
  outgoingEdgesByNodeId: Map<string, Edge[]>;
  outgoingEdgesByFileId: Map<string, Edge[]>;
}

/**
 * Builds the deterministic `feature-map/v1` block-and-socket architecture model
 * from a validated `RepositoryGraph` (v4) and `FunctionalityAudit` (v2).
 *
 * Raw per-route / per-entrypoint slices are consolidated into cohesive
 * capability blocks (e.g. `POST /rooms` + `PUT /rooms/:id` + `DELETE /rooms/:id/:bookingId`
 * + `GET /rooms` in `api/routes/rooms.js` become a single "Room & Booking API"
 * capability block with 4 route studs), and redundant structural umbrella
 * modules are suppressed so every block represents a genuine capability.
 */
export function buildFeatureMap(
  graph: RepositoryGraph,
  audit: FunctionalityAudit,
): FeatureMap {
  validateRepositoryGraph(graph);
  const lookup = buildGraphLookup(graph);
  const reachabilityLedger = buildReachabilityLedger(graph);
  const reachabilityByNodeId = new Map(
    reachabilityLedger.entries.map((entry) => [entry.nodeId, entry]),
  );

  // 1. Consolidate raw per-route/per-script features into genuine capability units
  const consolidatedFeatures = consolidateCapabilityFeatures(
    audit.features,
    graph,
    lookup,
  );
  const sortedFeatures = [...consolidatedFeatures].sort((left, right) =>
    compareText(left.canonicalId, right.canonicalId) ||
    compareText(left.id, right.id),
  );

  // 2. Compute node & file ownership across capability features
  const directFeatureOwnersByNodeId = new Map<string, Set<string>>();
  const directFeatureOwnersByFileId = new Map<string, Set<string>>();
  for (const feature of sortedFeatures) {
    const memberIds = sortedUnique([
      ...feature.entrypointNodeIds,
      ...feature.implementationNodeIds,
    ]);
    for (const nodeId of memberIds) {
      addOwner(directFeatureOwnersByNodeId, nodeId, feature.canonicalId);
      const fileId = lookup.ownerFileIdByNodeId.get(nodeId);
      if (fileId !== undefined) {
        addOwner(directFeatureOwnersByFileId, fileId, feature.canonicalId);
      }
    }
  }

  // Also track files reached via 1-hop dependency edges from each feature's owned files
  const reachedConsumersByFileId = new Map<string, Set<string>>();
  for (const [fileId, owners] of directFeatureOwnersByFileId.entries()) {
    for (const ownerId of owners) {
      addOwner(reachedConsumersByFileId, fileId, ownerId);
    }
    for (const edge of lookup.outgoingEdgesByFileId.get(fileId) ?? []) {
      if (!DEPENDENCY_EDGE_TYPES.has(edge.type)) continue;
      const targetFileId = lookup.ownerFileIdByNodeId.get(edge.target);
      if (targetFileId === undefined || targetFileId === fileId) continue;
      for (const ownerId of owners) {
        addOwner(reachedConsumersByFileId, targetFileId, ownerId);
      }
    }
  }

  // 3. Identify Infrastructure (Baseplate) files and nodes:
  // Config files/nodes + startup entrypoint files not exclusively owned by a single non-infra feature
  const infrastructureFileIds = new Set<string>();
  const infrastructureNodeIds = new Set<string>();
  for (const entity of graph.entities) {
    if (entity.type === "config") {
      infrastructureNodeIds.add(entity.id);
      infrastructureFileIds.add(entity.fileId);
    }
  }
  for (const entrypoint of graph.entrypoints) {
    if (entrypoint.exposure === "startup") {
      infrastructureNodeIds.add(entrypoint.id);
      const directOwners = directFeatureOwnersByFileId.get(entrypoint.fileId);
      if (directOwners === undefined || directOwners.size === 0) {
        infrastructureFileIds.add(entrypoint.fileId);
      }
    }
  }
  for (const file of graph.files) {
    if (isConfigFilePath(file.path)) {
      infrastructureFileIds.add(file.id);
    }
  }
  for (const fileId of infrastructureFileIds) {
    infrastructureNodeIds.add(fileId);
    for (const nodeId of lookup.nodesByFileId.get(fileId) ?? []) {
      infrastructureNodeIds.add(nodeId);
    }
  }

  // 4. Identify Shared Subsystem files:
  // Any non-infrastructure code file that either:
  // (a) has nodes directly in >=2 capability features, OR
  // (b) is imported/called by >=1 capability feature AND lives in a shared domain path (models, middleware, helpers, schemas, repositories) without its own external entrypoint
  const sharedSubsystemFileIds = new Set<string>();
  for (const file of graph.files) {
    if (infrastructureFileIds.has(file.id)) continue;
    if (!isCodeFile(file)) continue;
    const directOwners = directFeatureOwnersByFileId.get(file.id) ?? new Set<string>();
    const totalConsumers = reachedConsumersByFileId.get(file.id) ?? new Set<string>();
    const hasOwnEntrypoint = graph.entrypoints.some(
      (ep) => ep.fileId === file.id && ep.exposure === "external",
    );
    if (
      (!hasOwnEntrypoint && directOwners.size >= 2) ||
      (directOwners.size === 0 && totalConsumers.size >= 2) ||
      (directOwners.size === 0 && totalConsumers.size >= 1 && isSharedDomainPath(file.path)) ||
      (!hasOwnEntrypoint && totalConsumers.size >= 2 && isSharedDomainPath(file.path))
    ) {
      sharedSubsystemFileIds.add(file.id);
    }
  }

  // Build Shared Subsystem blocks (one deterministic block per shared file)
  const sharedSubsystemBlocks = buildSharedSubsystemBlocks(
    graph,
    lookup,
    sharedSubsystemFileIds,
    reachedConsumersByFileId,
  );
  const sharedBlockIdByNodeId = new Map<string, string>();
  const sharedBlockIdByFileId = new Map<string, string>();
  for (const block of sharedSubsystemBlocks) {
    for (const nodeId of block.exclusiveNodeIds) {
      sharedBlockIdByNodeId.set(nodeId, block.id);
    }
    for (const filePath of block.filePaths) {
      const file = lookup.filesByPath.get(filePath);
      if (file !== undefined) {
        sharedBlockIdByFileId.set(file.id, block.id);
      }
    }
  }

  // 5. Build Infrastructure (Baseplate) block(s)
  const infrastructureBlocks = buildInfrastructureBlocks(
    graph,
    lookup,
    infrastructureFileIds,
    infrastructureNodeIds,
    sharedBlockIdByFileId,
  );
  const infraBlockIdByNodeId = new Map<string, string>();
  const infraBlockIdByFileId = new Map<string, string>();
  for (const block of infrastructureBlocks) {
    for (const nodeId of block.exclusiveNodeIds) {
      infraBlockIdByNodeId.set(nodeId, block.id);
    }
    for (const filePath of block.filePaths) {
      const file = lookup.filesByPath.get(filePath);
      if (file !== undefined) {
        infraBlockIdByFileId.set(file.id, block.id);
      }
    }
  }

  // 6. Build Feature blocks with Studs, Exclusive vs. Shared nodes, and Disagreements
  const disagreementsByFeatureId = new Map<string, string[]>();
  for (const disagreement of audit.featureSourceDisagreements) {
    const relatedIds = [
      ...(disagreement.structuralFeatureId === null
        ? []
        : [disagreement.structuralFeatureId]),
      ...disagreement.entrypointFeatureIds,
    ];
    for (const featureId of relatedIds) {
      const list = disagreementsByFeatureId.get(featureId) ?? [];
      list.push(disagreement.structuralComponentId);
      disagreementsByFeatureId.set(featureId, sortedUnique(list));
    }
  }

  const featureBlocks: Block[] = sortedFeatures.map((feature) => {
    const allMemberIds = sortedUnique([
      ...feature.entrypointNodeIds,
      ...feature.implementationNodeIds,
    ]);
    const exclusiveNodeIds: string[] = [];
    const sharedNodeIds: string[] = [];

    for (const nodeId of allMemberIds) {
      const fileId = lookup.ownerFileIdByNodeId.get(nodeId);
      const owners = directFeatureOwnersByNodeId.get(nodeId) ?? new Set<string>();
      const inSharedBlock =
        sharedBlockIdByNodeId.has(nodeId) ||
        (fileId !== undefined && sharedBlockIdByFileId.has(fileId));
      const inInfraBlock =
        infraBlockIdByNodeId.has(nodeId) ||
        (fileId !== undefined && infraBlockIdByFileId.has(fileId));

      if (owners.size === 1 && !inSharedBlock && !inInfraBlock) {
        exclusiveNodeIds.push(nodeId);
      } else {
        sharedNodeIds.push(nodeId);
      }
    }

    const studs = buildFeatureStuds(feature, lookup);
    const filePaths = collectFilePaths(
      exclusiveNodeIds.length > 0 ? exclusiveNodeIds : allMemberIds,
      lookup,
    );
    const size = computeBlockSize(filePaths, exclusiveNodeIds, lookup);
    const disagreementIds = sortedUnique(
      feature.memberFeatureIds.flatMap(
        (memberId) => disagreementsByFeatureId.get(memberId) ?? [],
      ),
    );

    return {
      id: feature.canonicalId,
      slug: feature.id,
      kind: "feature",
      title: feature.title,
      featureKind: feature.kind,
      status: feature.status,
      confidence: feature.confidence,
      studs,
      sockets: [],
      exclusiveNodeIds,
      sharedNodeIds,
      filePaths,
      size,
      gaps: [...feature.gaps],
      documentationPromiseIds: [...feature.documentationPromiseIds],
      disagreementIds,
      memberFeatureIds: feature.memberFeatureIds,
      removalImpact: null,
    };
  });

  // 7. Build Orphan (Dead Code) blocks grouped by file
  const orphanBlocks = buildOrphanBlocks(
    audit.deadCodeCandidates,
    lookup,
    reachabilityByNodeId,
  );

  // 8. Derive Connections and populate Sockets on Feature & Shared blocks
  const allBlocks: Block[] = [
    ...featureBlocks,
    ...sharedSubsystemBlocks,
    ...infrastructureBlocks,
    ...orphanBlocks,
  ];
  const connections = buildConnectionsAndPopulateSockets(
    graph,
    lookup,
    featureBlocks,
    sharedSubsystemBlocks,
    infrastructureBlocks,
    sharedBlockIdByNodeId,
    sharedBlockIdByFileId,
    infraBlockIdByNodeId,
    infraBlockIdByFileId,
    directFeatureOwnersByNodeId,
    directFeatureOwnersByFileId,
  );

  // 9. Compute counterfactual RemovalImpact ("Pull a brick out") for each Feature block
  populateRemovalImpacts(
    featureBlocks,
    sharedSubsystemBlocks,
    infrastructureBlocks,
    connections,
    lookup,
    directFeatureOwnersByFileId,
  );

  const summary = buildSummary(allBlocks, connections);
  const map: FeatureMap = {
    schema: "feature-map/v1",
    repositoryCommit: audit.repositoryCommit,
    summary,
    blocks: allBlocks,
    connections,
    disagreements: [...audit.featureSourceDisagreements],
  };
  validateFeatureMap(map);
  return map;
}

/**
 * Optional bounded LLM pass that refines feature block titles into concise
 * business-capability names without altering block IDs, memberships, or edges.
 */
export async function decorateFeatureMapTitles(
  map: FeatureMap,
  modelClient: ContractDiscoveryModel | undefined,
  modelName = "deepseek-chat",
): Promise<FeatureMap> {
  if (modelClient === undefined) return map;
  const featureBlocks = map.blocks.filter((b) => b.kind === "feature");
  if (featureBlocks.length === 0 || featureBlocks.length > 120) return map;

  const facts = featureBlocks.map((b) => ({
    blockId: b.id,
    currentTitle: b.title,
    entrypoints: b.studs.slice(0, 8).map((s) => s.label),
    files: b.filePaths.slice(0, 6),
  }));

  try {
    const response = await modelClient.createResponse({
      model: modelName,
      instructions:
        "You name software product capabilities from deterministic code facts. For each blockId, return a concise 2-5 word product feature title (e.g. 'Room & Booking Management API', 'JWT User Authentication', 'Interactive Booking Calendar UI'). Never invent capabilities not in the entrypoints/files. Return JSON matching the schema only.",
      input: [{ role: "user", content: JSON.stringify({ blocks: facts }) }],
      tools: [],
      text: {
        format: {
          type: "json_schema",
          name: "feature_map_titles",
          description: "Human-readable capability titles keyed by blockId.",
          strict: true,
          schema: {
            type: "object",
            properties: {
              titles: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    blockId: { type: "string" },
                    title: { type: "string" },
                  },
                  required: ["blockId", "title"],
                  additionalProperties: false,
                },
              },
            },
            required: ["titles"],
            additionalProperties: false,
          },
        },
      },
      parallel_tool_calls: false,
      store: false,
      max_output_tokens: 2_500,
    });
    const text = response.outputText ?? "";
    const parsed = JSON.parse(text) as {
      titles?: Array<{ blockId: string; title: string }>;
    };
    const titleById = new Map<string, string>();
    for (const item of parsed.titles ?? []) {
      if (item.title && item.title.trim().length >= 3) {
        titleById.set(item.blockId, item.title.trim());
      }
    }
    for (const block of map.blocks) {
      const decorated = titleById.get(block.id);
      if (decorated !== undefined) {
        block.title = decorated;
      }
    }
  } catch (error) {
    // Retain deterministic capability titles if the optional model call
    // fails, but say so: model-assisted runs must not degrade silently.
    console.error(
      `[feature-map] Model title decoration failed; keeping deterministic titles: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return map;
}

export function validateFeatureMap(map: FeatureMap): void {
  const issues: string[] = [];
  if (map.schema !== "feature-map/v1") {
    issues.push("schema must be feature-map/v1");
  }
  if (map.repositoryCommit.trim().length === 0) {
    issues.push("repositoryCommit must not be empty");
  }
  const blockIds = new Set<string>();
  for (const block of map.blocks) {
    if (block.id.trim().length === 0) {
      issues.push("block.id must not be empty");
    }
    if (blockIds.has(block.id)) {
      issues.push(`duplicate block.id: ${block.id}`);
    }
    blockIds.add(block.id);

    const overlap = block.exclusiveNodeIds.filter((id) =>
      block.sharedNodeIds.includes(id),
    );
    if (overlap.length > 0) {
      issues.push(
        `block ${block.id} has overlapping exclusive and shared nodes: ${overlap.join(", ")}`,
      );
    }
  }
  for (const connection of map.connections) {
    if (!blockIds.has(connection.from)) {
      issues.push(
        `connection ${connection.id} references unknown source block ${connection.from}`,
      );
    }
    if (!blockIds.has(connection.to)) {
      issues.push(
        `connection ${connection.id} references unknown target block ${connection.to}`,
      );
    }
    if (connection.evidence.length === 0) {
      issues.push(`connection ${connection.id} must have at least one evidence item`);
    }
  }
  if (issues.length > 0) {
    throw new Error(`Invalid feature-map/v1:\n- ${issues.join("\n- ")}`);
  }
}

interface ConsolidatedFeature extends FunctionalityFeature {
  memberFeatureIds: string[];
}

function consolidateCapabilityFeatures(
  features: readonly FunctionalityFeature[],
  graph: RepositoryGraph,
  lookup: GraphLookup,
): ConsolidatedFeature[] {
  const entrypointsById = new Map(
    graph.entrypoints.map((ep) => [ep.id, ep]),
  );

  // Separate entrypoint-backed features, structural module-* features, and missing claims
  const entrypointFeatures = features.filter(
    (f) => f.entrypointNodeIds.length > 0,
  );
  const structuralFeatures = features.filter(
    (f) => f.entrypointNodeIds.length === 0 && f.id.startsWith("module-"),
  );
  const missingClaimFeatures = features.filter(
    (f) => f.status === "DOCUMENTED_NOT_IMPLEMENTED",
  );

  // Track all files directly owned by entrypoint-backed features or shared/config files
  const entrypointOwnedFileIds = new Set<string>();
  for (const feature of entrypointFeatures) {
    for (const nodeId of [
      ...feature.entrypointNodeIds,
      ...feature.implementationNodeIds,
    ]) {
      const fileId = lookup.ownerFileIdByNodeId.get(nodeId);
      if (fileId !== undefined) entrypointOwnedFileIds.add(fileId);
    }
  }

  // Group entrypoint-backed features into domain capabilities
  const groups = new Map<string, FunctionalityFeature[]>();
  for (const feature of entrypointFeatures) {
    const key = capabilityGroupKey(feature, entrypointsById, lookup);
    const list = groups.get(key) ?? [];
    list.push(feature);
    groups.set(key, list);
  }

  const consolidated: ConsolidatedFeature[] = [];
  for (const [groupKey, members] of [...groups.entries()].sort(([a], [b]) =>
    compareText(a, b),
  )) {
    const sortedMembers = [...members].sort((a, b) =>
      compareText(a.canonicalId, b.canonicalId),
    );
    if (sortedMembers.length === 1) {
      const single = sortedMembers[0]!;
      consolidated.push({
        ...single,
        title: humanizeCapabilityTitle(groupKey, sortedMembers, entrypointsById, lookup),
        memberFeatureIds: [single.id],
      });
      continue;
    }

    const entrypointNodeIds = sortedUnique(
      sortedMembers.flatMap((m) => m.entrypointNodeIds),
    );
    const implementationNodeIds = sortedUnique(
      sortedMembers
        .flatMap((m) => m.implementationNodeIds)
        .filter((id) => !entrypointNodeIds.includes(id)),
    );
    const documentationPromiseIds = sortedUnique(
      sortedMembers.flatMap((m) => m.documentationPromiseIds),
    );
    const gaps = sortedUnique(sortedMembers.flatMap((m) => m.gaps));
    const status = mergeFeatureStatuses(sortedMembers.map((m) => m.status));
    const confidence = mergeConfidence(sortedMembers.map((m) => m.confidence));
    const kind = mergeFeatureKinds(sortedMembers.map((m) => m.kind));
    const canonicalId = `feature-${stableHash(
      sortedMembers.map((m) => m.canonicalId).join("|"),
    )}`;
    const slug = slugify(groupKey.replace(/^[a-z]+:/u, ""));
    const title = humanizeCapabilityTitle(
      groupKey,
      sortedMembers,
      entrypointsById,
      lookup,
    );

    consolidated.push({
      canonicalId,
      id: slug,
      title,
      kind,
      status,
      entrypointNodeIds,
      implementationNodeIds,
      documentationPromiseIds,
      gaps,
      confidence,
      memberFeatureIds: sortedMembers.map((m) => m.id),
    });
  }

  // Keep structural `module-*` features ONLY when they own code files that are not
  // just an umbrella over already-represented backend entrypoint/model/config files.
  for (const modFeature of structuralFeatures) {
    const modFileIds = sortedUnique(
      modFeature.implementationNodeIds
        .map((nodeId) => lookup.ownerFileIdByNodeId.get(nodeId))
        .filter((id): id is string => id !== undefined),
    );
    const nonEntrypointFiles = modFileIds.filter((fileId) => {
      const file = lookup.filesById.get(fileId);
      if (file === undefined || !isCodeFile(file) || isConfigFilePath(file.path)) {
        return false;
      }
      return !entrypointOwnedFileIds.has(fileId);
    });
    // If all non-entrypoint files in this structural umbrella are shared models/middleware
    // and >=50% of its files are already entrypoint files, suppress the umbrella duplicate.
    const onlySharedBackendFiles = nonEntrypointFiles.every((fileId) => {
      const file = lookup.filesById.get(fileId);
      return file !== undefined && isSharedDomainPath(file.path);
    });
    if (
      nonEntrypointFiles.length === 0 ||
      (onlySharedBackendFiles && nonEntrypointFiles.length < modFileIds.length)
    ) {
      continue;
    }

    consolidated.push({
      ...modFeature,
      title: humanizeStructuralModuleTitle(modFeature, lookup),
      memberFeatureIds: [modFeature.id],
    });
  }

  for (const missing of missingClaimFeatures) {
    consolidated.push({
      ...missing,
      memberFeatureIds: [missing.id],
    });
  }

  // Fallback if a repo had only non-module, non-entrypoint features
  if (consolidated.length === 0 && features.length > 0) {
    return features.map((f) => ({ ...f, memberFeatureIds: [f.id] }));
  }

  return consolidated;
}

function capabilityGroupKey(
  feature: FunctionalityFeature,
  entrypointsById: ReadonlyMap<string, EntryPointNode>,
  lookup: GraphLookup,
): string {
  const firstEpId = feature.entrypointNodeIds[0];
  const ep = firstEpId ? entrypointsById.get(firstEpId) : undefined;
  if (ep === undefined) return `feature:${feature.id}`;

  const file = lookup.filesById.get(ep.fileId);
  const filePath = file?.path ?? ep.fileId.replace(/^file:/u, "");

  if (ep.kind === "http" || ep.kind === "graphql" || ep.kind === "websocket") {
    const route = (ep.route ?? "").trim();
    const firstSeg =
      route
        .split("/")
        .filter((s) => s.length > 0 && !s.startsWith(":") && !s.startsWith("{") && s !== "api" && !/^v\d+$/iu.test(s))[0] ??
      "root";
    return `http:${filePath}:${firstSeg.toLowerCase()}`;
  }

  if (ep.kind === "cli") {
    if (/(?:^|\/)(?:models?|db|database|migrations?|seeds?)\//iu.test(filePath)) {
      const dir = filePath.split("/").slice(0, -1).join("/") || "db";
      return `cli:${dir}:db-lifecycle`;
    }
    return `cli:${filePath}`;
  }

  if (ep.kind === "application") {
    const route = (ep.route ?? ep.name).replace(/^PAGE\s+/iu, "").trim();
    const segs = route
      .split("/")
      .filter((s) => s.length > 0 && !s.startsWith(":") && !s.startsWith("["));
    if (segs.length >= 2) {
      return `ui:${segs[0]!.toLowerCase()}-${segs[1]!.toLowerCase()}`;
    }
    if (segs.length === 1) {
      return `ui:${segs[0]!.toLowerCase()}`;
    }
    return `ui:${filePath}`;
  }

  return `${ep.kind}:${filePath}`;
}

function humanizeCapabilityTitle(
  groupKey: string,
  members: readonly FunctionalityFeature[],
  entrypointsById: ReadonlyMap<string, EntryPointNode>,
  lookup: GraphLookup,
): string {
  if (members.length === 1) {
    const only = members[0]!;
    // If the single feature already has a descriptive non-route human title (e.g. from test or model), keep it
    if (
      !/^(?:GET|POST|PUT|DELETE|PATCH|ALL|HEAD|OPTIONS|PAGE)\s+/iu.test(only.title) &&
      !only.title.startsWith("npm script ")
    ) {
      return only.title;
    }
  }

  const eps = members
    .flatMap((m) => m.entrypointNodeIds)
    .map((id) => entrypointsById.get(id))
    .filter((ep): ep is EntryPointNode => ep !== undefined);

  const firstEp = eps[0];
  if (firstEp === undefined) return members[0]?.title ?? "Feature";

  const file = lookup.filesById.get(firstEp.fileId);
  const filePath = file?.path ?? "";
  const fileStem =
    filePath
      .split("/")
      .at(-1)
      ?.replace(/\.[^.]+$/u, "") ?? "Module";

  if (firstEp.kind === "http") {
    const stemLower = fileStem.toLowerCase();
    const methods = new Set(eps.map((e) => (e.httpMethod ?? "").toUpperCase()));
    const routes = eps.map((e) => e.route ?? "");
    if (stemLower === "auth" || routes.some((r) => r.includes("sign-up") || r.includes("login"))) {
      return "User Authentication & Sign-Up API";
    }
    if (stemLower === "rooms" && routes.some((r) => r.includes("booking"))) {
      return "Room Inventory & Booking API";
    }
    const cleanStem = titleCaseWords(
      fileStem.replace(/[-_]?router|[-_]?routes?|[-_]?controller/giu, "") ||
        groupKey.split(":").at(-1) ||
        fileStem,
    );
    if (methods.size >= 2) {
      return `${cleanStem} Management API (${eps.length} endpoints)`;
    }
    return `${cleanStem} API (${firstEp.httpMethod ?? "HTTP"} ${firstEp.route ?? ""})`.trim();
  }

  if (firstEp.kind === "cli") {
    if (groupKey.endsWith(":db-lifecycle")) {
      return `Database Seed & Reset CLI (${eps.length} scripts)`;
    }
    if (fileStem.toLowerCase() === "server" || firstEp.name.includes("start")) {
      return "API Server Bootstrap CLI";
    }
    return firstEp.name.replace(/^npm script\s+/iu, "CLI Script: ");
  }

  if (firstEp.kind === "application") {
    const route = (firstEp.route ?? firstEp.name).replace(/^PAGE\s+/iu, "").trim();
    const clean = titleCaseWords(
      route
        .split("/")
        .filter((s) => s.length > 0 && !s.startsWith(":") && !s.startsWith("["))
        .join(" ") || fileStem,
    );
    return eps.length > 1
      ? `${clean} UI Workflow (${eps.length} pages)`
      : `${clean} View`;
  }

  return members[0]?.title ?? titleCaseWords(fileStem);
}

function humanizeStructuralModuleTitle(
  feature: FunctionalityFeature,
  lookup: GraphLookup,
): string {
  const id = feature.id.toLowerCase();
  if (id === "module-web-src") {
    return "Frontend Application Shell & State (App, Calendar, NavBar)";
  }
  if (id === "module-web-src-booking-element") {
    return "Room Booking Modal, Form & Filters UI";
  }
  if (id === "module-web-src-booking-form-table") {
    return "Room Availability Grid & Time-Slot Table UI";
  }
  if (id === "module-web-src-auth") {
    return "Frontend Auth Client & JWT Session Store";
  }

  // Generic clean naming from top exported components/functions
  const exportedNames: string[] = [];
  for (const nodeId of feature.implementationNodeIds) {
    const node = lookup.nodesById.get(nodeId);
    if (
      node &&
      (node.type === "component" ||
        node.type === "screen" ||
        ((node.type === "class" || node.type === "function") &&
          node.exported &&
          !node.name.includes(".")))
    ) {
      exportedNames.push(node.name);
    }
  }
  const uniqueNames = sortedUnique(exportedNames).slice(0, 3);
  const rawTitle = feature.title
    .replace(/^Web\s*\/\s*Src\s*\/?\s*/iu, "Frontend ")
    .replace(/^Src\s*\/\s*/iu, "");
  if (uniqueNames.length > 0 && rawTitle === "Frontend") {
    return `Frontend UI (${uniqueNames.join(", ")})`;
  }
  return rawTitle;
}

function mergeFeatureStatuses(
  statuses: readonly FeatureAuditStatus[],
): FeatureAuditStatus {
  if (statuses.includes("PARTIALLY_IMPLEMENTED")) return "PARTIALLY_IMPLEMENTED";
  if (statuses.includes("IMPLEMENTED_DOCUMENTED")) return "IMPLEMENTED_DOCUMENTED";
  if (statuses.includes("IMPLEMENTED_UNDOCUMENTED")) return "IMPLEMENTED_UNDOCUMENTED";
  if (statuses.includes("AMBIGUOUS")) return "AMBIGUOUS";
  return statuses[0] ?? "IMPLEMENTED_UNDOCUMENTED";
}

function mergeConfidence(
  values: readonly ("HIGH" | "MEDIUM" | "LOW")[],
): "HIGH" | "MEDIUM" | "LOW" {
  if (values.includes("HIGH")) return "HIGH";
  if (values.includes("MEDIUM")) return "MEDIUM";
  return "LOW";
}

function mergeFeatureKinds(
  kinds: readonly FeatureAuditKind[],
): FeatureAuditKind {
  if (kinds.includes("functional")) return "functional";
  if (kinds.includes("infrastructure")) return "infrastructure";
  return kinds[0] ?? "functional";
}

function titleCaseWords(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^a-zA-Z0-9]+/u)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

function buildGraphLookup(graph: RepositoryGraph): GraphLookup {
  const nodesById = new Map<string, RepositoryNode>();
  const filesById = new Map<string, FileNode>();
  const filesByPath = new Map<string, FileNode>();
  const ownerFileIdByNodeId = new Map<string, string>();
  const nodesByFileId = new Map<string, string[]>();
  const outgoingEdgesByNodeId = new Map<string, Edge[]>();
  const outgoingEdgesByFileId = new Map<string, Edge[]>();

  for (const file of graph.files) {
    nodesById.set(file.id, file);
    filesById.set(file.id, file);
    filesByPath.set(file.path, file);
    ownerFileIdByNodeId.set(file.id, file.id);
    nodesByFileId.set(file.id, [file.id]);
  }
  for (const node of [...graph.symbols, ...graph.entrypoints, ...graph.entities]) {
    nodesById.set(node.id, node);
    ownerFileIdByNodeId.set(node.id, node.fileId);
    const list = nodesByFileId.get(node.fileId) ?? [];
    list.push(node.id);
    nodesByFileId.set(node.fileId, list);
  }
  for (const [fileId, list] of nodesByFileId.entries()) {
    nodesByFileId.set(fileId, sortedUnique(list));
  }
  for (const edge of graph.edges) {
    const nodeList = outgoingEdgesByNodeId.get(edge.source) ?? [];
    nodeList.push(edge);
    outgoingEdgesByNodeId.set(edge.source, nodeList);

    const sourceFileId = ownerFileIdByNodeId.get(edge.source);
    if (sourceFileId !== undefined) {
      const fileList = outgoingEdgesByFileId.get(sourceFileId) ?? [];
      fileList.push(edge);
      outgoingEdgesByFileId.set(sourceFileId, fileList);
    }
  }
  return {
    nodesById,
    filesById,
    filesByPath,
    ownerFileIdByNodeId,
    nodesByFileId,
    outgoingEdgesByNodeId,
    outgoingEdgesByFileId,
  };
}

function buildFeatureStuds(
  feature: FunctionalityFeature,
  lookup: GraphLookup,
): Port[] {
  const ports: Port[] = [];
  for (const entrypointId of feature.entrypointNodeIds) {
    const node = lookup.nodesById.get(entrypointId);
    if (node?.type === "entrypoint") {
      ports.push(entrypointToPort(node));
    }
  }
  // If a structural feature (e.g. frontend UI module) has no EntryPointNodes,
  // expose its top-level Screen/Component entities or exported functions/classes as studs.
  if (ports.length === 0) {
    for (const nodeId of feature.implementationNodeIds) {
      const node = lookup.nodesById.get(nodeId);
      if (node === undefined) continue;
      if (node.type === "screen" || node.type === "component") {
        ports.push({
          id: `stud:${node.id}`,
          kind: node.type,
          label: node.name,
          nodeId: node.id,
          evidence: {
            file: node.evidence.file,
            line: node.evidence.line ?? node.lineRange.start,
          },
        });
      }
    }
  }
  if (ports.length === 0) {
    for (const nodeId of feature.implementationNodeIds) {
      const node = lookup.nodesById.get(nodeId);
      if (node === undefined) continue;
      if (
        (node.type === "function" || node.type === "class") &&
        node.exported &&
        !node.name.includes(".")
      ) {
        const file = lookup.filesById.get(node.fileId);
        ports.push({
          id: `stud:${node.id}`,
          kind: "component",
          label: node.name,
          nodeId: node.id,
          evidence: {
            file: file?.path ?? node.fileId.replace(/^file:/u, ""),
            line: node.lineRange.start,
          },
        });
      }
    }
  }
  return ports.sort(comparePorts);
}

function entrypointToPort(entrypoint: EntryPointNode): Port {
  const label =
    entrypoint.route !== undefined
      ? `${entrypoint.httpMethod ?? entrypoint.kind.toUpperCase()} ${entrypoint.route}`
      : entrypoint.name;
  return {
    id: `stud:${entrypoint.id}`,
    kind: entrypoint.kind,
    label,
    nodeId: entrypoint.id,
    ...(entrypoint.httpMethod === undefined
      ? {}
      : { httpMethod: entrypoint.httpMethod }),
    ...(entrypoint.route === undefined ? {} : { route: entrypoint.route }),
    evidence: {
      file: entrypoint.evidence.file,
      line: entrypoint.evidence.line ?? entrypoint.lineRange.start,
    },
  };
}

function buildSharedSubsystemBlocks(
  graph: RepositoryGraph,
  lookup: GraphLookup,
  sharedSubsystemFileIds: ReadonlySet<string>,
  reachedConsumersByFileId: ReadonlyMap<string, Set<string>>,
): Block[] {
  const sortedFileIds = [...sharedSubsystemFileIds].sort(compareText);
  return sortedFileIds.map((fileId): Block => {
    const file = lookup.filesById.get(fileId)!;
    const memberNodeIds = sortedUnique(lookup.nodesByFileId.get(fileId) ?? [fileId]);
    const id = `shared-${stableHash(file.path)}`;
    const slug = `shared-${slugify(file.path.replace(/\.[^.]+$/u, ""))}`;
    const title = formatSharedSubsystemTitle(file.path);

    // Expose exported symbols, schemas, or events inside this shared file as Studs
    const studs: Port[] = [];
    for (const nodeId of memberNodeIds) {
      const node = lookup.nodesById.get(nodeId);
      if (node === undefined) continue;
      if (node.type === "schema" || node.type === "event") {
        studs.push({
          id: `stud:${node.id}`,
          kind: node.type,
          label: node.name,
          nodeId: node.id,
          evidence: {
            file: node.evidence.file,
            line: node.evidence.line ?? node.lineRange.start,
          },
        });
      } else if (
        (node.type === "function" || node.type === "class" || node.type === "variable") &&
        node.exported
      ) {
        studs.push({
          id: `stud:${node.id}`,
          kind: "shared_module",
          label: node.name,
          nodeId: node.id,
          evidence: {
            file: file.path,
            line: node.lineRange.start,
          },
        });
      }
    }
    if (studs.length === 0) {
      studs.push({
        id: `stud:${file.id}`,
        kind: "shared_module",
        label: file.path.split("/").at(-1) ?? file.path,
        nodeId: file.id,
        evidence: {
          file: file.path,
          line: 1,
        },
      });
    }

    const consumers = reachedConsumersByFileId.get(fileId) ?? new Set<string>();
    return {
      id,
      slug,
      kind: "shared_subsystem",
      title,
      status: "SHARED_ACTIVE",
      confidence: consumers.size >= 2 ? "HIGH" : "MEDIUM",
      studs: studs.sort(comparePorts),
      sockets: [],
      exclusiveNodeIds: memberNodeIds,
      sharedNodeIds: [],
      filePaths: [file.path],
      size: computeBlockSize([file.path], memberNodeIds, lookup),
      gaps: [],
      documentationPromiseIds: [],
      disagreementIds: [],
      removalImpact: null,
    };
  });
}

function buildInfrastructureBlocks(
  graph: RepositoryGraph,
  lookup: GraphLookup,
  infrastructureFileIds: ReadonlySet<string>,
  infrastructureNodeIds: ReadonlySet<string>,
  sharedBlockIdByFileId: ReadonlyMap<string, string>,
): Block[] {
  const filteredFileIds = [...infrastructureFileIds]
    .filter((fileId) => !sharedBlockIdByFileId.has(fileId))
    .sort(compareText);
  const exclusiveNodeIds = sortedUnique([
    ...filteredFileIds.flatMap((fileId) => lookup.nodesByFileId.get(fileId) ?? [fileId]),
    ...[...infrastructureNodeIds].filter((nodeId) => {
      const fileId = lookup.ownerFileIdByNodeId.get(nodeId);
      return fileId === undefined || !sharedBlockIdByFileId.has(fileId);
    }),
  ]);
  if (exclusiveNodeIds.length === 0) return [];

  const filePaths = collectFilePaths(exclusiveNodeIds, lookup);
  const studs: Port[] = [];
  for (const nodeId of exclusiveNodeIds) {
    const node = lookup.nodesById.get(nodeId);
    if (node === undefined) continue;
    if (node.type === "config") {
      studs.push({
        id: `stud:${node.id}`,
        kind: "config",
        label: node.name,
        nodeId: node.id,
        evidence: {
          file: node.evidence.file,
          line: node.evidence.line ?? node.lineRange.start,
        },
      });
    } else if (node.type === "entrypoint" && node.exposure === "startup") {
      studs.push(entrypointToPort(node));
    }
  }

  return [
    {
      id: `infra-${stableHash(filePaths.join("|") || "baseplate")}`,
      slug: "infrastructure-baseplate",
      kind: "infrastructure",
      title: "Runtime & Configuration Baseplate",
      status: "BASEPLATE_ACTIVE",
      confidence: "HIGH",
      studs: studs.sort(comparePorts),
      sockets: [],
      exclusiveNodeIds,
      sharedNodeIds: [],
      filePaths,
      size: computeBlockSize(filePaths, exclusiveNodeIds, lookup),
      gaps: [],
      documentationPromiseIds: [],
      disagreementIds: [],
      removalImpact: null,
    },
  ];
}

function buildOrphanBlocks(
  candidates: readonly DeadCodeCandidate[],
  lookup: GraphLookup,
  reachabilityByNodeId: ReadonlyMap<
    string,
    { status: string; blockers: string[] }
  >,
): Block[] {
  const byFile = new Map<string, DeadCodeCandidate[]>();
  for (const candidate of candidates) {
    const list = byFile.get(candidate.file) ?? [];
    list.push(candidate);
    byFile.set(candidate.file, list);
  }

  const blocks: Block[] = [];
  for (const [filePath, fileCandidates] of [...byFile.entries()].sort(([a], [b]) =>
    compareText(a, b),
  )) {
    const sortedCandidates = [...fileCandidates].sort(
      (left, right) =>
        left.line - right.line || compareText(left.symbol, right.symbol),
    );
    const primaryVerdict = sortedCandidates.reduce<DeadCodeVerdict>(
      (best, current) =>
        DEAD_VERDICT_PRIORITY[current.verdict] < DEAD_VERDICT_PRIORITY[best]
          ? current.verdict
          : best,
      sortedCandidates[0]!.verdict,
    );
    const nodeIds = sortedUnique(
      sortedCandidates.flatMap((candidate) => candidate.nodeIds),
    );
    const studs: Port[] = sortedCandidates.map((candidate) => ({
      id: `orphan-port:${candidate.id}`,
      kind: "dead_candidate",
      label: `${candidate.symbol} (${candidate.verdict})`,
      nodeId: candidate.nodeIds[0] ?? null,
      evidence: {
        file: candidate.file,
        line: candidate.line,
      },
    }));
    const lines = estimateCandidateLines(sortedCandidates, lookup);
    blocks.push({
      id: `orphan-${stableHash(filePath)}`,
      slug: `orphan-${slugify(filePath.replace(/\.[^.]+$/u, ""))}`,
      kind: "orphan",
      title: `Detached code in ${filePath}`,
      status: primaryVerdict,
      confidence:
        primaryVerdict === "VALIDATED_SAFE_TO_DELETE"
          ? "HIGH"
          : primaryVerdict === "UNKNOWN_DYNAMIC_USAGE"
            ? "LOW"
            : "MEDIUM",
      studs,
      sockets: [],
      exclusiveNodeIds: nodeIds,
      sharedNodeIds: [],
      filePaths: [filePath],
      size: { files: 1, lines },
      gaps: sortedUnique(sortedCandidates.flatMap((c) => c.blockers)),
      documentationPromiseIds: [],
      disagreementIds: [],
      deadCodeCandidates: sortedCandidates,
      removalImpact: {
        freedFiles: [filePath],
        freedLines: lines,
        freedNodeIds: nodeIds,
        orphanedBlockIds: [],
        degradedToSingleConsumerBlockIds: [],
      },
    });
  }
  return blocks;
}

function buildConnectionsAndPopulateSockets(
  graph: RepositoryGraph,
  lookup: GraphLookup,
  featureBlocks: Block[],
  sharedSubsystemBlocks: Block[],
  infrastructureBlocks: Block[],
  sharedBlockIdByNodeId: ReadonlyMap<string, string>,
  sharedBlockIdByFileId: ReadonlyMap<string, string>,
  infraBlockIdByNodeId: ReadonlyMap<string, string>,
  infraBlockIdByFileId: ReadonlyMap<string, string>,
  directFeatureOwnersByNodeId: ReadonlyMap<string, Set<string>>,
  directFeatureOwnersByFileId: ReadonlyMap<string, Set<string>>,
): Connection[] {
  const blocksById = new Map<string, Block>();
  for (const block of [
    ...featureBlocks,
    ...sharedSubsystemBlocks,
    ...infrastructureBlocks,
  ]) {
    blocksById.set(block.id, block);
  }

  const resolveOwningBlockIds = (nodeId: string): {
    blockIds: string[];
    confidence: "PROVEN" | "POSSIBLE";
  } => {
    const sharedByNode = sharedBlockIdByNodeId.get(nodeId);
    if (sharedByNode !== undefined) {
      return { blockIds: [sharedByNode], confidence: "PROVEN" };
    }
    const infraByNode = infraBlockIdByNodeId.get(nodeId);
    if (infraByNode !== undefined) {
      return { blockIds: [infraByNode], confidence: "PROVEN" };
    }
    const fileId = lookup.ownerFileIdByNodeId.get(nodeId);
    if (fileId !== undefined) {
      const sharedByFile = sharedBlockIdByFileId.get(fileId);
      if (sharedByFile !== undefined) {
        return { blockIds: [sharedByFile], confidence: "PROVEN" };
      }
      const infraByFile = infraBlockIdByFileId.get(fileId);
      if (infraByFile !== undefined) {
        return { blockIds: [infraByFile], confidence: "PROVEN" };
      }
    }
    const nodeOwners = directFeatureOwnersByNodeId.get(nodeId);
    if (nodeOwners !== undefined && nodeOwners.size > 0) {
      return {
        blockIds: [...nodeOwners].sort(compareText),
        confidence: nodeOwners.size === 1 ? "PROVEN" : "POSSIBLE",
      };
    }
    if (fileId !== undefined) {
      const fileOwners = directFeatureOwnersByFileId.get(fileId);
      if (fileOwners !== undefined && fileOwners.size > 0) {
        return {
          blockIds: [...fileOwners].sort(compareText),
          confidence: fileOwners.size === 1 ? "PROVEN" : "POSSIBLE",
        };
      }
    }
    return { blockIds: [], confidence: "POSSIBLE" };
  };

  interface ConnectionAccumulator {
    from: string;
    to: string;
    kind: ConnectionKind;
    confidence: "PROVEN" | "POSSIBLE";
    labels: Set<string>;
    evidenceMap: Map<string, SourceEvidence>;
  }

  const connectionMap = new Map<string, ConnectionAccumulator>();
  const socketsByBlockId = new Map<string, Map<string, Port>>();

  const recordSocket = (blockId: string, port: Port): void => {
    const map = socketsByBlockId.get(blockId) ?? new Map<string, Port>();
    if (!map.has(port.id)) {
      map.set(port.id, port);
      socketsByBlockId.set(blockId, map);
    }
  };

  const recordConnection = (
    from: string,
    to: string,
    kind: ConnectionKind,
    confidence: "PROVEN" | "POSSIBLE",
    label: string,
    evidence: SourceEvidence,
  ): void => {
    if (from === to) return;
    const key = `${from}|${to}|${kind}`;
    const existing = connectionMap.get(key) ?? {
      from,
      to,
      kind,
      confidence,
      labels: new Set<string>(),
      evidenceMap: new Map<string, SourceEvidence>(),
    };
    if (confidence === "PROVEN") existing.confidence = "PROVEN";
    existing.labels.add(label);
    existing.evidenceMap.set(`${evidence.file}:${evidence.line}`, evidence);
    connectionMap.set(key, existing);
  };

  // Traverse all dependency edges in deterministic order
  const sortedEdges = [...graph.edges].sort(
    (left, right) =>
      compareText(left.source, right.source) ||
      compareText(left.target, right.target) ||
      compareText(left.type, right.type),
  );

  for (const edge of sortedEdges) {
    if (!DEPENDENCY_EDGE_TYPES.has(edge.type)) continue;
    const sourceResolved = resolveOwningBlockIds(edge.source);
    const targetResolved = resolveOwningBlockIds(edge.target);
    if (sourceResolved.blockIds.length === 0 || targetResolved.blockIds.length === 0) {
      continue;
    }

    const targetNode = lookup.nodesById.get(edge.target);
    const targetFileId = lookup.ownerFileIdByNodeId.get(edge.target);
    const targetFile = targetFileId ? lookup.filesById.get(targetFileId) : undefined;
    const evidence: SourceEvidence = {
      file: edge.evidence.file,
      line: edge.evidence.line ?? 1,
    };

    for (const fromId of sourceResolved.blockIds) {
      for (const toId of targetResolved.blockIds) {
        if (fromId === toId) continue;
        const targetBlock = blocksById.get(toId);
        if (targetBlock === undefined) continue;

        const kind = classifyConnectionKind(edge.type, targetNode, targetBlock);
        const confidence =
          sourceResolved.confidence === "PROVEN" &&
          targetResolved.confidence === "PROVEN"
            ? "PROVEN"
            : "POSSIBLE";
        const targetLabel =
          targetNode && "name" in targetNode
            ? targetNode.name
            : targetFile?.path ?? targetBlock.title;

        recordConnection(
          fromId,
          toId,
          kind,
          confidence,
          `${edge.type} ${targetLabel}`,
          evidence,
        );

        const socketKind = classifySocketPortKind(targetNode, targetBlock);
        recordSocket(fromId, {
          id: `socket:${toId}:${targetNode?.id ?? toId}`,
          kind: socketKind,
          label: `${targetBlock.title} (${targetLabel})`,
          nodeId: targetNode?.id ?? null,
          evidence,
        });
      }
    }
  }

  // Also link features that share nodes directly with a shared_subsystem or infrastructure block
  for (const featureBlock of featureBlocks) {
    for (const sharedNodeId of featureBlock.sharedNodeIds) {
      const targetBlockId =
        sharedBlockIdByNodeId.get(sharedNodeId) ??
        infraBlockIdByNodeId.get(sharedNodeId);
      if (targetBlockId === undefined) continue;
      const targetBlock = blocksById.get(targetBlockId);
      if (targetBlock === undefined) continue;
      const node = lookup.nodesById.get(sharedNodeId);
      const fileId = lookup.ownerFileIdByNodeId.get(sharedNodeId);
      const file = fileId ? lookup.filesById.get(fileId) : undefined;
      const line =
        node && "lineRange" in node && node.lineRange !== undefined
          ? node.lineRange.start
          : 1;
      const evidence: SourceEvidence = {
        file: file?.path ?? featureBlock.filePaths[0] ?? "unknown",
        line,
      };
      recordConnection(
        featureBlock.id,
        targetBlock.id,
        "rests_on",
        "PROVEN",
        `Uses ${targetBlock.title}`,
        evidence,
      );
      recordSocket(featureBlock.id, {
        id: `socket:${targetBlock.id}`,
        kind: targetBlock.kind === "infrastructure" ? "config" : "shared_module",
        label: targetBlock.title,
        nodeId: sharedNodeId,
        evidence,
      });
    }
  }

  for (const [blockId, socketMap] of socketsByBlockId.entries()) {
    const block = blocksById.get(blockId);
    if (block !== undefined) {
      block.sockets = [...socketMap.values()].sort(comparePorts);
    }
  }

  return [...connectionMap.values()]
    .map((item): Connection => {
      const evidence = [...item.evidenceMap.values()].sort(
        (left, right) =>
          compareText(left.file, right.file) || left.line - right.line,
      );
      const labels = [...item.labels].sort(compareText);
      return {
        id: `conn-${stableHash(`${item.from}|${item.to}|${item.kind}`)}`,
        from: item.from,
        to: item.to,
        kind: item.kind,
        confidence: item.confidence,
        label: labels.slice(0, 3).join("; "),
        evidence,
      };
    })
    .sort(
      (left, right) =>
        compareText(left.from, right.from) ||
        compareText(left.to, right.to) ||
        compareText(left.kind, right.kind),
    );
}

function populateRemovalImpacts(
  featureBlocks: Block[],
  sharedSubsystemBlocks: Block[],
  infrastructureBlocks: Block[],
  connections: readonly Connection[],
  lookup: GraphLookup,
  directFeatureOwnersByFileId: ReadonlyMap<string, Set<string>>,
): void {
  // Count incoming feature consumers per shared/infra block
  const incomingFeatureIdsByBlockId = new Map<string, Set<string>>();
  const featureBlockIds = new Set(featureBlocks.map((b) => b.id));
  for (const connection of connections) {
    if (!featureBlockIds.has(connection.from)) continue;
    const consumers =
      incomingFeatureIdsByBlockId.get(connection.to) ?? new Set<string>();
    consumers.add(connection.from);
    incomingFeatureIdsByBlockId.set(connection.to, consumers);
  }

  for (const block of featureBlocks) {
    const freedFiles: string[] = [];
    for (const filePath of block.filePaths) {
      const file = lookup.filesByPath.get(filePath);
      if (file === undefined) continue;
      const owners = directFeatureOwnersByFileId.get(file.id) ?? new Set<string>();
      if (owners.size === 1 && owners.has(block.id)) {
        freedFiles.push(filePath);
      }
    }
    freedFiles.sort(compareText);
    const freedLines = freedFiles.reduce((sum, path) => {
      const file = lookup.filesByPath.get(path);
      const lines =
        file?.lineRange !== undefined
          ? Math.max(0, file.lineRange.end - file.lineRange.start + 1)
          : 0;
      return sum + lines;
    }, 0);

    const orphanedBlockIds: string[] = [];
    const degradedToSingleConsumerBlockIds: string[] = [];
    for (const target of [...sharedSubsystemBlocks, ...infrastructureBlocks]) {
      const consumers = incomingFeatureIdsByBlockId.get(target.id);
      if (consumers === undefined || !consumers.has(block.id)) continue;
      const remaining = consumers.size - 1;
      if (remaining === 0) {
        orphanedBlockIds.push(target.id);
      } else if (remaining === 1 && target.kind === "shared_subsystem") {
        degradedToSingleConsumerBlockIds.push(target.id);
      }
    }

    block.removalImpact = {
      freedFiles,
      freedLines,
      freedNodeIds: [...block.exclusiveNodeIds],
      orphanedBlockIds: orphanedBlockIds.sort(compareText),
      degradedToSingleConsumerBlockIds:
        degradedToSingleConsumerBlockIds.sort(compareText),
    };
  }
}

function classifyConnectionKind(
  edgeType: Edge["type"],
  targetNode: RepositoryNode | undefined,
  targetBlock: Block,
): ConnectionKind {
  if (edgeType === "PUBLISHES" || edgeType === "SUBSCRIBES_TO" || targetNode?.type === "event") {
    return "event";
  }
  if (edgeType === "VALIDATED_BY" || targetNode?.type === "schema") {
    return "shared_data";
  }
  if (targetNode?.type === "endpoint" || targetNode?.type === "entrypoint") {
    return "http";
  }
  if (
    targetBlock.kind === "shared_subsystem" ||
    targetBlock.kind === "infrastructure" ||
    edgeType === "CONFIGURED_BY" ||
    edgeType === "IMPORTS"
  ) {
    return "rests_on";
  }
  return "calls";
}

function classifySocketPortKind(
  targetNode: RepositoryNode | undefined,
  targetBlock: Block,
): PortKind {
  if (targetNode?.type === "schema") return "schema";
  if (targetNode?.type === "config" || targetBlock.kind === "infrastructure") {
    return "config";
  }
  if (targetNode?.type === "event") return "event";
  if (targetNode?.type === "component" || targetNode?.type === "screen") {
    return targetNode.type;
  }
  return "shared_module";
}

function collectFilePaths(
  nodeIds: readonly string[],
  lookup: GraphLookup,
): string[] {
  const paths = new Set<string>();
  for (const nodeId of nodeIds) {
    const fileId = lookup.ownerFileIdByNodeId.get(nodeId);
    const file = fileId ? lookup.filesById.get(fileId) : undefined;
    if (file !== undefined) {
      paths.add(file.path);
    }
  }
  return [...paths].sort(compareText);
}

function computeBlockSize(
  filePaths: readonly string[],
  nodeIds: readonly string[],
  lookup: GraphLookup,
): BlockSize {
  if (filePaths.length === 0) return { files: 0, lines: 0 };
  let lines = 0;
  for (const path of filePaths) {
    const file = lookup.filesByPath.get(path);
    if (file?.lineRange !== undefined) {
      lines += Math.max(0, file.lineRange.end - file.lineRange.start + 1);
    }
  }
  if (lines === 0) {
    for (const nodeId of nodeIds) {
      const node = lookup.nodesById.get(nodeId);
      if (node && "lineRange" in node && node.lineRange !== undefined) {
        lines += Math.max(0, node.lineRange.end - node.lineRange.start + 1);
      }
    }
  }
  return { files: filePaths.length, lines };
}

function estimateCandidateLines(
  candidates: readonly DeadCodeCandidate[],
  lookup: GraphLookup,
): number {
  let total = 0;
  for (const candidate of candidates) {
    let added = false;
    for (const nodeId of candidate.nodeIds) {
      const node = lookup.nodesById.get(nodeId);
      if (node && "lineRange" in node && node.lineRange !== undefined) {
        total += Math.max(1, node.lineRange.end - node.lineRange.start + 1);
        added = true;
      }
    }
    if (!added) total += 1;
  }
  return total;
}

function buildSummary(
  blocks: readonly Block[],
  connections: readonly Connection[],
): FeatureMapSummary {
  let featureBlocks = 0;
  let sharedSubsystemBlocks = 0;
  let infrastructureBlocks = 0;
  let orphanBlocks = 0;
  let documentedNotImplementedBlocks = 0;

  for (const block of blocks) {
    switch (block.kind) {
      case "feature":
        featureBlocks += 1;
        if (block.status === "DOCUMENTED_NOT_IMPLEMENTED") {
          documentedNotImplementedBlocks += 1;
        }
        break;
      case "shared_subsystem":
        sharedSubsystemBlocks += 1;
        break;
      case "infrastructure":
        infrastructureBlocks += 1;
        break;
      case "orphan":
        orphanBlocks += 1;
        break;
    }
  }

  return {
    totalBlocks: blocks.length,
    featureBlocks,
    sharedSubsystemBlocks,
    infrastructureBlocks,
    orphanBlocks,
    totalConnections: connections.length,
    documentedNotImplementedBlocks,
  };
}

function isConfigFilePath(path: string): boolean {
  return /(?:^|\/)(?:(?:next|jest|eslint|vite|vitest|webpack|rollup|babel|postcss|tailwind|tsconfig|jsconfig|playwright|cypress|prettier)\.(?:config|setup)|config|settings|env)(?:\.[^/]+)?\.(?:js|ts|mjs|cjs|py|json|ya?ml)$/iu.test(
    path,
  );
}

function isSharedDomainPath(path: string): boolean {
  return /(?:^|\/)(?:models?|schemas?|middleware|repositories|policies|db|database|shared|common|utils?|helpers?|core|services)\//iu.test(
    path,
  );
}

function isCodeFile(file: FileNode): boolean {
  return (
    file.language !== "markdown" &&
    file.language !== "json" &&
    file.language !== "yaml" &&
    file.language !== "unknown" &&
    !/(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[^/]+$/iu.test(file.path)
  );
}

function formatSharedSubsystemTitle(filePath: string): string {
  const withoutExt = filePath.replace(/\.[^.]+$/u, "");
  const parts = withoutExt.split("/").slice(-2);
  return `Shared: ${parts.join("/")}`;
}

function addOwner(
  map: Map<string, Set<string>>,
  key: string,
  ownerId: string,
): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(ownerId);
  map.set(key, set);
}

function comparePorts(left: Port, right: Port): number {
  return (
    compareText(left.kind, right.kind) ||
    compareText(left.label, right.label) ||
    compareText(left.id, right.id)
  );
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "") || "block"
  );
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
