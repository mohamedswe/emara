import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveFunctionalityAuditSummary,
  validateFunctionalityAudit,
} from "./validateFunctionalityAudit.ts";

test("derives summary counts and rejects supplied count drift", () => {
  const audit = validAudit();
  audit.summary = deriveFunctionalityAuditSummary(audit);
  assert.doesNotThrow(() => validateFunctionalityAudit(audit));

  audit.summary.implemented_documented += 2;
  assert.throws(
    () => validateFunctionalityAudit(audit),
    /summary\.implemented_documented.*derived value/,
  );
});

test("requires deletion validation evidence before declaring code safe", () => {
  const audit = validAudit();
  audit.deadCodeCandidates[0].verdict = "VALIDATED_SAFE_TO_DELETE";
  audit.summary = deriveFunctionalityAuditSummary(audit);
  assert.throws(
    () => validateFunctionalityAudit(audit),
    /cannot be VALIDATED_SAFE_TO_DELETE/,
  );

  audit.deadCodeCandidates[0].validation = {
    passed: true,
    commands: ["npm test"],
    featureFingerprintUnchanged: true,
  };
  assert.doesNotThrow(() => validateFunctionalityAudit(audit));
});

test("requires every recognized entrypoint and documentation promise to be accounted", () => {
  const audit = validAudit();
  audit.coverage.entrypointFeatureMap = {};
  audit.summary = deriveFunctionalityAuditSummary(audit);
  assert.throws(
    () => validateFunctionalityAudit(audit),
    /neither mapped nor unclassified/,
  );
});

test("rejects contradictory implemented-documentation status and model-owned identity", () => {
  const audit = validAudit();
  audit.features[0].gaps = ["No Redis or Celery worker is implemented."];
  audit.features[0].canonicalId = "auth";
  audit.summary = deriveFunctionalityAuditSummary(audit);
  assert.throws(
    () => validateFunctionalityAudit(audit),
    /invalid deterministic canonicalId.*cannot be IMPLEMENTED_DOCUMENTED/su,
  );
});

test("requires quarantined claims to equal the unclassified promise partition", () => {
  const audit = validAudit();
  audit.features[0].status = "IMPLEMENTED_UNDOCUMENTED";
  audit.features[0].documentationPromiseIds = [];
  audit.documentationPromises[0].featureIds = [];
  audit.coverage.documentationFeatureMap = {};
  audit.coverage.unclassifiedDocumentationPromiseIds = ["promise:auth"];
  audit.declaredClaims = [{
    documentationPromiseId: "promise:auth",
    text: "Users can sign in.",
    evidenceNodeId: "file:README.md",
    quarantineReason: "NO_DETERMINISTIC_FEATURE_MATCH",
  }];
  audit.summary = deriveFunctionalityAuditSummary(audit);
  assert.doesNotThrow(() => validateFunctionalityAudit(audit));

  audit.declaredClaims = [];
  assert.throws(
    () => validateFunctionalityAudit(audit),
    /declaredClaims must exactly match/,
  );
});

function validAudit() {
  const audit = {
    schema: "functionality-audit/v2",
    repositoryCommit: "abc123",
    summary: {},
    features: [{
      canonicalId: "feature-0123456789abcdefabcd",
      id: "auth",
      title: "Authentication",
      kind: "functional",
      status: "IMPLEMENTED_DOCUMENTED",
      entrypointNodeIds: ["entrypoint:login"],
      implementationNodeIds: ["function:login"],
      documentationPromiseIds: ["promise:auth"],
      gaps: [],
      confidence: "HIGH",
    }],
    documentationPromises: [{
      id: "promise:auth",
      text: "Users can sign in.",
      evidenceNodeId: "file:README.md",
      featureIds: ["auth"],
    }],
    declaredClaims: [],
    featureSourceDisagreements: [],
    deadCodeCandidates: [{
      id: "dead:unused",
      nodeIds: ["function:unused"],
      file: "src/unused.ts",
      line: 7,
      symbol: "unused",
      reachabilityStatus: "disconnected_candidate",
      verdict: "VALIDATION_REQUIRED",
      reason: "No production path.",
      blockers: ["Run tests."],
      validation: null,
    }],
    coverage: {
      recognizedEntrypointIds: ["entrypoint:login"],
      entrypointFeatureMap: { "entrypoint:login": ["auth"] },
      unclassifiedEntrypointIds: [],
      documentationPromiseIds: ["promise:auth"],
      documentationFeatureMap: { "promise:auth": ["auth"] },
      unclassifiedDocumentationPromiseIds: [],
      productionReachabilityCounts: {
        product_reachable: 2,
        startup_reachable: 0,
        test_only: 0,
        public_api_unproven: 0,
        dynamic_unknown: 0,
        disconnected_candidate: 1,
      },
    },
    metrics: {
      wallClockMs: 10,
      deterministicWallClockMs: 10,
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
