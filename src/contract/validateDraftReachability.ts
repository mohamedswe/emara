import type { RepositoryGraph } from "../graph/types.js";
import {
  buildReachabilityLedger,
  type ProductReachabilityStatus,
} from "../retrieval/reachabilityLedger.ts";
import type {
  ContractDraft,
  FeatureReachability,
} from "./types.js";

export interface DraftReachabilityViolation {
  contractKind: "feature_dossier" | "capability" | "user_flow";
  contractId: string;
  field: string;
  nodeId: string;
  status: ProductReachabilityStatus;
  reason: string;
}

type EnforcedDossierSection =
  | "entrypoints"
  | "ui"
  | "handlers"
  | "services"
  | "events"
  | "evidenceNodeIds";

const ENFORCED_DOSSIER_SECTIONS: readonly EnforcedDossierSection[] = [
  "entrypoints",
  "ui",
  "handlers",
  "services",
  "events",
  "evidenceNodeIds",
];

/**
 * Finds model-authored claims that contradict deterministic product liveness.
 * Unknown dynamic code remains reviewable; disconnected code may be described as
 * a candidate or uncertainty but cannot prove a live feature or user flow.
 */
export function findDraftReachabilityViolations(
  graph: RepositoryGraph,
  draft: ContractDraft,
): DraftReachabilityViolation[] {
  const ledger = buildReachabilityLedger(graph);
  const statusByNodeId = new Map(
    ledger.entries.map((entry) => [entry.nodeId, entry.status]),
  );
  const dossierById = new Map(
    draft.featureDossiers.map((dossier) => [dossier.id, dossier]),
  );
  const violations: DraftReachabilityViolation[] = [];

  for (const dossier of draft.featureDossiers) {
    for (const field of ENFORCED_DOSSIER_SECTIONS) {
      for (const nodeId of dossier[field]) {
        const status = statusByNodeId.get(nodeId);
        if (
          status === undefined ||
          dossierStatusAllows(dossier.reachability, field, status)
        ) {
          continue;
        }
        violations.push({
          contractKind: "feature_dossier",
          contractId: dossier.id,
          field,
          nodeId,
          status,
          reason: violationReason(dossier.reachability, status),
        });
      }
    }
  }

  for (const capability of draft.capabilities) {
    const dossier = dossierById.get(capability.dossierId);
    if (dossier === undefined || dossier.reachability === "unknown") continue;
    for (const nodeId of [
      ...capability.entrypointNodeIds,
      ...capability.evidenceNodeIds,
    ]) {
      const status = statusByNodeId.get(nodeId);
      if (
        status === undefined ||
        dossierStatusAllows(
          dossier.reachability,
          "evidenceNodeIds",
          status,
        )
      ) {
        continue;
      }
      violations.push({
        contractKind: "capability",
        contractId: capability.id,
        field: "evidenceNodeIds",
        nodeId,
        status,
        reason: violationReason(dossier.reachability, status),
      });
    }
  }

  for (const flow of draft.userFlows) {
    const fields: Array<readonly [string, readonly string[]]> = [
      ["evidenceNodeIds", flow.evidenceNodeIds],
      ...flow.steps.map((step) => [
        `steps[${step.order}].evidenceNodeIds`,
        step.evidenceNodeIds,
      ] as const),
    ];
    for (const [field, nodeIds] of fields) {
      for (const nodeId of nodeIds) {
        const status = statusByNodeId.get(nodeId);
        if (status === undefined || productClaimAllows(status)) continue;
        violations.push({
          contractKind: "user_flow",
          contractId: flow.id,
          field,
          nodeId,
          status,
          reason:
            "A user flow may only use product-reachable or explicitly unresolved dynamic implementation evidence.",
        });
      }
    }
  }

  return violations.sort(
    (left, right) =>
      compareText(left.contractKind, right.contractKind) ||
      compareText(left.contractId, right.contractId) ||
      compareText(left.field, right.field) ||
      compareText(left.nodeId, right.nodeId),
  );
}

export function assertDraftReachability(
  graph: RepositoryGraph,
  draft: ContractDraft,
): void {
  const violations = findDraftReachabilityViolations(graph, draft);
  if (violations.length === 0) return;
  const details = violations.slice(0, 20).map((violation) =>
    `${violation.contractKind} ${JSON.stringify(violation.contractId)} ${violation.field} cites ${violation.status} node ${JSON.stringify(violation.nodeId)}`
  );
  const remainder = violations.length > details.length
    ? `; ${violations.length - details.length} more violation(s)`
    : "";
  throw new Error(`Invalid contract reachability: ${details.join("; ")}${remainder}`);
}

function dossierStatusAllows(
  dossierStatus: FeatureReachability,
  field: EnforcedDossierSection,
  nodeStatus: ProductReachabilityStatus,
): boolean {
  if (field === "entrypoints") {
    if (dossierStatus === "reachable") {
      return nodeStatus === "product_reachable";
    }
    if (dossierStatus === "internally_reachable") {
      return nodeStatus === "startup_reachable";
    }
  }
  switch (dossierStatus) {
    case "reachable":
      return productClaimAllows(nodeStatus);
    case "internally_reachable":
      return (
        nodeStatus === "startup_reachable" ||
        nodeStatus === "dynamic_unknown"
      );
    case "test_only":
      return nodeStatus === "test_only" || nodeStatus === "dynamic_unknown";
    case "dead_or_unreferenced":
      return (
        nodeStatus === "disconnected_candidate" ||
        nodeStatus === "public_api_unproven" ||
        nodeStatus === "dynamic_unknown"
      );
    case "unknown":
      return true;
  }
}

function productClaimAllows(status: ProductReachabilityStatus): boolean {
  return status === "product_reachable" || status === "dynamic_unknown";
}

function violationReason(
  dossierStatus: FeatureReachability,
  nodeStatus: ProductReachabilityStatus,
): string {
  return `Dossier reachability ${dossierStatus} cannot be supported by ${nodeStatus} implementation evidence.`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
