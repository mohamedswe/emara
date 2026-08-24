import type {
  DeadCodeVerdict,
  FeatureAuditStatus,
  FunctionalityAudit,
} from "./types.js";

export interface FunctionalityAuditOracle {
  schema: "functionality-oracle/v1";
  target: string;
  repositoryCommit: string;
  coverage: {
    recognizedEntrypoints: number;
    minimumDocumentationPromises: number;
    requiredDocumentationPatterns: string[];
  };
  requiredFeatures: Array<{
    key: string;
    acceptableIds: string[];
    titlePatterns?: string[];
    documentationPatterns?: string[];
    implementationNodePatterns?: string[];
    entrypointPatterns?: string[];
    allowedStatuses: FeatureAuditStatus[];
    reason: string;
  }>;
  requiredDeadCode: Array<{
    key: string;
    file: string;
    symbol: string;
    allowedVerdicts: DeadCodeVerdict[];
  }>;
  forbiddenDocumentationMappings?: Array<{
    key: string;
    featurePatterns: string[];
    documentationPatterns: string[];
    reason: string;
  }>;
  performanceBudgets: {
    deterministicColdWallClockMs: number;
    assistedColdWallClockMs: number;
    maximumModelRequests: number;
  };
}

export interface OracleEvaluation {
  passed: boolean;
  failures: string[];
}

export function validateFunctionalityAuditOracle(
  oracle: FunctionalityAuditOracle,
): void {
  const issues: string[] = [];
  if (oracle.schema !== "functionality-oracle/v1") {
    issues.push("schema must be functionality-oracle/v1");
  }
  if (oracle.repositoryCommit.trim().length === 0) {
    issues.push("repositoryCommit must not be empty");
  }
  validateUniqueKeys(oracle.requiredFeatures, "requiredFeatures", issues);
  validateUniqueKeys(oracle.requiredDeadCode, "requiredDeadCode", issues);
  validateUniqueKeys(
    oracle.forbiddenDocumentationMappings ?? [],
    "forbiddenDocumentationMappings",
    issues,
  );
  for (const feature of oracle.requiredFeatures) {
    if (
      feature.acceptableIds.length === 0 &&
      (feature.titlePatterns === undefined || feature.titlePatterns.length === 0)
    ) {
      issues.push(`required feature ${JSON.stringify(feature.key)} needs an acceptable ID or title pattern`);
    }
    if (feature.allowedStatuses.length === 0) {
      issues.push(`required feature ${JSON.stringify(feature.key)} needs an allowed status`);
    }
  }
  for (const [key, value] of Object.entries(oracle.performanceBudgets)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      issues.push(`performanceBudgets.${key} must be a non-negative safe integer`);
    }
  }
  for (const mapping of oracle.forbiddenDocumentationMappings ?? []) {
    if (mapping.featurePatterns.length === 0) {
      issues.push(`forbidden mapping ${JSON.stringify(mapping.key)} needs featurePatterns`);
    }
    if (mapping.documentationPatterns.length === 0) {
      issues.push(`forbidden mapping ${JSON.stringify(mapping.key)} needs documentationPatterns`);
    }
  }
  if (issues.length > 0) {
    throw new Error(`Invalid functionality oracle: ${issues.join("; ")}`);
  }
}

export function evaluateAuditAgainstOracle(
  audit: FunctionalityAudit,
  oracle: FunctionalityAuditOracle,
): OracleEvaluation {
  validateFunctionalityAuditOracle(oracle);
  const failures: string[] = [];
  if (audit.repositoryCommit !== oracle.repositoryCommit) {
    failures.push(
      `repository commit ${audit.repositoryCommit} does not match ${oracle.repositoryCommit}`,
    );
  }
  if (
    audit.coverage.recognizedEntrypointIds.length !==
      oracle.coverage.recognizedEntrypoints
  ) {
    failures.push(
      `recognized ${audit.coverage.recognizedEntrypointIds.length} entrypoints; expected ${oracle.coverage.recognizedEntrypoints}`,
    );
  }
  if (
    audit.documentationPromises.length <
      oracle.coverage.minimumDocumentationPromises
  ) {
    failures.push(
      `recognized ${audit.documentationPromises.length} documentation promises; expected at least ${oracle.coverage.minimumDocumentationPromises}`,
    );
  }
  for (const pattern of oracle.coverage.requiredDocumentationPatterns) {
    const expression = new RegExp(pattern, "iu");
    if (!audit.documentationPromises.some((promise) => expression.test(promise.text))) {
      failures.push(`missing required documentation promise matching ${JSON.stringify(pattern)}`);
    }
  }
  for (const expected of oracle.requiredFeatures) {
    const actual = audit.features.find((feature) =>
      featureMatchesOracle(feature, audit, expected)
    );
    if (actual === undefined) {
      failures.push(`missing required feature ${expected.key}`);
    } else if (!expected.allowedStatuses.includes(actual.status)) {
      failures.push(
        `feature ${expected.key} has status ${actual.status}; expected ${expected.allowedStatuses.join(" or ")}`,
      );
    }
  }
  for (const expected of oracle.requiredDeadCode) {
    const actual = audit.deadCodeCandidates.find(
      (candidate) =>
        candidate.file === expected.file && candidate.symbol === expected.symbol,
    );
    if (actual === undefined) {
      failures.push(`missing required dead-code candidate ${expected.key}`);
    } else if (!expected.allowedVerdicts.includes(actual.verdict)) {
      failures.push(
        `dead-code candidate ${expected.key} has verdict ${actual.verdict}; expected ${expected.allowedVerdicts.join(" or ")}`,
      );
    }
  }
  for (const forbidden of oracle.forbiddenDocumentationMappings ?? []) {
    const offendingFeature = audit.features.find((feature) => {
      const featureText = `${feature.id} ${feature.title}`;
      if (
        !forbidden.featurePatterns.some((pattern) =>
          new RegExp(pattern, "iu").test(featureText)
        )
      ) {
        return false;
      }
      return feature.documentationPromiseIds.some((promiseId) => {
        const promiseText = audit.documentationPromises.find(
          (promise) => promise.id === promiseId,
        )?.text ?? "";
        return forbidden.documentationPatterns.some((pattern) =>
          new RegExp(pattern, "iu").test(promiseText)
        );
      });
    });
    if (offendingFeature !== undefined) {
      failures.push(
        `forbidden documentation mapping ${forbidden.key} appears on feature ${offendingFeature.id}`,
      );
    }
  }
  const assisted = audit.metrics.modelRequests > 0;
  const wallClockBudget = assisted
    ? oracle.performanceBudgets.assistedColdWallClockMs
    : oracle.performanceBudgets.deterministicColdWallClockMs;
  if (audit.metrics.cache === "cold" && audit.metrics.wallClockMs > wallClockBudget) {
    failures.push(
      `cold wall clock ${audit.metrics.wallClockMs}ms exceeds ${wallClockBudget}ms budget`,
    );
  }
  if (
    audit.metrics.modelRequests >
      oracle.performanceBudgets.maximumModelRequests
  ) {
    failures.push(
      `${audit.metrics.modelRequests} model requests exceeds ${oracle.performanceBudgets.maximumModelRequests} request budget`,
    );
  }
  return { passed: failures.length === 0, failures };
}

function featureMatchesOracle(
  feature: FunctionalityAudit["features"][number],
  audit: FunctionalityAudit,
  expected: FunctionalityAuditOracle["requiredFeatures"][number],
): boolean {
  const identityMatch =
    expected.acceptableIds.includes(feature.id) ||
    (expected.titlePatterns ?? []).some((pattern) =>
      new RegExp(pattern, "iu").test(feature.title)
    );
  const evidenceGroups = [
    expected.documentationPatterns === undefined
      ? undefined
      : expected.documentationPatterns.every((pattern) => {
          const expression = new RegExp(pattern, "iu");
          return feature.documentationPromiseIds.some((promiseId) =>
            expression.test(
              audit.documentationPromises.find((promise) => promise.id === promiseId)?.text ?? "",
            )
          );
        }),
    expected.implementationNodePatterns === undefined
      ? undefined
      : expected.implementationNodePatterns.every((pattern) => {
          const expression = new RegExp(pattern, "iu");
          return feature.implementationNodeIds.some((nodeId) => expression.test(nodeId));
        }),
    expected.entrypointPatterns === undefined
      ? undefined
      : expected.entrypointPatterns.every((pattern) => {
          const expression = new RegExp(pattern, "iu");
          return feature.entrypointNodeIds.some((nodeId) => expression.test(nodeId));
        }),
  ].filter((value): value is boolean => value !== undefined);
  return identityMatch || (evidenceGroups.length > 0 && evidenceGroups.every(Boolean));
}

function validateUniqueKeys(
  values: readonly { key: string }[],
  label: string,
  issues: string[],
): void {
  const keys = new Set<string>();
  for (const value of values) {
    if (value.key.trim().length === 0) issues.push(`${label} contains an empty key`);
    if (keys.has(value.key)) issues.push(`${label} contains duplicate key ${JSON.stringify(value.key)}`);
    keys.add(value.key);
  }
}
