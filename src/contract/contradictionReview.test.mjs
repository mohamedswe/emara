import assert from "node:assert/strict";
import { test } from "node:test";

import {
  runContradictionReview,
  validateContradictionReviews,
} from "./contradictionReview.ts";

test("requires one skeptical review for every candidate claim and preserves all statuses", () => {
  const draft = candidateDraft();
  const value = {
    reviews: [
      review("feature_dossier", "orders-feature", "CONFIRMED", ["node:a"]),
      review("capability", "place-order", "PARTIALLY_TRUE", ["node:b"]),
      review("user_flow", "order-flow", "REFUTED", ["node:c"]),
      review("requirement", "positive-total", "UNKNOWN", []),
    ],
  };

  const reviews = validateContradictionReviews(value, draft);
  assert.deepEqual(
    reviews.map((item) => item.status).sort(),
    ["CONFIRMED", "PARTIALLY_TRUE", "REFUTED", "UNKNOWN"],
  );

  const missing = structuredClone(value);
  missing.reviews.pop();
  assert.throws(
    () => validateContradictionReviews(missing, draft),
    /missing targets requirement:positive-total/,
  );

  const unsupported = structuredClone(value);
  unsupported.reviews[0].evidenceNodeIds = [];
  assert.throws(
    () => validateContradictionReviews(unsupported, draft),
    /requires evidence for CONFIRMED/,
  );
});

test("recovers from truncated whole-review JSON by finalizing bounded batches", async () => {
  const draft = {
    featureDossiers: [],
    capabilities: [],
    userFlows: [],
    requirements: Array.from({ length: 9 }, (_, index) => ({
      id: `requirement-${index + 1}`,
      category: "behavior",
      statement: `Requirement ${index + 1}.`,
      evidenceNodeIds: [],
    })),
    uncertainties: [],
  };
  const responses = [
    { id: "truncated", status: "length", output: [], outputText: '{"reviews":[' },
    finalResponse(draft.requirements.slice(0, 8)),
    finalResponse(draft.requirements.slice(8)),
  ];
  const requests = [];
  const model = {
    provider: "test",
    async createResponse(request) {
      requests.push(request);
      return responses.shift();
    },
  };
  const tools = {
    definitions: [],
    async execute() {
      throw new Error("No tool call expected");
    },
    inspectedNodeIds() {
      return [];
    },
  };

  const result = await runContradictionReview(
    { files: [], symbols: [], entrypoints: [], entities: [] },
    draft,
    model,
    "test-model",
    tools,
    { maxTurns: 3, maxOutputTokens: 12_000 },
  );

  assert.equal(result.turns, 3);
  assert.equal(result.reviews.length, 9);
  assert.equal(requests[1].tools.length, 0);
  assert.match(requests[1].input.at(-1).content, /batch 1 of 2/i);
  assert.match(requests[2].input.at(-1).content, /batch 2 of 2/i);
});

test("prefetches referenced evidence once and supplies it to each finalization batch", async () => {
  const evidenceNodeId = "file:tests/test_planning_service.py";
  const draft = {
    featureDossiers: [],
    capabilities: [],
    userFlows: [],
    requirements: Array.from({ length: 9 }, (_, index) => ({
      id: `requirement-${index + 1}`,
      category: "behavior",
      statement: `Requirement ${index + 1}.`,
      evidenceNodeIds: [evidenceNodeId],
    })),
    uncertainties: [],
  };
  const responses = [
    confirmedResponse(draft.requirements.slice(0, 8), evidenceNodeId),
    confirmedResponse(draft.requirements.slice(8), evidenceNodeId),
  ];
  const requests = [];
  const sourceCalls = [];
  const model = {
    provider: "test",
    async createResponse(request) {
      requests.push(request);
      return responses.shift();
    },
  };
  const tools = {
    definitions: [],
    async execute(name, args) {
      sourceCalls.push({ name, args });
      return { ok: true, value: { nodeId: evidenceNodeId, source: "def plan(): pass" } };
    },
    inspectedNodeIds() {
      return [evidenceNodeId];
    },
  };

  const result = await runContradictionReview(
    {
      files: [{ id: evidenceNodeId, lineRange: { start: 1, end: 1 } }],
      symbols: [],
      entrypoints: [],
      entities: [],
      edges: [],
    },
    draft,
    model,
    "test-model",
    tools,
    { maxTurns: 2, maxOutputTokens: 12_000 },
  );

  assert.equal(result.reviews.length, 9);
  assert.equal(result.toolCalls, 1);
  assert.equal(sourceCalls.length, 1);
  assert.match(requests[0].input.at(-1).content, /test_planning_service\.py/);
  assert.match(requests[1].input.at(-1).content, /test_planning_service\.py/);
});

test("supplies independently selected owners and graph neighbors as counter-evidence", async () => {
  const handlerId = "function:src/api.ts:submit";
  const helperId = "function:src/service.ts:save";
  const handlerFileId = "file:src/api.ts";
  const draft = {
    featureDossiers: [],
    capabilities: [],
    userFlows: [],
    requirements: [{
      id: "submit-order",
      category: "behavior",
      statement: "Submitting an order saves it.",
      evidenceNodeIds: [handlerId],
    }],
    uncertainties: [],
  };
  const sourceCalls = [];
  const requests = [];
  const model = {
    provider: "test",
    async createResponse(request) {
      requests.push(request);
      return confirmedResponse(draft.requirements, helperId);
    },
  };
  const tools = {
    definitions: [],
    async execute(name, args) {
      sourceCalls.push({ name, args });
      return { ok: true, value: { nodeId: args.id, source: "source" } };
    },
    inspectedNodeIds() {
      return sourceCalls.map((call) => call.args.id);
    },
  };

  const result = await runContradictionReview(
    {
      files: [
        { id: handlerFileId, type: "file", path: "src/api.ts", language: "typescript", contentHash: "a", lineRange: { start: 1, end: 3 } },
        { id: "file:src/service.ts", type: "file", path: "src/service.ts", language: "typescript", contentHash: "b", lineRange: { start: 1, end: 1 } },
      ],
      symbols: [
        { id: handlerId, type: "function", name: "submit", fileId: handlerFileId, lineRange: { start: 1, end: 3 }, exported: true },
        { id: helperId, type: "function", name: "save", fileId: "file:src/service.ts", lineRange: { start: 1, end: 1 }, exported: true },
      ],
      entrypoints: [],
      entities: [],
      edges: [{
        source: handlerId,
        target: helperId,
        type: "CALLS",
        evidence: { file: "src/api.ts", line: 2, extractor: "resolver" },
      }],
    },
    draft,
    model,
    "test-model",
    tools,
    { maxTurns: 1, maxOutputTokens: 12_000 },
  );

  assert.equal(result.toolCalls, 3);
  assert.deepEqual(
    sourceCalls.map((call) => call.args.id),
    [handlerId, handlerFileId, helperId],
  );
  assert.equal(result.reviews[0].evidenceNodeIds[0], helperId);
  assert.match(
    requests[0].input.at(-1).content,
    /independently selected neighboring sources.*src\/service\.ts/is,
  );
});

function review(targetKind, targetId, status, evidenceNodeIds) {
  return {
    targetKind,
    targetId,
    hypothesis: `Challenge ${targetId}.`,
    status,
    conclusion: "The skeptical conclusion is recorded separately.",
    evidenceNodeIds,
  };
}

function candidateDraft() {
  return {
    featureDossiers: [
      {
        id: "orders-feature",
        title: "Orders",
        entrypoints: [],
        ui: [],
        handlers: [],
        services: [],
        schemas: [],
        stateTransitions: [],
        events: [],
        tests: [],
        config: [],
        documentation: [],
        evidenceNodeIds: ["node:a"],
        unresolvedQuestions: [],
        reachability: "unknown",
      },
    ],
    capabilities: [
      {
        id: "place-order",
        dossierId: "orders-feature",
        title: "Place order",
        description: "Places an order.",
        entrypointNodeIds: [],
        evidenceNodeIds: ["node:b"],
      },
    ],
    userFlows: [
      {
        id: "order-flow",
        title: "Order flow",
        description: "Submits an order.",
        evidenceNodeIds: ["node:c"],
        steps: [
          { order: 1, statement: "Submit.", evidenceNodeIds: ["node:c"] },
        ],
      },
    ],
    requirements: [
      {
        id: "positive-total",
        category: "validation",
        statement: "The total is positive.",
        evidenceNodeIds: ["node:d"],
      },
    ],
    uncertainties: [],
  };
}

function finalResponse(requirements) {
  return {
    id: "batch",
    status: "stop",
    output: [],
    outputText: JSON.stringify({
      reviews: requirements.map((requirement) =>
        review("requirement", requirement.id, "UNKNOWN", [])
      ),
    }),
  };
}

function confirmedResponse(requirements, evidenceNodeId) {
  return {
    id: "batch-confirmed",
    status: "stop",
    output: [],
    outputText: JSON.stringify({
      reviews: requirements.map((requirement) =>
        review("requirement", requirement.id, "CONFIRMED", [evidenceNodeId])
      ),
    }),
  };
}
