import { isDeepStrictEqual } from "node:util";

import type { RepositoryGraph } from "../graph/types.js";
import { validateRepositoryGraph } from "../graph/validateRepositoryGraph.ts";
import {
  hydrateSoftwareContract,
  type ContractDiscoveryMetadataInput,
} from "./hydrateContract.ts";
import type {
  ContractDraft,
  ContractDraftCapability,
  ContractDraftContradictionReview,
  ContractDraftCoverageInvestigation,
  ContractDraftFeatureDossier,
  ContractDraftRequirement,
  ContractDraftUncertainty,
  ContractDraftUserFlow,
  ContractDraftUserFlowStep,
  SoftwareContract,
} from "./types.js";

export function validateSoftwareContract(
  value: unknown,
  graph: RepositoryGraph,
): asserts value is SoftwareContract {
  validateRepositoryGraph(graph);
  const {
    draft,
    metadata,
    contradictionReviews,
    coverageInvestigations,
  } = contractInputs(value);
  const canonical = hydrateSoftwareContract(
    graph,
    draft,
    metadata,
    contradictionReviews,
    coverageInvestigations,
  );

  if (!isDeepStrictEqual(value, canonical)) {
    throw new Error(
      "Invalid software contract: contract does not match its canonical graph-backed representation",
    );
  }
}

function contractInputs(value: unknown): {
  draft: ContractDraft;
  metadata: ContractDiscoveryMetadataInput;
  contradictionReviews: ContractDraftContradictionReview[];
  coverageInvestigations: ContractDraftCoverageInvestigation[];
} {
  if (!isRecord(value)) {
    throw new Error("Invalid software contract: contract must be an object");
  }
  if (value.version !== 4) {
    throw new Error("Invalid software contract: version must be 4");
  }

  const discovery = recordField(value, "discovery", "contract");
  const provider = stringField(discovery, "provider", "discovery");
  const model = stringField(discovery, "model", "discovery");
  const toolCallCount = integerField(
    discovery,
    "toolCallCount",
    "discovery",
  );
  const reviewTurnCount = integerField(
    discovery,
    "reviewTurnCount",
    "discovery",
  );
  const coverageInvestigationTurnCount = integerField(
    discovery,
    "coverageInvestigationTurnCount",
    "discovery",
  );
  const correctionRoundCount = integerField(
    discovery,
    "correctionRoundCount",
    "discovery",
  );
  const correctionTurnCount = integerField(
    discovery,
    "correctionTurnCount",
    "discovery",
  );
  const correctionConverged = booleanField(
    discovery,
    "correctionConverged",
    "discovery",
  );
  const inspectedNodeIds = stringArrayField(
    discovery,
    "inspectedNodeIds",
    "discovery",
  );

  return {
    metadata: {
      provider,
      model,
      toolCallCount,
      reviewTurnCount,
      coverageInvestigationTurnCount,
      correctionRoundCount,
      correctionTurnCount,
      correctionConverged,
      inspectedNodeIds,
    },
    contradictionReviews: objectArrayField(
      value,
      "contradictionReviews",
      "contract",
    ).map(contradictionReviewDraft),
    coverageInvestigations: objectArrayField(
      recordField(value, "coverageReview", "contract"),
      "investigations",
      "coverageReview",
    ).map(coverageInvestigationDraft),
    draft: {
      featureDossiers: objectArrayField(
        value,
        "featureDossiers",
        "contract",
      ).map(featureDossierDraft),
      capabilities: objectArrayField(value, "capabilities", "contract").map(
        capabilityDraft,
      ),
      userFlows: objectArrayField(value, "userFlows", "contract").map(
        userFlowDraft,
      ),
      requirements: [
        ...objectArrayField(value, "requirements", "contract"),
        ...objectArrayField(value, "declaredClaims", "contract"),
      ].map(requirementDraft),
      uncertainties: objectArrayField(
        value,
        "uncertainties",
        "contract",
      ).map(uncertaintyDraft),
    },
  };
}

function coverageInvestigationDraft(
  value: Record<string, unknown>,
  index: number,
): ContractDraftCoverageInvestigation {
  const location = `coverageReview.investigations[${index}]`;
  return {
    nodeId: stringField(value, "nodeId", location),
    classification: stringField(value, "classification", location) as ContractDraftCoverageInvestigation["classification"],
    conclusion: stringField(value, "conclusion", location),
    evidenceNodeIds: evidenceNodeIds(value, location),
  };
}

function contradictionReviewDraft(
  value: Record<string, unknown>,
  index: number,
): ContractDraftContradictionReview {
  const location = `contradictionReviews[${index}]`;
  return {
    targetKind: stringField(value, "targetKind", location) as ContractDraftContradictionReview["targetKind"],
    targetId: stringField(value, "targetId", location),
    hypothesis: stringField(value, "hypothesis", location),
    status: stringField(value, "status", location) as ContractDraftContradictionReview["status"],
    conclusion: stringField(value, "conclusion", location),
    evidenceNodeIds: evidenceNodeIds(value, location),
  };
}

function featureDossierDraft(
  value: Record<string, unknown>,
  index: number,
): ContractDraftFeatureDossier {
  const location = `featureDossiers[${index}]`;
  return {
    id: stringField(value, "id", location),
    title: stringField(value, "title", location),
    entrypoints: stringArrayField(value, "entrypoints", location),
    ui: stringArrayField(value, "ui", location),
    handlers: stringArrayField(value, "handlers", location),
    services: stringArrayField(value, "services", location),
    schemas: stringArrayField(value, "schemas", location),
    stateTransitions: stringArrayField(value, "stateTransitions", location),
    events: stringArrayField(value, "events", location),
    tests: stringArrayField(value, "tests", location),
    config: stringArrayField(value, "config", location),
    documentation: stringArrayField(value, "documentation", location),
    evidenceNodeIds: evidenceNodeIds(value, location),
    unresolvedQuestions: stringArrayField(value, "unresolvedQuestions", location),
    reachability: stringField(value, "reachability", location) as ContractDraftFeatureDossier["reachability"],
  };
}

function capabilityDraft(
  value: Record<string, unknown>,
  index: number,
): ContractDraftCapability {
  const location = `capabilities[${index}]`;
  return {
    id: stringField(value, "id", location),
    dossierId: stringField(value, "dossierId", location),
    title: stringField(value, "title", location),
    description: stringField(value, "description", location),
    entrypointNodeIds: stringArrayField(
      value,
      "entrypointNodeIds",
      location,
    ),
    evidenceNodeIds: evidenceNodeIds(value, location),
  };
}

function userFlowDraft(
  value: Record<string, unknown>,
  index: number,
): ContractDraftUserFlow {
  const location = `userFlows[${index}]`;
  return {
    id: stringField(value, "id", location),
    title: stringField(value, "title", location),
    description: stringField(value, "description", location),
    evidenceNodeIds: evidenceNodeIds(value, location),
    steps: objectArrayField(value, "steps", location).map(flowStepDraft),
  };
}

function flowStepDraft(
  value: Record<string, unknown>,
  index: number,
): ContractDraftUserFlowStep {
  const location = `flowStep[${index}]`;
  return {
    order: integerField(value, "order", location),
    statement: stringField(value, "statement", location),
    evidenceNodeIds: evidenceNodeIds(value, location),
  };
}

function requirementDraft(
  value: Record<string, unknown>,
  index: number,
): ContractDraftRequirement {
  const location = `requirements[${index}]`;
  return {
    id: stringField(value, "id", location),
    category: stringField(value, "category", location) as ContractDraftRequirement["category"],
    statement: stringField(value, "statement", location),
    evidenceNodeIds: evidenceNodeIds(value, location),
  };
}

function uncertaintyDraft(
  value: Record<string, unknown>,
  index: number,
): ContractDraftUncertainty {
  const location = `uncertainties[${index}]`;
  return {
    id: stringField(value, "id", location),
    statement: stringField(value, "statement", location),
    reason: stringField(value, "reason", location),
    evidenceNodeIds: evidenceNodeIds(value, location),
  };
}

function evidenceNodeIds(
  record: Record<string, unknown>,
  location: string,
): string[] {
  return objectArrayField(record, "evidence", location).map(
    (evidence, index) =>
      stringField(evidence, "nodeId", `${location}.evidence[${index}]`),
  );
}

function recordField(
  record: Record<string, unknown>,
  field: string,
  location: string,
): Record<string, unknown> {
  const value = record[field];
  if (!isRecord(value)) {
    throw new Error(`Invalid software contract: ${location}.${field} must be an object`);
  }
  return value;
}

function objectArrayField(
  record: Record<string, unknown>,
  field: string,
  location: string,
): Array<Record<string, unknown>> {
  const value = record[field];
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    throw new Error(
      `Invalid software contract: ${location}.${field} must be an array of objects`,
    );
  }
  return value;
}

function stringArrayField(
  record: Record<string, unknown>,
  field: string,
  location: string,
): string[] {
  const value = record[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(
      `Invalid software contract: ${location}.${field} must be an array of strings`,
    );
  }
  return value;
}

function stringField(
  record: Record<string, unknown>,
  field: string,
  location: string,
): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(
      `Invalid software contract: ${location}.${field} must be a string`,
    );
  }
  return value;
}

function integerField(
  record: Record<string, unknown>,
  field: string,
  location: string,
): number {
  const value = record[field];
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `Invalid software contract: ${location}.${field} must be a safe integer`,
    );
  }
  return value as number;
}

function booleanField(
  record: Record<string, unknown>,
  field: string,
  location: string,
): boolean {
  const value = record[field];
  if (typeof value !== "boolean") {
    throw new Error(
      `Invalid software contract: ${location}.${field} must be a boolean`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
