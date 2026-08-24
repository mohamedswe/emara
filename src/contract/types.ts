import type {
  EntryPointKind,
  EvidenceExtractor,
} from "../graph/types.js";

export type ContractRequirementCategory =
  | "behavior"
  | "validation"
  | "security"
  | "dependency"
  | "architecture"
  | "reliability"
  | "performance";

export interface ContractEvidence {
  nodeId: string;
  file: string;
  lineRange: {
    start: number;
    end: number;
  };
  contentHash: string;
  extractor: EvidenceExtractor;
  role: ContractEvidenceRole;
}

export type ContractEvidenceRole =
  | "implementation"
  | "configuration"
  | "test"
  | "documentation"
  | "runtime";

export type ClaimVerificationStatus =
  | "STATIC_VERIFIED"
  | "RUNTIME_VERIFIED"
  | "DECLARED_ONLY"
  | "PARTIALLY_VERIFIED"
  | "CONTRADICTED"
  | "UNRESOLVED";

export interface ContractClaimVerification {
  status: ClaimVerificationStatus;
  evidenceRoles: ContractEvidenceRole[];
  runtimeVerified: boolean;
}

export interface ContractEntrypoint {
  nodeId: string;
  kind: EntryPointKind;
  name: string;
  file: string;
  lineRange: {
    start: number;
    end: number;
  };
  handlerSymbolId: string | null;
}

export interface ContractCapability {
  id: string;
  dossierId: string;
  title: string;
  description: string;
  entrypointNodeIds: string[];
  evidence: ContractEvidence[];
  confidence: ClaimConfidence;
  verification: ContractClaimVerification;
}

export type FeatureReachability =
  | "reachable"
  | "internally_reachable"
  | "test_only"
  | "dead_or_unreferenced"
  | "unknown";

export interface ContractFeatureDossier {
  id: string;
  title: string;
  entrypoints: string[];
  ui: string[];
  handlers: string[];
  services: string[];
  schemas: string[];
  stateTransitions: string[];
  events: string[];
  tests: string[];
  config: string[];
  documentation: string[];
  evidence: ContractEvidence[];
  unresolvedQuestions: string[];
  reachability: FeatureReachability;
  confidence: ClaimConfidence;
  verification: ContractClaimVerification;
}

export interface ContractUserFlowStep {
  order: number;
  statement: string;
  evidence: ContractEvidence[];
}

export interface ContractUserFlow {
  id: string;
  title: string;
  description: string;
  evidence: ContractEvidence[];
  steps: ContractUserFlowStep[];
  confidence: ClaimConfidence;
  verification: ContractClaimVerification;
}

export interface ContractRequirement {
  id: string;
  category: ContractRequirementCategory;
  statement: string;
  evidence: ContractEvidence[];
  confidence: ClaimConfidence;
  verification: ContractClaimVerification;
}

export type ContractDeclaredClaim = ContractRequirement;

export interface ContractUncertainty {
  id: string;
  statement: string;
  reason: string;
  evidence: ContractEvidence[];
  confidence: "UNKNOWN";
  verification: ContractClaimVerification;
}

export type ContradictionReviewStatus =
  | "CONFIRMED"
  | "REFUTED"
  | "PARTIALLY_TRUE"
  | "UNKNOWN";

export type ContractReviewTargetKind =
  | "feature_dossier"
  | "capability"
  | "user_flow"
  | "requirement";

export type ClaimConfidence = "PROVEN" | "INFERRED" | "UNKNOWN";

export interface ContractContradictionReview {
  targetKind: ContractReviewTargetKind;
  targetId: string;
  hypothesis: string;
  status: ContradictionReviewStatus;
  conclusion: string;
  evidence: ContractEvidence[];
}

export interface ContractDraftContradictionReview {
  targetKind: ContractReviewTargetKind;
  targetId: string;
  hypothesis: string;
  status: ContradictionReviewStatus;
  conclusion: string;
  evidenceNodeIds: string[];
}

export type CoverageClassification =
  | "feature"
  | "infrastructure"
  | "utility"
  | "test"
  | "configuration"
  | "documentation"
  | "dead/unreachable"
  | "generated/vendor"
  | "unknown";

export interface ContractCoverageInvestigation {
  nodeId: string;
  classification: CoverageClassification;
  conclusion: string;
  evidence: ContractEvidence[];
}

export interface ContractDraftCoverageInvestigation {
  nodeId: string;
  classification: CoverageClassification;
  conclusion: string;
  evidenceNodeIds: string[];
}

export interface ContractCoverageFinding {
  nodeId: string;
  nodeType: string;
  exported: boolean | null;
  file: string;
  lineRange: { start: number; end: number } | null;
  classification: CoverageClassification;
  reachability: FeatureReachability;
  reason: string;
  explainedByContractIds: string[];
}

export interface ContractCoverageReview {
  meaningfulNodes: number;
  explainedMeaningfulNodes: number;
  supportAccountedMeaningfulNodes: number;
  accountedMeaningfulNodes: number;
  unexplainedMeaningfulNodes: number;
  unaccountedMeaningfulNodes: number;
  coveragePercent: number;
  classificationCounts: Record<CoverageClassification, number>;
  unexplained: ContractCoverageFinding[];
  unaccounted: ContractCoverageFinding[];
  suspiciousUnknowns: ContractCoverageFinding[];
  investigations: ContractCoverageInvestigation[];
  remainingUnknownNodeIds: string[];
}

export interface SoftwareContract {
  version: 4;
  repository: {
    graphVersion: 4;
    graphHash: string;
    fileCount: number;
    symbolCount: number;
    entrypointCount: number;
    sourceFileCount: number;
    parsedSourceFileCount: number;
    unparsedSourceFiles: string[];
    graphDiagnostics: number;
  };
  discovery: {
    provider: string;
    model: string;
    toolCallCount: number;
    reviewTurnCount: number;
    coverageInvestigationTurnCount: number;
    correctionRoundCount: number;
    correctionTurnCount: number;
    correctionConverged: boolean;
    completedStages: ContractDiscoveryStage[];
    inspectedNodeIds: string[];
  };
  acceptance: ContractAcceptance;
  entrypoints: ContractEntrypoint[];
  featureDossiers: ContractFeatureDossier[];
  contradictionReviews: ContractContradictionReview[];
  coverageReview: ContractCoverageReview;
  capabilities: ContractCapability[];
  userFlows: ContractUserFlow[];
  requirements: ContractRequirement[];
  declaredClaims: ContractDeclaredClaim[];
  uncertainties: ContractUncertainty[];
}

export type ContractDiscoveryStage =
  | "discovery"
  | "feature_dossiers"
  | "reachability"
  | "contradiction_review"
  | "coverage_review"
  | "contract_correction"
  | "acceptance_review";

export interface ContractAcceptance {
  status: "STATICALLY_VERIFIED" | "RUNTIME_VERIFIED" | "INCOMPLETE";
  runtimeVerificationPerformed: boolean;
  failures: string[];
}

export interface ContractDraftCapability {
  id: string;
  dossierId: string;
  title: string;
  description: string;
  entrypointNodeIds: string[];
  evidenceNodeIds: string[];
}

export interface ContractDraftFeatureDossier {
  id: string;
  title: string;
  entrypoints: string[];
  ui: string[];
  handlers: string[];
  services: string[];
  schemas: string[];
  stateTransitions: string[];
  events: string[];
  tests: string[];
  config: string[];
  documentation: string[];
  evidenceNodeIds: string[];
  unresolvedQuestions: string[];
  reachability: FeatureReachability;
}

export interface ContractDraftUserFlowStep {
  order: number;
  statement: string;
  evidenceNodeIds: string[];
}

export interface ContractDraftUserFlow {
  id: string;
  title: string;
  description: string;
  evidenceNodeIds: string[];
  steps: ContractDraftUserFlowStep[];
}

export interface ContractDraftRequirement {
  id: string;
  category: ContractRequirementCategory;
  statement: string;
  evidenceNodeIds: string[];
}

export interface ContractDraftUncertainty {
  id: string;
  statement: string;
  reason: string;
  evidenceNodeIds: string[];
}

export interface ContractDraft {
  featureDossiers: ContractDraftFeatureDossier[];
  capabilities: ContractDraftCapability[];
  userFlows: ContractDraftUserFlow[];
  requirements: ContractDraftRequirement[];
  uncertainties: ContractDraftUncertainty[];
}
