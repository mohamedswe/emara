import type {
  DeadCodeCandidate,
  FeatureAuditStatus,
  FunctionalityAudit,
  FunctionalityAuditSummary,
} from "./types.js";

const FEATURE_STATUSES = new Set<FeatureAuditStatus>([
  "IMPLEMENTED_DOCUMENTED",
  "IMPLEMENTED_UNDOCUMENTED",
  "DOCUMENTED_NOT_IMPLEMENTED",
  "PARTIALLY_IMPLEMENTED",
  "AMBIGUOUS",
]);
const CANONICAL_FEATURE_ID = /^feature-[a-f0-9]{20}(?:-\d+)?$/u;
const MATERIAL_ABSENCE_SIGNAL =
  /\b(?:absent|missing|no\s+\w+|not implemented|unsupported|without)\b/iu;

export function deriveFunctionalityAuditSummary(
  audit: Pick<FunctionalityAudit, "features" | "deadCodeCandidates">,
): FunctionalityAuditSummary {
  const result: FunctionalityAuditSummary = {
    implemented_documented: 0,
    implemented_undocumented: 0,
    documented_not_implemented: 0,
    partially_implemented: 0,
    ambiguous: 0,
    dead_code_candidates: audit.deadCodeCandidates.length,
    ready_for_delete_validation: 0,
    validated_safe_to_delete: 0,
  };
  for (const feature of audit.features) {
    switch (feature.status) {
      case "IMPLEMENTED_DOCUMENTED":
        result.implemented_documented += 1;
        break;
      case "IMPLEMENTED_UNDOCUMENTED":
        result.implemented_undocumented += 1;
        break;
      case "DOCUMENTED_NOT_IMPLEMENTED":
        result.documented_not_implemented += 1;
        break;
      case "PARTIALLY_IMPLEMENTED":
        result.partially_implemented += 1;
        break;
      case "AMBIGUOUS":
        result.ambiguous += 1;
        break;
    }
  }
  for (const candidate of audit.deadCodeCandidates) {
    if (candidate.verdict === "VALIDATION_REQUIRED") {
      result.ready_for_delete_validation += 1;
    }
    if (candidate.verdict === "VALIDATED_SAFE_TO_DELETE") {
      result.validated_safe_to_delete += 1;
    }
  }
  return result;
}

export function validateFunctionalityAudit(audit: FunctionalityAudit): void {
  const issues: string[] = [];
  if (audit.schema !== "functionality-audit/v2") {
    issues.push("schema must be functionality-audit/v2");
  }
  if (audit.repositoryCommit.trim().length === 0) {
    issues.push("repositoryCommit must not be empty");
  }
  validateUniqueIds(audit.features, "features", issues);
  validateCanonicalFeatureIds(audit.features, issues);
  validateUniqueIds(audit.documentationPromises, "documentationPromises", issues);
  validateUniqueIds(audit.deadCodeCandidates, "deadCodeCandidates", issues);

  const featureIds = new Set(audit.features.map((feature) => feature.id));
  const promiseIds = new Set(
    audit.documentationPromises.map((promise) => promise.id),
  );
  const promisesById = new Map(
    audit.documentationPromises.map((promise) => [promise.id, promise]),
  );
  for (const feature of audit.features) {
    if (!FEATURE_STATUSES.has(feature.status)) {
      issues.push(`feature ${JSON.stringify(feature.id)} has invalid status`);
    }
    for (const promiseId of feature.documentationPromiseIds) {
      if (!promiseIds.has(promiseId)) {
        issues.push(
          `feature ${JSON.stringify(feature.id)} references missing documentation promise ${JSON.stringify(promiseId)}`,
        );
      }
    }
    validateFeatureStatusEvidence(feature, issues);
  }
  for (const promise of audit.documentationPromises) {
    for (const featureId of promise.featureIds) {
      if (!featureIds.has(featureId)) {
        issues.push(
          `documentation promise ${JSON.stringify(promise.id)} references missing feature ${JSON.stringify(featureId)}`,
        );
      }
    }
  }
  const structuralComponentIds = new Set<string>();
  for (const disagreement of audit.featureSourceDisagreements) {
    if (structuralComponentIds.has(disagreement.structuralComponentId)) {
      issues.push(
        `featureSourceDisagreements contains duplicate structural component ${JSON.stringify(disagreement.structuralComponentId)}`,
      );
    }
    structuralComponentIds.add(disagreement.structuralComponentId);
    if (
      disagreement.structuralFeatureId !== null &&
      !featureIds.has(disagreement.structuralFeatureId)
    ) {
      issues.push(
        `feature-source disagreement references missing structural feature ${JSON.stringify(disagreement.structuralFeatureId)}`,
      );
    }
    for (const featureId of disagreement.entrypointFeatureIds) {
      if (!featureIds.has(featureId)) {
        issues.push(
          `feature-source disagreement references missing entrypoint feature ${JSON.stringify(featureId)}`,
        );
      }
    }
    if (
      !Number.isSafeInteger(disagreement.structuralFileCount) ||
      disagreement.structuralFileCount <= 0 ||
      disagreement.overlapFileNodeIds.length > disagreement.structuralFileCount
    ) {
      issues.push(
        `feature-source disagreement ${JSON.stringify(disagreement.structuralComponentId)} has invalid file counts`,
      );
    }
    if (
      disagreement.resolution === "ENTRYPOINT_SLICES_RETAINED" &&
      disagreement.structuralFeatureId !== null
    ) {
      issues.push(
        `deduplicated structural component ${JSON.stringify(disagreement.structuralComponentId)} must not retain a structural feature`,
      );
    }
    if (
      disagreement.resolution === "BOTH_SOURCES_RETAINED" &&
      disagreement.structuralFeatureId === null
    ) {
      issues.push(
        `retained structural component ${JSON.stringify(disagreement.structuralComponentId)} must reference its feature`,
      );
    }
  }
  const declaredClaimPromiseIds = new Set<string>();
  for (const claim of audit.declaredClaims) {
    if (declaredClaimPromiseIds.has(claim.documentationPromiseId)) {
      issues.push(
        `declaredClaims contains duplicate documentation promise ${JSON.stringify(claim.documentationPromiseId)}`,
      );
    }
    declaredClaimPromiseIds.add(claim.documentationPromiseId);
    const promise = promisesById.get(claim.documentationPromiseId);
    if (promise === undefined) {
      issues.push(
        `declared claim references missing documentation promise ${JSON.stringify(claim.documentationPromiseId)}`,
      );
      continue;
    }
    if (promise.featureIds.length > 0) {
      issues.push(
        `declared claim ${JSON.stringify(claim.documentationPromiseId)} must not reference a mapped documentation promise`,
      );
    }
    if (claim.text !== promise.text || claim.evidenceNodeId !== promise.evidenceNodeId) {
      issues.push(
        `declared claim ${JSON.stringify(claim.documentationPromiseId)} must preserve its documentation evidence`,
      );
    }
    if (claim.quarantineReason !== "NO_DETERMINISTIC_FEATURE_MATCH") {
      issues.push(
        `declared claim ${JSON.stringify(claim.documentationPromiseId)} has invalid quarantineReason`,
      );
    }
  }

  validateCoveragePartition(
    audit.coverage.recognizedEntrypointIds,
    audit.coverage.entrypointFeatureMap,
    audit.coverage.unclassifiedEntrypointIds,
    featureIds,
    "entrypoint",
    issues,
  );
  validateCoveragePartition(
    audit.coverage.documentationPromiseIds,
    audit.coverage.documentationFeatureMap,
    audit.coverage.unclassifiedDocumentationPromiseIds,
    featureIds,
    "documentation promise",
    issues,
  );
  if (!sameSet(audit.coverage.documentationPromiseIds, [...promiseIds])) {
    issues.push(
      "coverage.documentationPromiseIds must exactly match documentationPromises",
    );
  }
  if (
    !sameSet(
      audit.coverage.unclassifiedDocumentationPromiseIds,
      [...declaredClaimPromiseIds],
    )
  ) {
    issues.push(
      "declaredClaims must exactly match unclassified documentation promises",
    );
  }

  const derived = deriveFunctionalityAuditSummary(audit);
  for (const key of Object.keys(derived) as Array<keyof FunctionalityAuditSummary>) {
    if (audit.summary[key] !== derived[key]) {
      issues.push(
        `summary.${key} is ${audit.summary[key]} but derived value is ${derived[key]}`,
      );
    }
  }
  for (const candidate of audit.deadCodeCandidates) {
    if (!Number.isSafeInteger(candidate.line) || candidate.line <= 0) {
      issues.push(
        `dead-code candidate ${JSON.stringify(candidate.id)} has invalid source line`,
      );
    }
    validateDeletionEvidence(candidate, issues);
  }
  const metrics = audit.metrics;
  for (const [name, value] of Object.entries(metrics)) {
    if (name === "cache") continue;
    if (!Number.isSafeInteger(value) || value < 0) {
      issues.push(`metrics.${name} must be a non-negative safe integer`);
    }
  }
  if (metrics.totalTokens !== metrics.promptTokens + metrics.completionTokens) {
    issues.push("metrics.totalTokens must equal promptTokens + completionTokens");
  }

  if (issues.length > 0) {
    throw new Error(`Invalid functionality audit: ${issues.join("; ")}`);
  }
}

function validateCanonicalFeatureIds(
  features: FunctionalityAudit["features"],
  issues: string[],
): void {
  const ids = new Set<string>();
  for (const feature of features) {
    if (
      typeof feature.canonicalId !== "string" ||
      !CANONICAL_FEATURE_ID.test(feature.canonicalId)
    ) {
      issues.push(
        `feature ${JSON.stringify(feature.id)} has invalid deterministic canonicalId`,
      );
      continue;
    }
    if (ids.has(feature.canonicalId)) {
      issues.push(`features contain duplicate canonicalId ${JSON.stringify(feature.canonicalId)}`);
    }
    ids.add(feature.canonicalId);
  }
}

function validateFeatureStatusEvidence(
  feature: FunctionalityAudit["features"][number],
  issues: string[],
): void {
  const hasImplementation =
    feature.entrypointNodeIds.length > 0 || feature.implementationNodeIds.length > 0;
  const hasDocumentation = feature.documentationPromiseIds.length > 0;
  if (
    (feature.status === "IMPLEMENTED_DOCUMENTED" ||
      feature.status === "PARTIALLY_IMPLEMENTED") &&
    (!hasImplementation || !hasDocumentation)
  ) {
    issues.push(
      `feature ${JSON.stringify(feature.id)} status ${feature.status} requires implementation and documentation evidence`,
    );
  }
  if (
    feature.status === "IMPLEMENTED_UNDOCUMENTED" &&
    (!hasImplementation || hasDocumentation)
  ) {
    issues.push(
      `feature ${JSON.stringify(feature.id)} status IMPLEMENTED_UNDOCUMENTED requires implementation and no documentation promises`,
    );
  }
  if (
    feature.status === "DOCUMENTED_NOT_IMPLEMENTED" &&
    (!hasDocumentation || hasImplementation)
  ) {
    issues.push(
      `feature ${JSON.stringify(feature.id)} status DOCUMENTED_NOT_IMPLEMENTED requires documentation and no implementation evidence`,
    );
  }
  if (
    feature.status === "IMPLEMENTED_DOCUMENTED" &&
    feature.gaps.some((gap) => MATERIAL_ABSENCE_SIGNAL.test(gap))
  ) {
    issues.push(
      `feature ${JSON.stringify(feature.id)} cannot be IMPLEMENTED_DOCUMENTED while a material promised behavior is absent`,
    );
  }
}

function validateDeletionEvidence(
  candidate: DeadCodeCandidate,
  issues: string[],
): void {
  if (candidate.verdict !== "VALIDATED_SAFE_TO_DELETE") return;
  if (
    candidate.validation === null ||
    !candidate.validation.passed ||
    candidate.validation.commands.length === 0 ||
    !candidate.validation.featureFingerprintUnchanged
  ) {
    issues.push(
      `dead-code candidate ${JSON.stringify(candidate.id)} cannot be VALIDATED_SAFE_TO_DELETE without passing commands and an unchanged feature fingerprint`,
    );
  }
}

function validateCoveragePartition(
  recognizedIds: readonly string[],
  mapping: Readonly<Record<string, string[]>>,
  unclassifiedIds: readonly string[],
  featureIds: ReadonlySet<string>,
  label: string,
  issues: string[],
): void {
  const recognized = new Set(recognizedIds);
  if (recognized.size !== recognizedIds.length) {
    issues.push(`recognized ${label} IDs contain duplicates`);
  }
  const unclassified = new Set(unclassifiedIds);
  for (const id of unclassified) {
    if (!recognized.has(id)) issues.push(`unrecognized ${label} ${JSON.stringify(id)} is marked unclassified`);
    if (Object.hasOwn(mapping, id)) issues.push(`${label} ${JSON.stringify(id)} is both mapped and unclassified`);
  }
  for (const [id, mappedFeatureIds] of Object.entries(mapping)) {
    if (!recognized.has(id)) issues.push(`mapping contains unrecognized ${label} ${JSON.stringify(id)}`);
    if (mappedFeatureIds.length === 0) issues.push(`mapped ${label} ${JSON.stringify(id)} has no feature IDs`);
    for (const featureId of mappedFeatureIds) {
      if (!featureIds.has(featureId)) {
        issues.push(`${label} ${JSON.stringify(id)} maps to missing feature ${JSON.stringify(featureId)}`);
      }
    }
  }
  for (const id of recognized) {
    if (!Object.hasOwn(mapping, id) && !unclassified.has(id)) {
      issues.push(`recognized ${label} ${JSON.stringify(id)} is neither mapped nor unclassified`);
    }
  }
}

function validateUniqueIds(
  values: readonly { id: string }[],
  label: string,
  issues: string[],
): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (value.id.trim().length === 0) issues.push(`${label} contains an empty ID`);
    if (ids.has(value.id)) issues.push(`${label} contains duplicate ID ${JSON.stringify(value.id)}`);
    ids.add(value.id);
  }
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value));
}
