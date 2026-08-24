import type {
  Edge,
  FileNode,
  RepositoryGraph,
  RepositoryNode,
} from "../graph/types.js";
import { isTestFilePath } from "../scanner/classifyFilePath.ts";
import {
  buildReachabilityResults,
  type EvidencePath,
  type ReachabilityOptions,
  type ReachabilityResult,
} from "./reachability.ts";

/**
 * Product liveness is deliberately separate from the legacy contract status.
 * In particular, `disconnected_candidate` means "validate for deletion" and
 * never means that static analysis proved deletion safe.
 */
export type ProductReachabilityStatus =
  | "product_reachable"
  | "startup_reachable"
  | "test_only"
  | "public_api_unproven"
  | "dynamic_unknown"
  | "disconnected_candidate";

export interface ReachabilityLedgerEntry {
  nodeId: string;
  status: ProductReachabilityStatus;
  confidence: "proven" | "tentative";
  reason: string;
  paths: EvidencePath[];
  exported: boolean | null;
  meaningfulIncidentEdges: number;
  blockers: string[];
}

export interface ReachabilityLedger {
  version: 1;
  graphVersion: RepositoryGraph["version"];
  entries: ReachabilityLedgerEntry[];
  counts: Record<ProductReachabilityStatus, number>;
}

const MEANINGFUL_EDGE_TYPES = new Set<Edge["type"]>([
  "CALLS",
  "REFERENCES",
  "HANDLED_BY",
  "VALIDATED_BY",
  "TESTED_BY",
  "RENDERS",
  "PUBLISHES",
  "SUBSCRIBES_TO",
  "CONFIGURED_BY",
]);

const STATUS_PRIORITY: Record<ProductReachabilityStatus, number> = {
  product_reachable: 0,
  startup_reachable: 1,
  test_only: 2,
  dynamic_unknown: 3,
  public_api_unproven: 4,
  disconnected_candidate: 5,
};

export function buildReachabilityLedger(
  graph: RepositoryGraph,
  options: ReachabilityOptions = {},
): ReachabilityLedger {
  const legacyByNodeId = buildReachabilityResults(graph, undefined, options);
  const filesById = new Map(graph.files.map((file) => [file.id, file]));
  const externalEntrypoints = graph.entrypoints.filter(
    (entrypoint) => entrypoint.exposure === "external",
  ).length;
  const incidentCounts = meaningfulIncidentCounts(graph);
  const directlyOwnedNodes: Array<Exclude<RepositoryNode, FileNode>> = [
    ...graph.symbols,
    ...graph.entrypoints,
    ...graph.entities,
  ];
  const entries = directlyOwnedNodes.map((node) =>
    classifyNode(
      graph,
      node,
      filesById.get(node.fileId),
      incidentCounts.get(node.id) ?? 0,
      externalEntrypoints,
      requiredReachability(legacyByNodeId, node.id),
    )
  );
  const entriesByFileId = new Map<string, ReachabilityLedgerEntry[]>();
  for (let index = 0; index < directlyOwnedNodes.length; index += 1) {
    const node = directlyOwnedNodes[index];
    const entry = entries[index];
    if (node === undefined || entry === undefined) continue;
    const values = entriesByFileId.get(node.fileId) ?? [];
    values.push(entry);
    entriesByFileId.set(node.fileId, values);
  }
  for (const file of graph.files) {
    const owned = entriesByFileId.get(file.id);
    if (owned === undefined || owned.length === 0) continue;
    entries.push(fileEntry(file, owned, incidentCounts.get(file.id) ?? 0));
  }
  entries.sort((left, right) => compareText(left.nodeId, right.nodeId));

  const counts = emptyCounts();
  for (const entry of entries) counts[entry.status] += 1;
  return {
    version: 1,
    graphVersion: graph.version,
    entries,
    counts,
  };
}

export function reachabilityEntry(
  ledger: ReachabilityLedger,
  nodeId: string,
): ReachabilityLedgerEntry | undefined {
  return ledger.entries.find((entry) => entry.nodeId === nodeId);
}

export function isProductReachabilityStatus(
  value: string,
): value is ProductReachabilityStatus {
  return Object.hasOwn(STATUS_PRIORITY, value);
}

function classifyNode(
  graph: RepositoryGraph,
  node: Exclude<RepositoryNode, FileNode>,
  owner: FileNode | undefined,
  meaningfulIncidentEdges: number,
  externalEntrypoints: number,
  legacy: ReachabilityResult,
): ReachabilityLedgerEntry {
  const exported = "exported" in node ? node.exported : null;
  if (owner !== undefined && isTestFilePath(owner.path)) {
    return entry(
      node.id,
      "test_only",
      "proven",
      "The owning file matches an established test-file convention.",
      legacy.status === "test_only" ? legacy.paths : [],
      exported,
      meaningfulIncidentEdges,
    );
  }
  if (legacy.status === "reachable") {
    return entry(
      node.id,
      "product_reachable",
      "proven",
      legacy.reason,
      legacy.paths,
      exported,
      meaningfulIncidentEdges,
    );
  }
  if (legacy.status === "internally_reachable") {
    return entry(
      node.id,
      "startup_reachable",
      "proven",
      legacy.reason,
      legacy.paths,
      exported,
      meaningfulIncidentEdges,
    );
  }
  if (legacy.status === "test_only") {
    return entry(
      node.id,
      "test_only",
      "proven",
      legacy.reason,
      legacy.paths,
      exported,
      meaningfulIncidentEdges,
    );
  }

  const diagnostic = owner === undefined
    ? undefined
    : graph.analysis.diagnostics.find((item) => item.file === owner.path);
  if (diagnostic !== undefined) {
    return entry(
      node.id,
      "dynamic_unknown",
      "tentative",
      "The owning file has unresolved parser or framework diagnostics, so static liveness is unknown.",
      [],
      exported,
      meaningfulIncidentEdges,
      [`${diagnostic.kind}: ${diagnostic.message}`],
    );
  }
  if (meaningfulIncidentEdges > 0) {
    return entry(
      node.id,
      "dynamic_unknown",
      "tentative",
      "The node participates in production graph relationships, but no path from a recognized runtime root was proven.",
      [],
      exported,
      meaningfulIncidentEdges,
      ["Resolve the disconnected graph relationship before deciding liveness."],
    );
  }
  if (exported === true && externalEntrypoints === 0) {
    return entry(
      node.id,
      "public_api_unproven",
      "tentative",
      "The repository has no recognized external entrypoints and this symbol is exported; it may be a library API.",
      [],
      exported,
      meaningfulIncidentEdges,
      ["Confirm package exports and downstream consumers."],
    );
  }
  return entry(
    node.id,
    "disconnected_candidate",
    "tentative",
    "No runtime, startup, test, or meaningful incident path was found. Treat it as a deletion candidate, not proof of safety.",
    [],
    exported,
    meaningfulIncidentEdges,
    ["Run isolated delete, build, test, and public-surface validation."],
  );
}

function requiredReachability(
  values: ReadonlyMap<string, ReachabilityResult>,
  nodeId: string,
): ReachabilityResult {
  const value = values.get(nodeId);
  if (value === undefined) {
    throw new Error(`Missing reachability result for ${JSON.stringify(nodeId)}`);
  }
  return value;
}

function fileEntry(
  file: FileNode,
  owned: readonly ReachabilityLedgerEntry[],
  meaningfulIncidentEdges: number,
): ReachabilityLedgerEntry {
  const strongest = [...owned].sort(
    (left, right) =>
      STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status] ||
      compareText(left.nodeId, right.nodeId),
  )[0];
  if (strongest === undefined) {
    throw new Error(`Cannot derive reachability for empty file ${JSON.stringify(file.id)}`);
  }
  return entry(
    file.id,
    strongest.status,
    strongest.confidence,
    `The file inherits ${strongest.status} from owned node ${strongest.nodeId}.`,
    strongest.paths,
    null,
    meaningfulIncidentEdges,
    strongest.blockers,
  );
}

function entry(
  nodeId: string,
  status: ProductReachabilityStatus,
  confidence: ReachabilityLedgerEntry["confidence"],
  reason: string,
  paths: readonly EvidencePath[],
  exported: boolean | null,
  meaningfulIncidentEdges: number,
  blockers: readonly string[] = [],
): ReachabilityLedgerEntry {
  return {
    nodeId,
    status,
    confidence,
    reason,
    paths: paths.map((path) => ({
      nodeIds: [...path.nodeIds],
      edges: path.edges.map((edge) => ({
        ...edge,
        evidence: { ...edge.evidence },
      })),
    })),
    exported,
    meaningfulIncidentEdges,
    blockers: [...blockers],
  };
}

function meaningfulIncidentCounts(graph: RepositoryGraph): Map<string, number> {
  const result = new Map<string, number>();
  for (const edge of graph.edges) {
    if (!MEANINGFUL_EDGE_TYPES.has(edge.type)) continue;
    result.set(edge.source, (result.get(edge.source) ?? 0) + 1);
    result.set(edge.target, (result.get(edge.target) ?? 0) + 1);
  }
  return result;
}

function emptyCounts(): Record<ProductReachabilityStatus, number> {
  return {
    product_reachable: 0,
    startup_reachable: 0,
    test_only: 0,
    public_api_unproven: 0,
    dynamic_unknown: 0,
    disconnected_candidate: 0,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
