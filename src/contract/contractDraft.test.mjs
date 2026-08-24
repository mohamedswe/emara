import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  CONTRACT_DRAFT_JSON_SCHEMA,
  validateContractDraft,
} from "./contractDraft.ts";
import { hydrateSoftwareContract } from "./hydrateContract.ts";
import {
  serializeSoftwareContract,
  writeSoftwareContract,
} from "./persistSoftwareContract.ts";
import { validateSoftwareContract } from "./validateSoftwareContract.ts";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directoryPath) =>
      rm(directoryPath, { recursive: true, force: true }),
    ),
  );
});

test("hydrates only inspected node IDs into canonical graph-owned evidence", () => {
  const graph = repositoryGraph();
  const draft = contractDraft();
  const contract = hydrateSoftwareContract(graph, draft, {
    provider: "test-provider",
    model: "test-model",
    toolCallCount: 4,
    reviewTurnCount: 1,
    coverageInvestigationTurnCount: 0,
    inspectedNodeIds: [
      "function:src/app.ts:checkout",
      "entrypoint:http:src/app.ts:5:POST /checkout",
    ],
  }, contradictionReviews(), []);

  assert.equal(CONTRACT_DRAFT_JSON_SCHEMA.additionalProperties, false);
  assert.deepEqual(contract.discovery.inspectedNodeIds, [
    "entrypoint:http:src/app.ts:5:POST /checkout",
    "function:src/app.ts:checkout",
  ]);
  assert.deepEqual(contract.capabilities[0].evidence, [
    {
      nodeId: "entrypoint:http:src/app.ts:5:POST /checkout",
      file: "src/app.ts",
      lineRange: { start: 5, end: 5 },
      contentHash: "app-hash",
      extractor: "tree-sitter",
      role: "implementation",
    },
    {
      nodeId: "function:src/app.ts:checkout",
      file: "src/app.ts",
      lineRange: { start: 1, end: 3 },
      contentHash: "app-hash",
      extractor: "tree-sitter",
      role: "implementation",
    },
  ]);
  assert.equal(contract.featureDossiers[0].reachability, "reachable");
  assert.deepEqual(contract.featureDossiers[0].stateTransitions, [
    "pending -> accepted",
  ]);
  assert.equal(contract.version, 4);
  assert.deepEqual(contract.discovery.completedStages, [
    "discovery",
    "feature_dossiers",
    "reachability",
    "contradiction_review",
    "coverage_review",
    "acceptance_review",
  ]);
  assert.equal(contract.discovery.correctionRoundCount, 0);
  assert.equal(contract.discovery.correctionTurnCount, 0);
  assert.equal(contract.discovery.correctionConverged, true);
  assert.equal(contract.capabilities[0].dossierId, "checkout-feature");
  assert.equal(contract.capabilities[0].confidence, "PROVEN");
  assert.equal(contract.capabilities[0].verification.status, "STATIC_VERIFIED");
  assert.equal(contract.uncertainties[0].confidence, "UNKNOWN");
  assert.deepEqual(contract.entrypoints, [
    {
      nodeId: "entrypoint:http:src/app.ts:5:POST /checkout",
      kind: "http",
      name: "POST /checkout",
      file: "src/app.ts",
      lineRange: { start: 5, end: 5 },
      handlerSymbolId: "function:src/app.ts:checkout",
    },
  ]);
  validateSoftwareContract(contract, graph);
});

test("derives claim confidence from the separate contradiction verdicts", () => {
  const graph = repositoryGraph();
  const reviews = contradictionReviews();
  reviews.find((item) => item.targetKind === "capability").status = "PARTIALLY_TRUE";
  reviews.find((item) => item.targetKind === "user_flow").status = "REFUTED";
  reviews.find((item) => item.targetKind === "requirement").status = "UNKNOWN";
  reviews.find((item) => item.targetKind === "requirement").evidenceNodeIds = [];
  const contract = hydrateSoftwareContract(graph, contractDraft(), {
    provider: "test-provider",
    model: "test-model",
    toolCallCount: 4,
    reviewTurnCount: 1,
    coverageInvestigationTurnCount: 0,
    inspectedNodeIds: [
      "function:src/app.ts:checkout",
      "entrypoint:http:src/app.ts:5:POST /checkout",
    ],
  }, reviews, []);

  assert.equal(contract.capabilities[0].confidence, "INFERRED");
  assert.equal(contract.userFlows[0].confidence, "UNKNOWN");
  assert.equal(contract.requirements[0].confidence, "UNKNOWN");
  assert.equal(
    contract.contradictionReviews.find((item) => item.targetKind === "user_flow").status,
    "REFUTED",
  );
});

test("hydrates inspected documentation files as scanner-owned evidence", () => {
  const graph = {
    version: 4,
    analysis: {
      sourceFileCount: 0,
      parsedSourceFileCount: 0,
      unparsedSourceFiles: [],
      diagnostics: [],
    },
    files: [
      {
        id: "file:README.md",
        type: "file",
        path: "README.md",
        language: "markdown",
        contentHash: "readme-hash",
        lineRange: { start: 1, end: 3 },
      },
    ],
    symbols: [],
    entrypoints: [],
    entities: [],
    edges: [],
  };
  const contract = hydrateSoftwareContract(
    graph,
    {
      featureDossiers: [],
      capabilities: [],
      userFlows: [],
      requirements: [
        {
          id: "documented-secrets-policy",
          category: "security",
          statement: "The README says secrets must not be committed.",
          evidenceNodeIds: ["file:README.md"],
        },
      ],
      uncertainties: [
        {
          id: "documented-only-promise",
          statement: "A documented promise has no proven implementation.",
          reason: "Only the README establishes the promise.",
          evidenceNodeIds: ["file:README.md"],
        },
      ],
    },
    {
      provider: "test-provider",
      model: "test-model",
      toolCallCount: 1,
      reviewTurnCount: 0,
      coverageInvestigationTurnCount: 0,
      correctionRoundCount: 1,
      correctionTurnCount: 2,
      correctionConverged: false,
      inspectedNodeIds: ["file:README.md"],
    },
    [
      {
        targetKind: "requirement",
        targetId: "documented-secrets-policy",
        hypothesis: "The README declares a secrets policy.",
        status: "CONFIRMED",
        conclusion: "The declaration is present in the README.",
        evidenceNodeIds: ["file:README.md"],
      },
    ],
    [],
  );

  assert.deepEqual(contract.uncertainties[0].evidence, [
    {
      nodeId: "file:README.md",
      file: "README.md",
      lineRange: { start: 1, end: 3 },
      contentHash: "readme-hash",
      extractor: "scanner",
      role: "documentation",
    },
  ]);
  assert.equal(contract.coverageReview.unexplainedMeaningfulNodes, 0);
  assert.equal(contract.requirements.length, 0);
  assert.equal(contract.declaredClaims.length, 1);
  assert.equal(
    contract.declaredClaims[0].verification.status,
    "DECLARED_ONLY",
  );
  assert.equal(contract.acceptance.status, "INCOMPLETE");
  validateSoftwareContract(contract, graph);
});

test("fails acceptance when supported source could not be parsed", () => {
  const graph = {
    version: 4,
    analysis: {
      sourceFileCount: 1,
      parsedSourceFileCount: 0,
      unparsedSourceFiles: ["src/broken.ts"],
      diagnostics: [{
        kind: "parse-error",
        message: "Unable to index ERROR syntax at lines 1-1.",
        file: "src/broken.ts",
        line: 1,
      }],
    },
    files: [{
      id: "file:src/broken.ts",
      type: "file",
      path: "src/broken.ts",
      language: "typescript",
      contentHash: "broken-hash",
      lineRange: { start: 1, end: 1 },
    }],
    symbols: [],
    entrypoints: [],
    entities: [],
    edges: [],
  };
  const contract = hydrateSoftwareContract(
    graph,
    {
      featureDossiers: [],
      capabilities: [],
      userFlows: [],
      requirements: [],
      uncertainties: [],
    },
    {
      provider: "test-provider",
      model: "test-model",
      toolCallCount: 0,
      reviewTurnCount: 0,
      coverageInvestigationTurnCount: 0,
      correctionRoundCount: 0,
      correctionTurnCount: 0,
      correctionConverged: true,
      inspectedNodeIds: [],
    },
    [],
    [],
  );

  assert.equal(contract.acceptance.status, "INCOMPLETE");
  assert.match(contract.acceptance.failures.join(" "), /could not be parsed/u);
  assert.match(contract.acceptance.failures.join(" "), /diagnostic/u);
});

test("rejects malformed drafts, invented evidence, and uninspected endpoints", () => {
  const graph = repositoryGraph();
  const duplicateIds = contractDraft();
  duplicateIds.requirements[0].id = duplicateIds.capabilities[0].id;
  assert.throws(
    () => validateContractDraft(duplicateIds),
    /duplicates contract item ID/,
  );

  const badOrder = contractDraft();
  badOrder.userFlows[0].steps[0].order = 2;
  assert.throws(() => validateContractDraft(badOrder), /order must be 1/);

  const missingDossier = contractDraft();
  missingDossier.capabilities[0].dossierId = "missing-feature";
  assert.throws(
    () => validateContractDraft(missingDossier),
    /references missing feature dossier/,
  );

  assert.throws(
    () =>
      hydrateSoftwareContract(graph, contractDraft(), {
        provider: "test",
        model: "test",
        toolCallCount: 1,
        reviewTurnCount: 1,
        coverageInvestigationTurnCount: 0,
        inspectedNodeIds: ["function:src/app.ts:checkout"],
      }, contradictionReviews(), []),
    /(entrypoint|feature dossier).* without a successful get_source inspection/,
  );

  const invented = contractDraft();
  invented.capabilities[0].evidenceNodeIds = [
    "function:src/app.ts:invented",
  ];
  invented.featureDossiers[0].evidenceNodeIds = [
    "entrypoint:http:src/app.ts:5:POST /checkout",
  ];
  assert.throws(
    () =>
      hydrateSoftwareContract(graph, invented, {
        provider: "test",
        model: "test",
        toolCallCount: 2,
        reviewTurnCount: 1,
        coverageInvestigationTurnCount: 0,
        inspectedNodeIds: [
          "entrypoint:http:src/app.ts:5:POST /checkout",
          "function:src/app.ts:invented",
        ],
      }, contradictionReviews(), []),
    /missing or non-source node/,
  );
});

test("serializes deterministic YAML and atomically validates before writing", async () => {
  const graph = repositoryGraph();
  const contract = hydrateSoftwareContract(graph, contractDraft(), {
    provider: "test-provider",
    model: "test-model",
    toolCallCount: 4,
    reviewTurnCount: 1,
    coverageInvestigationTurnCount: 0,
    inspectedNodeIds: [
      "function:src/app.ts:checkout",
      "entrypoint:http:src/app.ts:5:POST /checkout",
    ],
  }, contradictionReviews(), []);
  const serialized = serializeSoftwareContract(contract, graph);

  assert.match(serialized, /^version: 4\nrepository:\n/);
  assert.match(serialized, /title: "Checkout"/);
  assert.match(serialized, /handlerSymbolId: "function:src\/app.ts:checkout"/);
  assert.ok(serialized.endsWith("\n"));

  const directoryPath = await mkdtemp(join(tmpdir(), "software-contract-"));
  temporaryDirectories.push(directoryPath);
  const outputPath = join(directoryPath, "contract.yaml");
  await writeSoftwareContract(contract, graph, outputPath);
  const first = await readFile(outputPath, "utf8");
  await writeSoftwareContract(contract, graph, outputPath);
  assert.equal(await readFile(outputPath, "utf8"), first);

  const invalidContract = structuredClone(contract);
  invalidContract.capabilities[0].evidence[0].file = "invented.ts";
  await assert.rejects(
    writeSoftwareContract(invalidContract, graph, outputPath),
    /canonical graph-backed representation/,
  );
  assert.equal(await readFile(outputPath, "utf8"), first);
});

function repositoryGraph() {
  return {
    version: 4,
    analysis: {
      sourceFileCount: 1,
      parsedSourceFileCount: 1,
      unparsedSourceFiles: [],
      diagnostics: [],
    },
    files: [
      {
        id: "file:src/app.ts",
        type: "file",
        path: "src/app.ts",
        language: "typescript",
        contentHash: "app-hash",
      },
    ],
    symbols: [
      {
        id: "function:src/app.ts:checkout",
        type: "function",
        name: "checkout",
        fileId: "file:src/app.ts",
        lineRange: { start: 1, end: 3 },
        exported: true,
      },
    ],
    entrypoints: [
      {
        id: "entrypoint:http:src/app.ts:5:POST /checkout",
        type: "entrypoint",
        kind: "http",
        name: "POST /checkout",
        exposure: "external",
        httpMethod: "POST",
        route: "/checkout",
        fileId: "file:src/app.ts",
        handlerSymbolId: "function:src/app.ts:checkout",
        lineRange: { start: 5, end: 5 },
        evidence: {
          file: "src/app.ts",
          line: 5,
          extractor: "tree-sitter",
        },
      },
    ],
    entities: [
      {
        id: "endpoint:src/app.ts:5:POST /checkout",
        type: "endpoint",
        name: "POST /checkout",
        entrypointId: "entrypoint:http:src/app.ts:5:POST /checkout",
        kind: "http",
        httpMethod: "POST",
        route: "/checkout",
        fileId: "file:src/app.ts",
        lineRange: { start: 5, end: 5 },
        evidence: {
          file: "src/app.ts",
          line: 5,
          extractor: "tree-sitter",
        },
      },
    ],
    edges: [
      {
        source: "file:src/app.ts",
        target: "function:src/app.ts:checkout",
        type: "CONTAINS",
        evidence: {
          file: "src/app.ts",
          line: 1,
          extractor: "tree-sitter",
        },
      },
      {
        source: "file:src/app.ts",
        target: "entrypoint:http:src/app.ts:5:POST /checkout",
        type: "CONTAINS",
        evidence: {
          file: "src/app.ts",
          line: 5,
          extractor: "tree-sitter",
        },
      },
      {
        source: "file:src/app.ts",
        target: "endpoint:src/app.ts:5:POST /checkout",
        type: "CONTAINS",
        evidence: {
          file: "src/app.ts",
          line: 5,
          extractor: "tree-sitter",
        },
      },
      {
        source: "endpoint:src/app.ts:5:POST /checkout",
        target: "function:src/app.ts:checkout",
        type: "HANDLED_BY",
        evidence: {
          file: "src/app.ts",
          line: 5,
          extractor: "resolver",
        },
      },
    ],
  };
}

function contractDraft() {
  const handler = "function:src/app.ts:checkout";
  const endpoint = "entrypoint:http:src/app.ts:5:POST /checkout";
  return {
    featureDossiers: [
      {
        id: "checkout-feature",
        title: "Checkout",
        entrypoints: [endpoint],
        ui: [],
        handlers: [handler],
        services: [],
        schemas: [],
        stateTransitions: ["pending -> accepted"],
        events: [],
        tests: [],
        config: [],
        documentation: [],
        evidenceNodeIds: [handler, endpoint],
        unresolvedQuestions: ["Payment persistence is not established."],
        reachability: "reachable",
      },
    ],
    capabilities: [
      {
        id: "checkout",
        dossierId: "checkout-feature",
        title: "Checkout",
        description: "Accepts checkout requests.",
        entrypointNodeIds: [endpoint],
        evidenceNodeIds: [handler, endpoint],
      },
    ],
    userFlows: [
      {
        id: "submit-checkout",
        title: "Submit checkout",
        description: "A caller submits a checkout request.",
        evidenceNodeIds: [endpoint, handler],
        steps: [
          {
            order: 1,
            statement: "Receive the checkout request.",
            evidenceNodeIds: [endpoint],
          },
          {
            order: 2,
            statement: "Run the checkout handler.",
            evidenceNodeIds: [handler],
          },
        ],
      },
    ],
    requirements: [
      {
        id: "checkout-behavior",
        category: "behavior",
        statement: "The checkout handler processes the request.",
        evidenceNodeIds: [handler],
      },
    ],
    uncertainties: [
      {
        id: "payment-outcome",
        statement: "The eventual payment outcome is unknown.",
        reason: "No resolved payment implementation is present.",
        evidenceNodeIds: [],
      },
    ],
  };
}

function contradictionReviews() {
  const endpoint = "entrypoint:http:src/app.ts:5:POST /checkout";
  return [
    review("feature_dossier", "checkout-feature", endpoint),
    review("capability", "checkout", endpoint),
    review("user_flow", "submit-checkout", endpoint),
    review("requirement", "checkout-behavior", endpoint),
  ];
}

function review(targetKind, targetId, evidenceNodeId) {
  return {
    targetKind,
    targetId,
    hypothesis: `Review ${targetId}.`,
    status: "CONFIRMED",
    conclusion: `${targetId} is directly supported.`,
    evidenceNodeIds: [evidenceNodeId],
  };
}
