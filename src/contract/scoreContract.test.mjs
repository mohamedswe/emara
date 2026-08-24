import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreContract } from "./scoreContract.ts";

function baseContract(overrides = {}) {
  return {
    version: 4,
    repository: {
      graphVersion: 4,
      graphHash: "x",
      fileCount: 1,
      symbolCount: 1,
      entrypointCount: 1,
      sourceFileCount: 1,
      parsedSourceFileCount: 1,
      unparsedSourceFiles: [],
      graphDiagnostics: 0,
    },
    discovery: {
      provider: "deepseek",
      model: "m",
      toolCallCount: 0,
      reviewTurnCount: 0,
      coverageInvestigationTurnCount: 0,
      correctionRoundCount: 0,
      correctionTurnCount: 0,
      correctionConverged: true,
      completedStages: [],
      inspectedNodeIds: [],
    },
    acceptance: { status: "STATICALLY_VERIFIED", runtimeVerificationPerformed: false, failures: [] },
    entrypoints: [],
    featureDossiers: [],
    contradictionReviews: [],
    coverageReview: {
      meaningfulNodes: 100,
      explainedMeaningfulNodes: 100,
      supportAccountedMeaningfulNodes: 0,
      accountedMeaningfulNodes: 100,
      unexplainedMeaningfulNodes: 0,
      unaccountedMeaningfulNodes: 0,
      coveragePercent: 100,
      classificationCounts: {},
      unexplained: [],
      unaccounted: [],
      suspiciousUnknowns: [],
      investigations: [],
      remainingUnknownNodeIds: [],
    },
    capabilities: [],
    userFlows: [],
    requirements: [],
    declaredClaims: [],
    uncertainties: [],
    ...overrides,
  };
}

function verifiedCapability(id) {
  return {
    id,
    dossierId: "d",
    title: id,
    description: "",
    entrypointNodeIds: [],
    evidence: [],
    confidence: "PROVEN",
    verification: { status: "STATIC_VERIFIED", evidenceRoles: ["implementation"], runtimeVerified: false },
  };
}

test("a fully-verified, fully-covered contract scores near 100", () => {
  const contract = baseContract({
    capabilities: [verifiedCapability("a"), verifiedCapability("b")],
  });
  const result = scoreContract(contract);
  assert.ok(result.score >= 99, `expected near-perfect score, got ${result.score}`);
  assert.equal(result.grade, "A");
  assert.equal(result.subscores.coverage, 1);
  assert.equal(result.subscores.verification, 1);
});

test("coverage gap is the heaviest deduction", () => {
  // 60% coverage, everything else perfect.
  const contract = baseContract({
    capabilities: [verifiedCapability("a")],
    coverageReview: {
      ...baseContract().coverageReview,
      meaningfulNodes: 100,
      explainedMeaningfulNodes: 60,
      accountedMeaningfulNodes: 60,
      unexplainedMeaningfulNodes: 40,
      unaccountedMeaningfulNodes: 40,
      coveragePercent: 60,
      unexplained: [{ nodeId: "n1", nodeType: "function", exported: true, file: "a.ts", lineRange: null, classification: "feature", reachability: "reachable", reason: "", explainedByContractIds: [] }],
      unaccounted: [{ nodeId: "n1", nodeType: "function", exported: true, file: "a.ts", lineRange: null, classification: "feature", reachability: "reachable", reason: "", explainedByContractIds: [] }],
    },
  });
  const result = scoreContract(contract);
  // coverage weight 0.4 * 40% gap = 16 points lost from coverage alone.
  assert.ok(result.subscores.coverage === 0.6);
  const covDeduction = result.deductions.find((d) => d.code === "unexplained_coverage");
  assert.ok(covDeduction, "expected a coverage deduction");
  assert.ok(covDeduction.points >= 15, `coverage deduction should be ~16, got ${covDeduction.points}`);
});

test("contradicted claims cost more than partial ones", () => {
  const contradicted = scoreContract(baseContract({
    capabilities: [{
      ...verifiedCapability("bad"),
      verification: { status: "CONTRADICTED", evidenceRoles: [], runtimeVerified: false },
    }],
  }));
  const partial = scoreContract(baseContract({
    capabilities: [{
      ...verifiedCapability("weak"),
      verification: { status: "PARTIALLY_VERIFIED", evidenceRoles: [], runtimeVerified: false },
    }],
  }));
  assert.ok(contradicted.score < partial.score, "contradiction should score lower than partial");
});

test("non-converged correction applies a flat penalty", () => {
  const converged = scoreContract(baseContract({ capabilities: [verifiedCapability("a")] }));
  const notConverged = scoreContract(baseContract({
    capabilities: [verifiedCapability("a")],
    discovery: { ...baseContract().discovery, correctionConverged: false },
  }));
  assert.ok(notConverged.score < converged.score);
  assert.ok(converged.score - notConverged.score >= 5);
});

test("suggestions are emitted and sorted by points recovered", () => {
  const contract = baseContract({
    capabilities: [verifiedCapability("a")],
    uncertainties: [{
      id: "u1",
      statement: "API spec documents POST /x but no such route exists",
      reason: "missing",
      evidence: [],
      confidence: "UNKNOWN",
      verification: { status: "UNRESOLVED", evidenceRoles: [], runtimeVerified: false },
    }],
  });
  const result = scoreContract(contract);
  assert.ok(result.suggestions.length > 0, "expected suggestions");
  for (let i = 1; i < result.suggestions.length; i += 1) {
    assert.ok(result.suggestions[i - 1].pointsRecovered >= result.suggestions[i].pointsRecovered);
  }
});
