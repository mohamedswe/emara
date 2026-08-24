import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import {
  CONTRACT_DISCOVERY_INSTRUCTIONS,
  discoverContract,
} from "./discoverContract.ts";

const temporaryRepositories = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((repositoryPath) =>
      rm(repositoryPath, { recursive: true, force: true }),
    ),
  );
});

test("runs the complete tool loop and produces an evidence-backed contract", async () => {
  const { repositoryPath, graph, handlerId, endpointId } = await fixtureGraph();
  const graphBefore = structuredClone(graph);
  const model = new FakeModel([
    toolResponse("call-1", "list_endpoints", {
      kind: null,
      offset: null,
      limit: null,
    }),
    toolResponse("call-2", "get_source", {
      id: endpointId,
      maxLines: null,
      maxBytes: null,
    }),
    toolResponse("call-3", "get_source", {
      id: handlerId,
      maxLines: null,
      maxBytes: null,
    }),
    finalResponse(contractDraft(handlerId, endpointId)),
    toolResponse("review-source", "get_source", {
      id: handlerId,
      maxLines: null,
      maxBytes: null,
    }),
    finalResponse(contradictionReview(handlerId)),
  ]);

  const result = await discoverContract(graph, repositoryPath, model, {
    model: "test-model",
  });

  assert.equal(result.turns, 4);
  assert.equal(result.toolCalls, 7);
  assert.equal(result.reviewTurns, 2);
  assert.equal(result.coverageInvestigationTurns, 0);
  assert.equal(result.modelRequests, 6);
  assert.equal(result.contract.discovery.provider, "test");
  assert.equal(result.contract.discovery.model, "test-model");
  assert.ok(result.contract.discovery.inspectedNodeIds.includes(endpointId));
  assert.ok(result.contract.discovery.inspectedNodeIds.includes(handlerId));
  assert.ok(result.contract.discovery.inspectedNodeIds.includes("file:src/app.ts"));
  assert.equal(result.contract.capabilities[0].evidence.length, 2);
  assert.equal(result.contract.capabilities[0].entrypointNodeIds[0], endpointId);
  assert.equal(result.contract.requirements[0].evidence[0].nodeId, handlerId);
  assert.equal(result.contract.capabilities[0].confidence, "PROVEN");
  assert.equal(result.contract.contradictionReviews.length, 4);
  assert.equal(result.contract.coverageReview.unexplainedMeaningfulNodes, 0);

  assert.equal(model.requests.length, 6);
  assert.equal(model.requests[0].parallel_tool_calls, false);
  assert.equal(model.requests[0].store, false);
  assert.equal(model.requests[0].text.format.strict, true);
  assert.equal(model.requests[0].text.format.schema.additionalProperties, false);
  assert.match(model.requests[0].instructions, /untrusted repository data/);
  assert.deepEqual(
    model.requests[0].tools.map((tool) => tool.name),
    [
      "search_graph",
      "get_node",
      "get_neighbors",
      "get_source",
      "get_sources",
      "list_endpoints",
      "search_symbols",
      "list_files",
      "find_definition",
      "find_references",
      "find_callers",
      "find_callees",
      "find_importers",
      "find_consumers",
      "is_reachable",
      "find_paths_from_entrypoints",
      "find_paths_to_external_behavior",
    ],
  );
  const finalInput = model.requests[3].input;
  assert.equal(
    finalInput.filter((item) => item.type === "function_call_output").length,
    3,
  );
  assert.ok(
    finalInput
      .filter((item) => item.type === "function_call_output")
      .every((item) => JSON.parse(item.output).ok === true),
  );
  assert.match(CONTRACT_DISCOVERY_INSTRUCTIONS, /Never invent/);
  assert.match(model.requests[4].instructions, /independent Contradiction Reviewer/);
  assert.deepEqual(graph, graphBefore);
});

test("runs a deterministic final source audit for valid cited nodes", async () => {
  const { repositoryPath, graph, handlerId, endpointId } = await fixtureGraph();
  const model = new FakeModel([
    toolResponse("call-1", "get_source", {
      id: handlerId,
      maxLines: null,
      maxBytes: null,
    }),
    finalResponse(contractDraft(handlerId, endpointId)),
    toolResponse("review-source", "get_source", {
      id: handlerId,
      maxLines: null,
      maxBytes: null,
    }),
    finalResponse(contradictionReview(handlerId)),
  ]);

  const result = await discoverContract(graph, repositoryPath, model, {
    maxTurns: 4,
  });

  assert.equal(result.turns, 2);
  assert.equal(result.toolCalls, 6);
  assert.ok(result.contract.discovery.inspectedNodeIds.includes(endpointId));
  assert.ok(result.contract.discovery.inspectedNodeIds.includes(handlerId));
  assert.ok(result.contract.discovery.inspectedNodeIds.includes("file:src/app.ts"));
});

test("repairs an evidence-free dossier from its dependent capability evidence", async () => {
  const { repositoryPath, graph, handlerId, endpointId } = await fixtureGraph();
  const draft = contractDraft(handlerId, endpointId);
  draft.featureDossiers[0].evidenceNodeIds = [];
  const model = new FakeModel([
    toolResponse("source-handler", "get_source", sourceArgs(handlerId)),
    finalResponse(draft),
    finalResponse(contradictionReview(handlerId)),
  ]);

  const result = await discoverContract(graph, repositoryPath, model, {
    maxTurns: 3,
  });

  assert.deepEqual(
    result.contract.featureDossiers[0].evidence.map((item) => item.nodeId),
    [endpointId, handlerId],
  );
});

test("does not promote a known non-entrypoint graph node to a capability entrypoint", async () => {
  const { repositoryPath, graph, handlerId, endpointId } = await fixtureGraph();
  const invalidDraft = contractDraft(handlerId, endpointId);
  invalidDraft.capabilities[0].entrypointNodeIds = [handlerId];
  const model = new FakeModel([
    toolResponse("call-1", "get_source", {
      id: handlerId,
      maxLines: null,
      maxBytes: null,
    }),
    toolResponse("call-2", "get_source", {
      id: endpointId,
      maxLines: null,
      maxBytes: null,
    }),
    finalResponse(invalidDraft),
    finalResponse(contractDraft(handlerId, endpointId)),
    toolResponse("review-source", "get_source", {
      id: handlerId,
      maxLines: null,
      maxBytes: null,
    }),
    finalResponse(contradictionReview(handlerId)),
  ]);

  const result = await discoverContract(graph, repositoryPath, model, {
    maxTurns: 5,
  });

  assert.equal(result.turns, 3);
  assert.deepEqual(result.contract.capabilities[0].entrypointNodeIds, []);
  assert.match(model.requests[3].instructions, /Contradiction Reviewer/);
});

test("recovers from a truncated whole draft without replaying the oversized response", async () => {
  const { repositoryPath, graph, handlerId, endpointId } = await fixtureGraph();
  const partial = '{"featureDossiers":[{"id":"oversized"';
  const model = new FakeModel([
    toolResponse("source-handler", "get_source", sourceArgs(handlerId)),
    {
      id: "truncated",
      status: "length",
      output: [],
      outputText: partial,
    },
    finalResponse(contractDraft(handlerId, endpointId)),
    finalResponse(contradictionReview(handlerId)),
  ]);

  const result = await discoverContract(graph, repositoryPath, model, {
    maxTurns: 4,
  });

  assert.equal(result.turns, 3);
  assert.match(
    model.requests[2].input.at(-1).content,
    /truncated by the output limit/i,
  );
  assert.ok(
    !model.requests[2].input.some((item) =>
      item.role === "assistant" && item.content === partial
    ),
  );
});

test("recognizes structurally unfinished JSON even when it ends with an inner closing brace", async () => {
  const { repositoryPath, graph, handlerId, endpointId } = await fixtureGraph();
  const partial = `${JSON.stringify({
    featureDossiers: [],
    capabilities: [],
    userFlows: [],
  }).slice(0, -1)},"requirements":[{"id":"cut-off"}`;
  const model = new FakeModel([
    toolResponse("source-handler", "get_source", sourceArgs(handlerId)),
    {
      id: "truncated-with-inner-brace",
      status: "stop",
      output: [],
      outputText: partial,
    },
    finalResponse(contractDraft(handlerId, endpointId)),
    finalResponse(contradictionReview(handlerId)),
  ]);

  const result = await discoverContract(graph, repositoryPath, model, {
    maxTurns: 4,
  });

  assert.equal(result.turns, 3);
  assert.match(
    model.requests[2].input.at(-1).content,
    /truncated by the output limit/i,
  );
  assert.ok(
    !model.requests[2].input.some((item) =>
      item.role === "assistant" && item.content === partial
    ),
  );
});

test("corrects refuted claims, promotes omitted features, and verifies convergence", async () => {
  const fixture = await twoEndpointFixtureGraph();
  const initialDraft = singleEndpointDraft(
    fixture.checkoutHandlerId,
    fixture.checkoutEndpointId,
  );
  const correctedDraft = twoEndpointDraft(fixture);
  const model = new FakeModel([
    toolResponse("initial-endpoint", "get_source", sourceArgs(fixture.checkoutEndpointId)),
    toolResponse("initial-handler", "get_source", sourceArgs(fixture.checkoutHandlerId)),
    finalResponse(initialDraft),
    toolResponse("initial-review-source", "get_source", sourceArgs(fixture.checkoutHandlerId)),
    finalResponse({
      reviews: [
        review("feature_dossier", "checkout-feature", fixture.checkoutHandlerId),
        review("capability", "checkout-api", fixture.checkoutHandlerId),
        {
          ...review("requirement", "checkout-persists", fixture.checkoutHandlerId),
          status: "REFUTED",
          conclusion: "The handler returns a value without persisting it.",
        },
      ],
    }),
    toolResponse("correction-refund-endpoint", "get_source", sourceArgs(fixture.refundEndpointId)),
    toolResponse("correction-refund-handler", "get_source", sourceArgs(fixture.refundHandlerId)),
    finalResponse(correctedDraft),
    toolResponse("final-review-refund", "get_source", sourceArgs(fixture.refundHandlerId)),
    finalResponse({
      reviews: [
        review("feature_dossier", "refund-feature", fixture.refundHandlerId),
        review("capability", "refund-api", fixture.refundHandlerId),
      ],
    }),
  ]);

  const result = await discoverContract(
    fixture.graph,
    fixture.repositoryPath,
    model,
    { maxCorrectionRounds: 1 },
  );

  assert.equal(result.correctionRounds, 1);
  assert.equal(result.correctionTurns, 3);
  assert.equal(result.correctionConverged, true);
  assert.equal(result.reviewTurns, 4);
  assert.equal(result.modelRequests, 10);
  assert.deepEqual(
    result.contract.capabilities.map((capability) => capability.id),
    ["checkout-api", "refund-api"],
  );
  assert.equal(
    result.contract.requirements.some((item) => item.id === "checkout-persists"),
    false,
  );
  assert.equal(result.contract.coverageReview.unexplainedMeaningfulNodes, 0);
  assert.equal(result.contract.discovery.correctionRoundCount, 1);
  assert.equal(result.contract.discovery.correctionConverged, true);
  assert.match(model.requests[5].instructions, /Contract Correction Agent/);
});

test("honors a zero-round correction budget and reports non-convergence", async () => {
  const fixture = await twoEndpointFixtureGraph();
  const model = new FakeModel([
    toolResponse("initial-endpoint", "get_source", sourceArgs(fixture.checkoutEndpointId)),
    toolResponse("initial-handler", "get_source", sourceArgs(fixture.checkoutHandlerId)),
    finalResponse(singleEndpointDraft(fixture.checkoutHandlerId, fixture.checkoutEndpointId)),
    toolResponse("review-source", "get_source", sourceArgs(fixture.checkoutHandlerId)),
    finalResponse({
      reviews: [
        review("feature_dossier", "checkout-feature", fixture.checkoutHandlerId),
        review("capability", "checkout-api", fixture.checkoutHandlerId),
        {
          ...review("requirement", "checkout-persists", fixture.checkoutHandlerId),
          status: "REFUTED",
          conclusion: "No persistence call exists.",
        },
      ],
    }),
  ]);

  const result = await discoverContract(
    fixture.graph,
    fixture.repositoryPath,
    model,
    { maxCorrectionRounds: 0 },
  );

  assert.equal(result.correctionRounds, 0);
  assert.equal(result.correctionTurns, 0);
  assert.equal(result.correctionConverged, false);
  assert.equal(result.contract.capabilities.length, 1);
  assert.ok(result.contract.coverageReview.unexplainedMeaningfulNodes > 0);
  assert.equal(model.responses.length, 0);
});

test("prunes invented evidence and flags it instead of crashing", async () => {
  const { repositoryPath, graph, handlerId, endpointId } = await fixtureGraph();
  const invented = contractDraft(handlerId, endpointId);
  invented.featureDossiers[0].evidenceNodeIds.push(
    "function:src/app.ts:invented",
  );
  const model = new FakeModel([
    toolResponse("source-endpoint", "get_source", {
      id: endpointId,
      maxLines: null,
      maxBytes: null,
    }),
    finalResponse(invented),
    toolResponse("review-source", "get_source", {
      id: handlerId,
      maxLines: null,
      maxBytes: null,
    }),
    finalResponse(contradictionReview(handlerId)),
  ]);

  // The invented node is pruned and recorded as an uncertainty; the audit
  // continues rather than crashing on the hallucinated citation.
  const result = await discoverContract(graph, repositoryPath, model, {
    maxTurns: 5,
    maxCorrectionRounds: 0,
  });
  const flagged = result.contract.uncertainties.filter((u) =>
    u.statement.includes("invented"),
  );
  assert.ok(
    flagged.length > 0,
    "expected an uncertainty recording the pruned invented evidence",
  );
  // The pruned node must not survive in any dossier evidence.
  const stillCited = result.contract.featureDossiers.some((d) =>
    d.evidence.some((e) => e.nodeId === "function:src/app.ts:invented"),
  );
  assert.equal(stillCited, false);
});

test("repairs a schema-invalid draft instead of failing the run", async () => {
  const { repositoryPath, graph, handlerId, endpointId } = await fixtureGraph();
  // First draft has an invalid requirement category (the run-5 failure mode).
  const invalid = contractDraft(handlerId, endpointId);
  invalid.requirements[0].category = "functional"; // not in the allowed enum
  const valid = contractDraft(handlerId, endpointId);

  const model = new FakeModel([
    toolResponse("source-endpoint", "get_source", sourceArgs(endpointId)),
    finalResponse(invalid), // fails validation -> triggers repair
    finalResponse(valid), // the repair attempt returns a valid draft
    toolResponse("review-source", "get_source", sourceArgs(handlerId)),
    finalResponse(contradictionReview(handlerId)),
  ]);

  const result = await discoverContract(graph, repositoryPath, model, {
    maxTurns: 6,
    maxCorrectionRounds: 0,
  });

  // The run completed despite the invalid first draft.
  assert.equal(result.contract.capabilities.length, 1);
  assert.equal(result.contract.capabilities[0].id, "checkout-api");
  // The repair request told the model what to fix.
  const repairRequest = model.requests[2];
  assert.match(repairRequest.input.at(-1).content, /failed schema validation/);
  assert.match(repairRequest.input.at(-1).content, /category/);
});

test("stops a model that exceeds the configured turn bound", async () => {
  const { repositoryPath, graph } = await fixtureGraph();
  const model = new FakeModel([
    toolResponse("call-1", "list_files", {
      query: null,
      language: null,
      offset: null,
      limit: null,
    }),
    toolResponse("call-2", "list_files", {
      query: null,
      language: null,
      offset: null,
      limit: null,
    }),
  ]);

  await assert.rejects(
    discoverContract(graph, repositoryPath, model, { maxTurns: 2 }),
    /exceeded the maximum of 2 model turns/,
  );
  assert.equal(model.requests[1].tools.length, 0);
  assert.match(
    model.requests[1].input.at(-1).content,
    /Do not request more tools/,
  );
});

class FakeModel {
  provider = "test";

  constructor(responses) {
    this.responses = [...responses];
    this.requests = [];
  }

  async createResponse(request) {
    this.requests.push(structuredClone(request));
    const response = this.responses.shift();
    if (response === undefined) throw new Error("Fake model response exhausted");
    return response;
  }
}

function toolResponse(callId, name, args) {
  return {
    id: `response-${callId}`,
    status: "completed",
    output: [
      {
        type: "function_call",
        call_id: callId,
        name,
        arguments: JSON.stringify(args),
      },
    ],
    outputText: null,
  };
}

function sourceArgs(id) {
  return { id, maxLines: null, maxBytes: null };
}

function finalResponse(draft) {
  return {
    id: "response-final",
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(draft) }],
      },
    ],
    outputText: JSON.stringify(draft),
  };
}

function contractDraft(handlerId, endpointId) {
  return {
    featureDossiers: [
      {
        id: "checkout-feature",
        title: "Checkout API",
        entrypoints: [endpointId],
        ui: [],
        handlers: [handlerId],
        services: [],
        schemas: [],
        stateTransitions: [],
        events: [],
        tests: [],
        config: [],
        documentation: [],
        evidenceNodeIds: [endpointId, handlerId],
        unresolvedQuestions: ["Persistence behavior is not established."],
        reachability: "reachable",
      },
    ],
    capabilities: [
      {
        id: "checkout-api",
        dossierId: "checkout-feature",
        title: "Checkout API",
        description: "Accepts checkout requests.",
        entrypointNodeIds: [endpointId],
        evidenceNodeIds: [endpointId, handlerId],
      },
    ],
    userFlows: [
      {
        id: "submit-checkout",
        title: "Submit checkout",
        description: "A caller submits checkout data to the handler.",
        evidenceNodeIds: [endpointId, handlerId],
        steps: [
          {
            order: 1,
            statement: "Receive a POST checkout request.",
            evidenceNodeIds: [endpointId],
          },
          {
            order: 2,
            statement: "Validate the request value.",
            evidenceNodeIds: [handlerId],
          },
        ],
      },
    ],
    requirements: [
      {
        id: "positive-amount",
        category: "validation",
        statement: "Checkout amounts must be positive.",
        evidenceNodeIds: [handlerId],
      },
    ],
    uncertainties: [
      {
        id: "persistence-outcome",
        statement: "Checkout persistence behavior is unknown.",
        reason: "No persistence call is established by the graph.",
        evidenceNodeIds: [],
      },
    ],
  };
}

function contradictionReview(evidenceNodeId) {
  return {
    reviews: [
      review("feature_dossier", "checkout-feature", evidenceNodeId),
      review("capability", "checkout-api", evidenceNodeId),
      review("user_flow", "submit-checkout", evidenceNodeId),
      review("requirement", "positive-amount", evidenceNodeId),
    ],
  };
}

function singleEndpointDraft(handlerId, endpointId) {
  return {
    featureDossiers: [
      {
        id: "checkout-feature",
        title: "Checkout API",
        entrypoints: [endpointId],
        ui: [],
        handlers: [handlerId],
        services: [],
        schemas: [],
        stateTransitions: [],
        events: [],
        tests: [],
        config: [],
        documentation: [],
        evidenceNodeIds: [endpointId, handlerId],
        unresolvedQuestions: [],
        reachability: "reachable",
      },
    ],
    capabilities: [
      {
        id: "checkout-api",
        dossierId: "checkout-feature",
        title: "Checkout API",
        description: "Accepts checkout requests.",
        entrypointNodeIds: [endpointId],
        evidenceNodeIds: [endpointId, handlerId],
      },
    ],
    userFlows: [],
    requirements: [
      {
        id: "checkout-persists",
        category: "behavior",
        statement: "Every checkout is persisted.",
        evidenceNodeIds: [handlerId],
      },
    ],
    uncertainties: [],
  };
}

function twoEndpointDraft(fixture) {
  const draft = singleEndpointDraft(
    fixture.checkoutHandlerId,
    fixture.checkoutEndpointId,
  );
  draft.featureDossiers.push({
    id: "refund-feature",
    title: "Refund API",
    entrypoints: [fixture.refundEndpointId],
    ui: [],
    handlers: [fixture.refundHandlerId],
    services: [],
    schemas: [],
    stateTransitions: [],
    events: [],
    tests: [],
    config: [],
    documentation: [],
    evidenceNodeIds: [fixture.refundEndpointId, fixture.refundHandlerId],
    unresolvedQuestions: [],
    reachability: "reachable",
  });
  draft.capabilities.push({
    id: "refund-api",
    dossierId: "refund-feature",
    title: "Refund API",
    description: "Accepts refund requests.",
    entrypointNodeIds: [fixture.refundEndpointId],
    evidenceNodeIds: [fixture.refundEndpointId, fixture.refundHandlerId],
  });
  draft.requirements = [];
  draft.uncertainties.push({
    id: "checkout-persistence",
    statement: "Checkout persistence is not established.",
    reason: "The handler contains no persistence operation.",
    evidenceNodeIds: [fixture.checkoutHandlerId],
  });
  return draft;
}

function review(targetKind, targetId, evidenceNodeId) {
  return {
    targetKind,
    targetId,
    hypothesis: `The ${targetId} claim is supported.`,
    status: "CONFIRMED",
    conclusion: "Direct source evidence supports the material claim.",
    evidenceNodeIds: [evidenceNodeId],
  };
}

async function fixtureGraph() {
  const repositoryPath = await mkdtemp(
    join(tmpdir(), "contract-discovery-agent-"),
  );
  temporaryRepositories.push(repositoryPath);
  await writeFixture(
    repositoryPath,
    "src/app.ts",
    [
      "function checkout(amount: number) {",
      '  if (amount <= 0) throw new Error("amount");',
      "}",
      'router.post("/checkout", checkout);',
    ].join("\n"),
  );
  const { graph } = await indexRepository(repositoryPath);
  return {
    repositoryPath,
    graph,
    handlerId: "function:src/app.ts:checkout",
    endpointId: "entrypoint:http:src/app.ts:4:POST /checkout",
  };
}

async function twoEndpointFixtureGraph() {
  const repositoryPath = await mkdtemp(
    join(tmpdir(), "contract-correction-agent-"),
  );
  temporaryRepositories.push(repositoryPath);
  await writeFixture(
    repositoryPath,
    "src/app.ts",
    [
      "function checkout() { return { accepted: true }; }",
      "function refund() { return { refunded: true }; }",
      'router.post("/checkout", checkout);',
      'router.post("/refund", refund);',
    ].join("\n"),
  );
  const { graph } = await indexRepository(repositoryPath);
  return {
    repositoryPath,
    graph,
    checkoutHandlerId: "function:src/app.ts:checkout",
    refundHandlerId: "function:src/app.ts:refund",
    checkoutEndpointId: "entrypoint:http:src/app.ts:3:POST /checkout",
    refundEndpointId: "entrypoint:http:src/app.ts:4:POST /refund",
  };
}

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
