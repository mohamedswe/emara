import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  evaluateAuditAgainstOracle,
  validateFunctionalityAuditOracle,
} from "./oracle.ts";
import { deriveFunctionalityAuditSummary } from "./validateFunctionalityAudit.ts";

test("pins the AI Tutor functionality and performance oracle", async () => {
  const path = new URL("../../bench/oracles/ai-tutor.v1.json", import.meta.url);
  const oracle = JSON.parse(await readFile(path, "utf8"));
  assert.doesNotThrow(() => validateFunctionalityAuditOracle(oracle));
  assert.equal(oracle.repositoryCommit, "14d1fdbebb381ba7ccdf94bb6c63611af437a870");
  assert.equal(oracle.coverage.recognizedEntrypoints, 21);
  assert.equal(oracle.coverage.minimumDocumentationPromises, 26);
  assert.ok(
    oracle.coverage.requiredDocumentationPatterns.includes(
      "Parse other document formats",
    ),
  );
  assert.equal(oracle.performanceBudgets.maximumModelRequests, 2);
  assert.ok(
    oracle.requiredFeatures.some(
      (feature) =>
        feature.key === "email-confirmation-callback" &&
        feature.allowedStatuses.includes("IMPLEMENTED_DOCUMENTED"),
    ),
  );
  assert.ok(
    oracle.requiredDeadCode.some(
      (candidate) => candidate.file.endsWith("FileUpload.tsx"),
    ),
  );
  assert.equal(oracle.forbiddenDocumentationMappings.length, 2);
});

test("reports missing ground-truth findings and performance regressions", async () => {
  const path = new URL("../../bench/oracles/ai-tutor.v1.json", import.meta.url);
  const oracle = JSON.parse(await readFile(path, "utf8"));
  const audit = emptyAudit(oracle.repositoryCommit);
  const result = evaluateAuditAgainstOracle(audit, oracle);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => /missing required feature/.test(failure)));
  assert.ok(result.failures.some((failure) => /exceeds 10000ms budget/.test(failure)));
});

test("rejects structurally descriptive text mapped as feature documentation", async () => {
  const path = new URL("../../bench/oracles/ai-tutor.v1.json", import.meta.url);
  const oracle = JSON.parse(await readFile(path, "utf8"));
  const audit = emptyAudit(oracle.repositoryCommit);
  audit.features = [{
    canonicalId: "feature-0123456789abcdefabcd",
    id: "frontend-layout",
    title: "Frontend root layout",
    kind: "functional",
    status: "IMPLEMENTED_DOCUMENTED",
    entrypointNodeIds: ["entrypoint:layout"],
    implementationNodeIds: ["component:layout"],
    documentationPromiseIds: ["promise:wrapper"],
    gaps: [],
    confidence: "HIGH",
  }];
  audit.documentationPromises = [{
    id: "promise:wrapper",
    text: "API client wrapper.",
    evidenceNodeId: "file:README.md",
    featureIds: ["frontend-layout"],
  }];
  audit.summary = deriveFunctionalityAuditSummary(audit);

  const result = evaluateAuditAgainstOracle(audit, oracle);
  assert.ok(
    result.failures.some((failure) =>
      /forbidden documentation mapping layout-is-not-api-wrapper/u.test(failure)
    ),
  );
});

function emptyAudit(repositoryCommit) {
  const audit = {
    schema: "functionality-audit/v2",
    repositoryCommit,
    summary: {},
    features: [],
    documentationPromises: [],
    declaredClaims: [],
    featureSourceDisagreements: [],
    deadCodeCandidates: [],
    coverage: {
      recognizedEntrypointIds: [],
      entrypointFeatureMap: {},
      unclassifiedEntrypointIds: [],
      documentationPromiseIds: [],
      documentationFeatureMap: {},
      unclassifiedDocumentationPromiseIds: [],
      productionReachabilityCounts: {
        product_reachable: 0,
        startup_reachable: 0,
        test_only: 0,
        public_api_unproven: 0,
        dynamic_unknown: 0,
        disconnected_candidate: 0,
      },
    },
    metrics: {
      wallClockMs: 10001,
      deterministicWallClockMs: 10001,
      modelRequests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cache: "cold",
    },
    limitations: [],
  };
  audit.summary = deriveFunctionalityAuditSummary(audit);
  return audit;
}
