import { createHash } from "node:crypto";

import type {
  EntryPointNode,
  EvidenceGraphNode,
  Evidence,
  FileNode,
  RepositoryGraph,
  SymbolNode,
} from "../graph/types.js";
import { validateRepositoryGraph } from "../graph/validateRepositoryGraph.ts";
import { isReachable } from "../retrieval/reachability.ts";
import { isTestFilePath } from "../scanner/classifyFilePath.ts";
import { validateContractDraft } from "./contractDraft.ts";
import { validateContradictionReviews } from "./contradictionReview.ts";
import { validateCoverageInvestigations } from "./coverageInvestigation.ts";
import {
  applyCoverageInvestigations,
  reviewCoverage,
} from "./coverageReview.ts";
import { resolveDossierReferences } from "./resolveDossierReferences.ts";
import { assertDraftReachability } from "./validateDraftReachability.ts";
import type {
  ContractDraft,
  ContractDraftContradictionReview,
  ContractDraftCoverageInvestigation,
  ContractEvidence,
  ContractClaimVerification,
  ContractRequirement,
  ContractReviewTargetKind,
  ContradictionReviewStatus,
  SoftwareContract,
} from "./types.js";

export interface ContractDiscoveryMetadataInput {
  provider: string;
  model: string;
  toolCallCount: number;
  reviewTurnCount: number;
  coverageInvestigationTurnCount: number;
  correctionRoundCount?: number;
  correctionTurnCount?: number;
  correctionConverged?: boolean;
  inspectedNodeIds: readonly string[];
}

type SourceBearingFileNode = FileNode & {
  lineRange: { start: number; end: number };
};
type SourceBearingNode =
  | SymbolNode
  | EntryPointNode
  | EvidenceGraphNode
  | SourceBearingFileNode;

export function hydrateSoftwareContract(
  graph: RepositoryGraph,
  draft: ContractDraft,
  metadata: ContractDiscoveryMetadataInput,
  contradictionReviews: readonly ContractDraftContradictionReview[],
  coverageInvestigations: readonly ContractDraftCoverageInvestigation[],
): SoftwareContract {
  validateRepositoryGraph(graph);
  validateContractDraft(draft);
  validateMetadata(metadata);
  const resolvedDraft = resolveDossierReferences(graph, draft);
  assertDraftReachability(graph, resolvedDraft);
  validateContractDraftEvidence(graph, resolvedDraft, metadata.inspectedNodeIds);
  const reviews = validateContradictionReviews(
    { reviews: contradictionReviews },
    resolvedDraft,
  );
  const provisionalCoverage = reviewCoverage(graph, resolvedDraft);
  const investigations = validateCoverageInvestigations(
    { investigations: coverageInvestigations },
    provisionalCoverage.suspiciousUnknowns.map((finding) => finding.nodeId),
    graph,
    new Set(metadata.inspectedNodeIds),
  );
  return buildCanonicalSoftwareContract(
    graph,
    resolvedDraft,
    metadata,
    reviews,
    investigations,
  );
}

export function validateContractDraftEvidence(
  graph: RepositoryGraph,
  draft: ContractDraft,
  inspectedNodeIds: readonly string[],
): void {
  const inspected = new Set(inspectedNodeIds);
  const sourceNodesById = new Map<string, SourceBearingNode>([
    ...graph.files.filter(hasSourceRange).map((node) => [node.id, node] as const),
    ...graph.symbols.map((node) => [node.id, node] as const),
    ...graph.entrypoints.map((node) => [node.id, node] as const),
    ...graph.entities.map((node) => [node.id, node] as const),
  ]);
  const sourceNodeIds = new Set(sourceNodesById.keys());
  const filesById = new Map(graph.files.map((file) => [file.id, file]));
  const graphNodeIds = new Set([
    ...graph.files.map((node) => node.id),
    ...sourceNodeIds,
  ]);
  const entrypointIds = new Set(graph.entrypoints.map((node) => node.id));
  const checkEvidence = (nodeIds: readonly string[], location: string) => {
    for (const nodeId of nodeIds) {
      if (!inspected.has(nodeId)) {
        throw new Error(`${location} cites ${JSON.stringify(nodeId)} without a successful get_source inspection`);
      }
      if (!sourceNodeIds.has(nodeId)) {
        throw new Error(`${location} cites missing or non-source node ${JSON.stringify(nodeId)}`);
      }
    }
  };
  const checkNodes = (nodeIds: readonly string[], location: string) => {
    for (const nodeId of nodeIds) {
      if (!graphNodeIds.has(nodeId)) {
        throw new Error(`${location} references missing graph node ${JSON.stringify(nodeId)}`);
      }
    }
  };
  const checkImplementationEvidence = (
    nodeIds: readonly string[],
    location: string,
  ): void => {
    if (nodeIds.some((nodeId) => {
      const node = sourceNodesById.get(nodeId);
      const file = node === undefined
        ? undefined
        : node.type === "file"
          ? node
          : filesById.get(node.fileId);
      return file !== undefined && !isTestFilePath(file.path) && node?.type !== "test";
    })) {
      return;
    }
    throw new Error(
      `${location} is an implementation claim supported only by test evidence`,
    );
  };

  for (const dossier of draft.featureDossiers) {
    for (const [section, nodeIds] of Object.entries({
      entrypoints: dossier.entrypoints,
      ui: dossier.ui,
      handlers: dossier.handlers,
      services: dossier.services,
      schemas: dossier.schemas,
      events: dossier.events,
      tests: dossier.tests,
      config: dossier.config,
      documentation: dossier.documentation,
    })) {
      checkNodes(nodeIds, `feature dossier ${JSON.stringify(dossier.id)}.${section}`);
    }
    checkEvidence(dossier.evidenceNodeIds, `feature dossier ${JSON.stringify(dossier.id)}`);
    checkImplementationEvidence(
      dossier.evidenceNodeIds,
      `feature dossier ${JSON.stringify(dossier.id)}`,
    );
  }
  for (const capability of draft.capabilities) {
    for (const entrypointId of capability.entrypointNodeIds) {
      if (!entrypointIds.has(entrypointId)) {
        throw new Error(`capability ${JSON.stringify(capability.id)} references missing entrypoint ${JSON.stringify(entrypointId)}`);
      }
      if (!inspected.has(entrypointId)) {
        throw new Error(`capability ${JSON.stringify(capability.id)} references entrypoint ${JSON.stringify(entrypointId)} without a successful get_source inspection`);
      }
    }
    checkEvidence(capability.evidenceNodeIds, `capability ${JSON.stringify(capability.id)}`);
    checkImplementationEvidence(
      capability.evidenceNodeIds,
      `capability ${JSON.stringify(capability.id)}`,
    );
  }
  for (const flow of draft.userFlows) {
    checkEvidence(flow.evidenceNodeIds, `user flow ${JSON.stringify(flow.id)}`);
    checkImplementationEvidence(
      flow.evidenceNodeIds,
      `user flow ${JSON.stringify(flow.id)}`,
    );
    for (const step of flow.steps) {
      checkEvidence(step.evidenceNodeIds, `user flow ${JSON.stringify(flow.id)} step ${step.order}`);
      checkImplementationEvidence(
        step.evidenceNodeIds,
        `user flow ${JSON.stringify(flow.id)} step ${step.order}`,
      );
    }
  }
  for (const requirement of draft.requirements) {
    checkEvidence(requirement.evidenceNodeIds, `requirement ${JSON.stringify(requirement.id)}`);
  }
  for (const uncertainty of draft.uncertainties) {
    checkEvidence(uncertainty.evidenceNodeIds, `uncertainty ${JSON.stringify(uncertainty.id)}`);
  }
}

export function buildCanonicalSoftwareContract(
  graph: RepositoryGraph,
  draft: ContractDraft,
  metadata: ContractDiscoveryMetadataInput,
  contradictionReviews: readonly ContractDraftContradictionReview[],
  coverageInvestigations: readonly ContractDraftCoverageInvestigation[],
): SoftwareContract {
  const inspectedNodeIds = [...new Set(metadata.inspectedNodeIds)].sort(compareText);
  const inspected = new Set(inspectedNodeIds);
  const nodesById = new Map<string, SourceBearingNode>([
    ...graph.files.filter(hasSourceRange).map((node) => [node.id, node] as const),
    ...graph.symbols.map((node) => [node.id, node] as const),
    ...graph.entrypoints.map((node) => [node.id, node] as const),
    ...graph.entities.map((node) => [node.id, node] as const),
  ]);
  const filesById = new Map(graph.files.map((file) => [file.id, file]));
  const graphNodeIds = new Set([
    ...graph.files.map((node) => node.id),
    ...graph.symbols.map((node) => node.id),
    ...graph.entrypoints.map((node) => node.id),
    ...graph.entities.map((node) => node.id),
  ]);

  const evidenceFor = (
    nodeIds: readonly string[],
    location: string,
  ): ContractEvidence[] =>
    [...nodeIds]
      .sort(compareText)
      .map((nodeId) => {
        if (!inspected.has(nodeId)) {
          throw new Error(
            `${location} cites ${JSON.stringify(nodeId)} without a successful get_source inspection`,
          );
        }

        const node = nodesById.get(nodeId);
        if (node === undefined) {
          throw new Error(
            `${location} cites missing or non-source node ${JSON.stringify(nodeId)}`,
          );
        }
        const file = node.type === "file" ? node : filesById.get(node.fileId);
        if (file === undefined) {
          throw new Error(
            `${location} cites node with missing owner ${JSON.stringify(node.type === "file" ? node.id : node.fileId)}`,
          );
        }
        const evidence = structuralEvidence(graph, node);
        if (
          evidence.file !== file.path ||
          evidence.line !== node.lineRange.start
        ) {
          throw new Error(
            `${location} cites node ${JSON.stringify(nodeId)} whose structural evidence does not match its source range`,
          );
        }

        return {
          nodeId,
          file: file.path,
          lineRange: { ...node.lineRange },
          contentHash: file.contentHash,
          extractor: evidence.extractor,
          role: evidenceRole(node, file.path),
        };
      });

  const graphEntrypointIds = new Set(
    graph.entrypoints.map((entrypoint) => entrypoint.id),
  );
  const entrypointReferences = (
    nodeIds: readonly string[],
    location: string,
  ): string[] =>
    [...nodeIds].sort(compareText).map((nodeId) => {
      if (!graphEntrypointIds.has(nodeId)) {
        throw new Error(
          `${location} references missing entrypoint ${JSON.stringify(nodeId)}`,
        );
      }
      if (!inspected.has(nodeId)) {
        throw new Error(
          `${location} references entrypoint ${JSON.stringify(nodeId)} without a successful get_source inspection`,
        );
      }
      return nodeId;
    });
  const nodeReferences = (
    nodeIds: readonly string[],
    location: string,
  ): string[] =>
    [...nodeIds].sort(compareText).map((nodeId) => {
      if (!graphNodeIds.has(nodeId)) {
        throw new Error(`${location} references missing graph node ${JSON.stringify(nodeId)}`);
      }
      return nodeId;
    });
  const reviewStatusFor = (
    targetKind: ContractReviewTargetKind,
    targetId: string,
  ): ContradictionReviewStatus | undefined =>
    contradictionReviews.find(
      (review) => review.targetKind === targetKind && review.targetId === targetId,
    )?.status;
  const confidenceFor = (
    targetKind: ContractReviewTargetKind,
    targetId: string,
  ) => reviewConfidence(reviewStatusFor(targetKind, targetId));
  const verificationFor = (
    targetKind: ContractReviewTargetKind,
    targetId: string,
    evidence: readonly ContractEvidence[],
    unresolved = false,
    implementationEvidenceRequired = targetKind !== "requirement",
  ) => claimVerification(
    reviewStatusFor(targetKind, targetId),
    evidence,
    unresolved,
    implementationEvidenceRequired,
  );
  const hydratedRequirements: ContractRequirement[] = [...draft.requirements]
    .sort((left, right) => compareText(left.id, right.id))
    .map((requirement) => {
      const evidence = evidenceFor(
        requirement.evidenceNodeIds,
        `requirement ${JSON.stringify(requirement.id)}`,
      );
      return {
        id: requirement.id,
        category: requirement.category,
        statement: requirement.statement.trim(),
        evidence,
        confidence: confidenceFor("requirement", requirement.id),
        verification: verificationFor(
          "requirement",
          requirement.id,
          evidence,
          false,
          requirement.category !== "dependency" &&
            requirement.category !== "architecture",
        ),
      };
    });

  const contract: Omit<SoftwareContract, "acceptance"> = {
    version: 4,
    repository: {
      graphVersion: graph.version,
      graphHash: createHash("sha256")
        .update(JSON.stringify(graph))
        .digest("hex"),
      fileCount: graph.files.length,
      symbolCount: graph.symbols.length,
      entrypointCount: graph.entrypoints.length,
      sourceFileCount: graph.analysis.sourceFileCount,
      parsedSourceFileCount: graph.analysis.parsedSourceFileCount,
      unparsedSourceFiles: [...graph.analysis.unparsedSourceFiles],
      graphDiagnostics: graph.analysis.diagnostics.length,
    },
    discovery: {
      provider: metadata.provider,
      model: metadata.model,
      toolCallCount: metadata.toolCallCount,
      reviewTurnCount: metadata.reviewTurnCount,
      coverageInvestigationTurnCount: metadata.coverageInvestigationTurnCount,
      correctionRoundCount: metadata.correctionRoundCount ?? 0,
      correctionTurnCount: metadata.correctionTurnCount ?? 0,
      correctionConverged: metadata.correctionConverged ?? true,
      completedStages: [
        "discovery",
        "feature_dossiers",
        "reachability",
        "contradiction_review",
        "coverage_review",
        ...((metadata.correctionRoundCount ?? 0) > 0
          ? ["contract_correction" as const]
          : []),
        "acceptance_review",
      ],
      inspectedNodeIds,
    },
    entrypoints: [...graph.entrypoints]
      .sort((left, right) => compareText(left.id, right.id))
      .map((entrypoint) => {
        const file = filesById.get(entrypoint.fileId);
        if (file === undefined) {
          throw new Error(
            `Entrypoint ${JSON.stringify(entrypoint.id)} references missing owner ${JSON.stringify(entrypoint.fileId)}`,
          );
        }
        return {
          nodeId: entrypoint.id,
          kind: entrypoint.kind,
          name: entrypoint.name,
          file: file.path,
          lineRange: { ...entrypoint.lineRange },
          handlerSymbolId: entrypoint.handlerSymbolId ?? null,
        };
      }),
    featureDossiers: [...draft.featureDossiers]
      .sort((left, right) => compareText(left.id, right.id))
      .map((dossier) => {
        const evidence = evidenceFor(
          dossier.evidenceNodeIds,
          `feature dossier ${JSON.stringify(dossier.id)}`,
        );
        const reachability = dossierReachability(graph, dossier);
        return {
          id: dossier.id,
          title: dossier.title.trim(),
          entrypoints: nodeReferences(
            dossier.entrypoints,
            `feature dossier ${JSON.stringify(dossier.id)}.entrypoints`,
          ),
          ui: nodeReferences(dossier.ui, `feature dossier ${JSON.stringify(dossier.id)}.ui`),
          handlers: nodeReferences(
            dossier.handlers,
            `feature dossier ${JSON.stringify(dossier.id)}.handlers`,
          ),
          services: nodeReferences(
            dossier.services,
            `feature dossier ${JSON.stringify(dossier.id)}.services`,
          ),
          schemas: nodeReferences(
            dossier.schemas,
            `feature dossier ${JSON.stringify(dossier.id)}.schemas`,
          ),
          stateTransitions: [...dossier.stateTransitions]
            .map((transition) => transition.trim())
            .sort(compareText),
          events: nodeReferences(
            dossier.events,
            `feature dossier ${JSON.stringify(dossier.id)}.events`,
          ),
          tests: nodeReferences(
            dossier.tests,
            `feature dossier ${JSON.stringify(dossier.id)}.tests`,
          ),
          config: nodeReferences(
            dossier.config,
            `feature dossier ${JSON.stringify(dossier.id)}.config`,
          ),
          documentation: nodeReferences(
            dossier.documentation,
            `feature dossier ${JSON.stringify(dossier.id)}.documentation`,
          ),
          evidence,
          unresolvedQuestions: dossier.unresolvedQuestions.map((question) => question.trim()),
          reachability,
          confidence: confidenceFor("feature_dossier", dossier.id),
          verification: verificationFor(
            "feature_dossier",
            dossier.id,
            evidence,
            dossier.unresolvedQuestions.length > 0 || reachability === "unknown",
          ),
        };
      }),
    contradictionReviews: [...contradictionReviews]
      .sort((left, right) =>
        compareText(
          `${left.targetKind}:${left.targetId}`,
          `${right.targetKind}:${right.targetId}`,
        ),
      )
      .map((review) => ({
        targetKind: review.targetKind,
        targetId: review.targetId,
        hypothesis: review.hypothesis.trim(),
        status: review.status,
        conclusion: review.conclusion.trim(),
        evidence: evidenceFor(
          review.evidenceNodeIds,
          `contradiction review ${JSON.stringify(`${review.targetKind}:${review.targetId}`)}`,
        ),
      })),
    coverageReview: (() => {
      const coverage = reviewCoverage(graph, draft);
      const investigations = [...coverageInvestigations]
        .sort((left, right) => compareText(left.nodeId, right.nodeId))
        .map((investigation) => ({
          nodeId: investigation.nodeId,
          classification: investigation.classification,
          conclusion: investigation.conclusion.trim(),
          evidence: evidenceFor(
            investigation.evidenceNodeIds,
            `coverage investigation ${JSON.stringify(investigation.nodeId)}`,
          ),
        }));
      return applyCoverageInvestigations(coverage, investigations);
    })(),
    capabilities: [...draft.capabilities]
      .sort((left, right) => compareText(left.id, right.id))
      .map((capability) => {
        const evidence = evidenceFor(
          capability.evidenceNodeIds,
          `capability ${JSON.stringify(capability.id)}`,
        );
        return {
          id: capability.id,
          dossierId: capability.dossierId,
          title: capability.title.trim(),
          description: capability.description.trim(),
          entrypointNodeIds: entrypointReferences(
            capability.entrypointNodeIds,
            `capability ${JSON.stringify(capability.id)}`,
          ),
          evidence,
          confidence: confidenceFor("capability", capability.id),
          verification: verificationFor("capability", capability.id, evidence),
        };
      }),
    userFlows: [...draft.userFlows]
      .sort((left, right) => compareText(left.id, right.id))
      .map((flow) => {
        const evidence = evidenceFor(
          flow.evidenceNodeIds,
          `user flow ${JSON.stringify(flow.id)}`,
        );
        const steps = flow.steps.map((step) => ({
            order: step.order,
            statement: step.statement.trim(),
            evidence: evidenceFor(
              step.evidenceNodeIds,
              `user flow ${JSON.stringify(flow.id)} step ${step.order}`,
            ),
          }));
        const allEvidence = [...evidence, ...steps.flatMap((step) => step.evidence)];
        return {
          id: flow.id,
          title: flow.title.trim(),
          description: flow.description.trim(),
          evidence,
          steps,
          confidence: confidenceFor("user_flow", flow.id),
          verification: verificationFor("user_flow", flow.id, allEvidence),
        };
      }),
    requirements: hydratedRequirements.filter(
      (requirement) => requirement.verification.status !== "DECLARED_ONLY",
    ),
    declaredClaims: hydratedRequirements.filter(
      (requirement) => requirement.verification.status === "DECLARED_ONLY",
    ),
    uncertainties: [...draft.uncertainties]
      .sort((left, right) => compareText(left.id, right.id))
      .map((uncertainty) => {
        const evidence = evidenceFor(
          uncertainty.evidenceNodeIds,
          `uncertainty ${JSON.stringify(uncertainty.id)}`,
        );
        return {
          id: uncertainty.id,
          statement: uncertainty.statement.trim(),
          reason: uncertainty.reason.trim(),
          evidence,
          confidence: "UNKNOWN",
          verification: claimVerification(undefined, evidence, true, false),
        };
      }),
  };
  return {
    ...contract,
    acceptance: assessContractAcceptance(contract),
  };
}

function evidenceRole(
  node: SourceBearingNode,
  filePath: string,
): ContractEvidence["role"] {
  if (
    node.type === "test" ||
    isTestFilePath(filePath)
  ) {
    return "test";
  }
  if (
    /(?:^|\/)(?:readme|agents)\.md$|(?:^|\/)docs\/.*\.(?:md|mdx)$/iu.test(filePath)
  ) {
    return "documentation";
  }
  if (
    node.type === "config" ||
    /(?:^|\/)(?:package\.json|pyproject\.toml|requirements[^/]*\.txt|docker-compose\.ya?ml|dockerfile|tsconfig\.json|jsconfig\.json|[^/]+\.config\.[^/]+|\.env\.example)$/iu.test(filePath)
  ) {
    return "configuration";
  }
  return "implementation";
}

function claimVerification(
  reviewStatus: ContradictionReviewStatus | undefined,
  evidence: readonly ContractEvidence[],
  unresolved: boolean,
  implementationEvidenceRequired: boolean,
): ContractClaimVerification {
  const evidenceRoles = [...new Set(evidence.map((item) => item.role))]
    .sort(compareText);
  const runtimeVerified = evidenceRoles.includes("runtime");
  let status: ContractClaimVerification["status"];
  if (reviewStatus === "REFUTED") status = "CONTRADICTED";
  else if (reviewStatus === "PARTIALLY_TRUE") status = "PARTIALLY_VERIFIED";
  else if (reviewStatus !== "CONFIRMED") status = "UNRESOLVED";
  else if (unresolved) status = "PARTIALLY_VERIFIED";
  else if (
    evidenceRoles.length > 0 &&
    evidenceRoles.every((role) => role === "documentation")
  ) {
    status = "DECLARED_ONLY";
  } else if (
    implementationEvidenceRequired &&
    !evidenceRoles.includes("implementation") &&
    !runtimeVerified
  ) {
    status = "PARTIALLY_VERIFIED";
  } else if (runtimeVerified) status = "RUNTIME_VERIFIED";
  else status = "STATIC_VERIFIED";
  return { status, evidenceRoles, runtimeVerified };
}

function assessContractAcceptance(
  contract: Omit<SoftwareContract, "acceptance">,
): SoftwareContract["acceptance"] {
  const failures: string[] = [];
  if (contract.repository.unparsedSourceFiles.length > 0) {
    failures.push(`${contract.repository.unparsedSourceFiles.length} supported source file(s) could not be parsed.`);
  }
  if (contract.repository.graphDiagnostics > 0) {
    failures.push(`${contract.repository.graphDiagnostics} graph extraction diagnostic(s) remain unresolved.`);
  }
  if (!contract.discovery.correctionConverged) {
    failures.push("Contract correction did not converge.");
  }
  const nonConfirmedReviews = contract.contradictionReviews.filter(
    (review) => review.status !== "CONFIRMED",
  );
  if (nonConfirmedReviews.length > 0) {
    failures.push(`${nonConfirmedReviews.length} contradiction review(s) are not confirmed.`);
  }
  if (contract.coverageReview.unaccountedMeaningfulNodes > 0) {
    failures.push(`${contract.coverageReview.unaccountedMeaningfulNodes} meaningful graph node(s) lack a contract claim or conclusive support classification.`);
  }
  if (contract.coverageReview.remainingUnknownNodeIds.length > 0) {
    failures.push(`${contract.coverageReview.remainingUnknownNodeIds.length} coverage investigation(s) remain unknown.`);
  }
  if (contract.uncertainties.length > 0) {
    failures.push(`${contract.uncertainties.length} contract uncertainty item(s) remain unresolved.`);
  }
  const claims = [
    ...contract.featureDossiers,
    ...contract.capabilities,
    ...contract.userFlows,
    ...contract.requirements,
  ];
  const unresolvedClaims = claims.filter(
    (claim) =>
      claim.verification.status !== "STATIC_VERIFIED" &&
      claim.verification.status !== "RUNTIME_VERIFIED",
  );
  if (unresolvedClaims.length > 0) {
    failures.push(`${unresolvedClaims.length} implementation claim(s) are not fully verified.`);
  }
  const runtimeVerificationPerformed = claims.some(
    (claim) => claim.verification.runtimeVerified,
  );
  return {
    status:
      failures.length > 0
        ? "INCOMPLETE"
        : runtimeVerificationPerformed
          ? "RUNTIME_VERIFIED"
          : "STATICALLY_VERIFIED",
    runtimeVerificationPerformed,
    failures,
  };
}

function reviewConfidence(
  status: ContradictionReviewStatus | undefined,
): "PROVEN" | "INFERRED" | "UNKNOWN" {
  if (status === "CONFIRMED") return "PROVEN";
  if (status === "PARTIALLY_TRUE") return "INFERRED";
  return "UNKNOWN";
}

function dossierReachability(
  graph: RepositoryGraph,
  dossier: ContractDraft["featureDossiers"][number],
): ContractDraft["featureDossiers"][number]["reachability"] {
  const functionalNodeIds = [...new Set([
    ...dossier.entrypoints,
    ...dossier.ui,
    ...dossier.handlers,
    ...dossier.services,
    ...dossier.events,
  ])];
  const nodeIds = functionalNodeIds.length > 0
    ? functionalNodeIds
    : [...new Set(dossier.evidenceNodeIds)];
  if (nodeIds.length === 0) return "unknown";
  const statuses = new Set(nodeIds.map((nodeId) => isReachable(graph, nodeId).status));
  if (statuses.has("reachable")) return "reachable";
  if (statuses.has("internally_reachable")) return "internally_reachable";
  if (statuses.has("test_only")) return "test_only";
  if (statuses.has("unknown")) return "unknown";
  return "dead_or_unreferenced";
}

function structuralEvidence(
  graph: RepositoryGraph,
  node: SourceBearingNode,
): Evidence {
  if (node.type === "file") {
    return {
      file: node.path,
      line: node.lineRange.start,
      extractor: "scanner",
    };
  }
  if ("evidence" in node) {
    return node.evidence;
  }

  const containsEdge = graph.edges.find(
    (edge) =>
      edge.type === "CONTAINS" &&
      edge.source === node.fileId &&
      edge.target === node.id,
  );
  if (containsEdge === undefined) {
    throw new Error(
      `Symbol ${JSON.stringify(node.id)} has no evidence-bearing CONTAINS edge`,
    );
  }
  return containsEdge.evidence;
}

function hasSourceRange(file: FileNode): file is SourceBearingFileNode {
  return file.lineRange !== undefined;
}

function validateMetadata(metadata: ContractDiscoveryMetadataInput): void {
  if (metadata.provider.trim().length === 0) {
    throw new Error("Contract discovery provider must not be empty");
  }
  if (metadata.model.trim().length === 0) {
    throw new Error("Contract discovery model must not be empty");
  }
  if (
    !Number.isSafeInteger(metadata.toolCallCount) ||
    metadata.toolCallCount < 0
  ) {
    throw new Error("Contract discovery toolCallCount must be non-negative");
  }
  if (
    !Number.isSafeInteger(metadata.reviewTurnCount) ||
    metadata.reviewTurnCount < 0
  ) {
    throw new Error("Contract discovery reviewTurnCount must be non-negative");
  }
  if (
    !Number.isSafeInteger(metadata.coverageInvestigationTurnCount) ||
    metadata.coverageInvestigationTurnCount < 0
  ) {
    throw new Error("Contract discovery coverageInvestigationTurnCount must be non-negative");
  }
  if (
    metadata.correctionRoundCount !== undefined &&
    (!Number.isSafeInteger(metadata.correctionRoundCount) ||
      metadata.correctionRoundCount < 0)
  ) {
    throw new Error("Contract discovery correctionRoundCount must be non-negative");
  }
  if (
    metadata.correctionTurnCount !== undefined &&
    (!Number.isSafeInteger(metadata.correctionTurnCount) ||
      metadata.correctionTurnCount < 0)
  ) {
    throw new Error("Contract discovery correctionTurnCount must be non-negative");
  }
  if (
    metadata.correctionConverged !== undefined &&
    typeof metadata.correctionConverged !== "boolean"
  ) {
    throw new Error("Contract discovery correctionConverged must be boolean");
  }
  if (
    metadata.inspectedNodeIds.some(
      (nodeId) => typeof nodeId !== "string" || nodeId.length === 0,
    )
  ) {
    throw new Error("Inspected node IDs must be non-empty strings");
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
