import type { ProductReachabilityStatus } from "../retrieval/reachabilityLedger.ts";

export type FeatureAuditStatus =
  | "IMPLEMENTED_DOCUMENTED"
  | "IMPLEMENTED_UNDOCUMENTED"
  | "DOCUMENTED_NOT_IMPLEMENTED"
  | "PARTIALLY_IMPLEMENTED"
  | "AMBIGUOUS";

export type FeatureAuditKind =
  | "functional"
  | "non_functional"
  | "infrastructure";

export type DeadCodeVerdict =
  | "CANDIDATE"
  | "VALIDATION_REQUIRED"
  | "VALIDATED_SAFE_TO_DELETE"
  | "UNKNOWN_DYNAMIC_USAGE";

export interface FunctionalityFeature {
  /** Deterministic identity derived from locked feature membership only. */
  canonicalId: string;
  /** Deterministic, machine-readable alias allocated from the graph cluster. */
  id: string;
  /** Human-readable decoration; model-proposed with a deterministic fallback. */
  title: string;
  kind: FeatureAuditKind;
  status: FeatureAuditStatus;
  entrypointNodeIds: string[];
  implementationNodeIds: string[];
  documentationPromiseIds: string[];
  gaps: string[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface DocumentationPromise {
  id: string;
  text: string;
  evidenceNodeId: string;
  featureIds: string[];
}

export interface DeclaredClaim {
  documentationPromiseId: string;
  text: string;
  evidenceNodeId: string;
  quarantineReason: "NO_DETERMINISTIC_FEATURE_MATCH";
}

export interface FeatureSourceDisagreement {
  structuralComponentId: string;
  /** Null when the component was deduplicated in favor of entrypoint slices. */
  structuralFeatureId: string | null;
  entrypointFeatureIds: string[];
  overlapFileNodeIds: string[];
  structuralFileCount: number;
  resolution: "ENTRYPOINT_SLICES_RETAINED" | "BOTH_SOURCES_RETAINED";
}

export interface DeadCodeCandidate {
  id: string;
  nodeIds: string[];
  file: string;
  line: number;
  symbol: string;
  reachabilityStatus: ProductReachabilityStatus;
  verdict: DeadCodeVerdict;
  reason: string;
  blockers: string[];
  validation: null | {
    passed: boolean;
    commands: string[];
    featureFingerprintUnchanged: boolean;
  };
}

export interface FunctionalityAuditSummary {
  implemented_documented: number;
  implemented_undocumented: number;
  documented_not_implemented: number;
  partially_implemented: number;
  ambiguous: number;
  dead_code_candidates: number;
  ready_for_delete_validation: number;
  validated_safe_to_delete: number;
}

export interface FunctionalityAuditCoverage {
  recognizedEntrypointIds: string[];
  entrypointFeatureMap: Record<string, string[]>;
  unclassifiedEntrypointIds: string[];
  documentationPromiseIds: string[];
  documentationFeatureMap: Record<string, string[]>;
  unclassifiedDocumentationPromiseIds: string[];
  productionReachabilityCounts: Record<ProductReachabilityStatus, number>;
}

export interface FunctionalityAuditMetrics {
  wallClockMs: number;
  deterministicWallClockMs: number;
  modelRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cache: "cold" | "warm";
}

export interface FunctionalityAudit {
  schema: "functionality-audit/v2";
  repositoryCommit: string;
  summary: FunctionalityAuditSummary;
  features: FunctionalityFeature[];
  documentationPromises: DocumentationPromise[];
  declaredClaims: DeclaredClaim[];
  featureSourceDisagreements: FeatureSourceDisagreement[];
  deadCodeCandidates: DeadCodeCandidate[];
  coverage: FunctionalityAuditCoverage;
  metrics: FunctionalityAuditMetrics;
  limitations: string[];
}
