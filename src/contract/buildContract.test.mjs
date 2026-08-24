import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import {
  buildContract,
  loadContractEnvironment,
} from "./buildContract.ts";

const temporaryRepositories = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((repositoryPath) =>
      rm(repositoryPath, { recursive: true, force: true }),
    ),
  );
});

test("indexes a codebase, discovers its contract, and writes deterministic contract.yaml", async () => {
  const repositoryPath = await createRepository();
  await writeFixture(
    repositoryPath,
    "src/app.ts",
    [
      "function health() { return { ok: true }; }",
      'router.get("/health", health);',
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "previous-analysis.yaml",
    "capability: should-not-be-indexed\n",
  );
  const handlerId = "function:src/app.ts:health";
  const endpointId = "entrypoint:http:src/app.ts:2:GET /health";

  const first = await buildContract(
    repositoryPath,
    modelForContract(handlerId, endpointId),
    { model: "fixture-model", excludePaths: ["previous-analysis.yaml"] },
  );
  const firstYaml = await readFile(first.outputPath, "utf8");
  const firstGraph = await readFile(first.graphPath, "utf8");
  const second = await buildContract(
    repositoryPath,
    modelForContract(handlerId, endpointId),
    {
      model: "fixture-model",
      excludePaths: ["previous-analysis.yaml"],
      reuseGraph: true,
    },
  );

  assert.equal(first.outputPath, join(repositoryPath, "contract.yaml"));
  assert.equal(first.graphPath, join(repositoryPath, "graph.json"));
  assert.equal(first.graphReused, false);
  assert.equal(second.graphReused, true);
  assert.equal(await readFile(second.outputPath, "utf8"), firstYaml);
  assert.equal(await readFile(second.graphPath, "utf8"), firstGraph);
  assert.match(firstYaml, /^version: 4\n/);
  assert.equal(first.contract.acceptance.status, "STATICALLY_VERIFIED");
  assert.equal(first.acceptedForStaticAudit, true);
  assert.match(firstYaml, /title: "Health endpoint"/);
  assert.match(firstYaml, /contentHash:/);
  assert.equal(first.contract.capabilities.length, 1);
  assert.equal(first.contract.entrypoints.length, 1);
  assert.equal(first.turns, 3);
  assert.equal(first.toolCalls, 6);
  assert.equal(first.reviewTurns, 2);
  assert.equal(first.coverageInvestigationTurns, 0);
  const graph = JSON.parse(firstGraph);
  assert.equal(graph.files.some((file) => file.path === "contract.yaml"), false);
  assert.equal(graph.files.some((file) => file.path === "graph.json"), false);
  assert.equal(
    graph.files.some((file) => file.path === "previous-analysis.yaml"),
    false,
  );
});

test("refuses to reuse a graph when the repository snapshot changed", async () => {
  const repositoryPath = await createRepository();
  const sourcePath = join(repositoryPath, "src/app.ts");
  await writeFixture(
    repositoryPath,
    "src/app.ts",
    "function health() { return true; }\nrouter.get('/health', health);\n",
  );
  const handlerId = "function:src/app.ts:health";
  const endpointId = "entrypoint:http:src/app.ts:2:GET /health";
  await buildContract(
    repositoryPath,
    modelForContract(handlerId, endpointId),
    { model: "fixture-model" },
  );
  await writeFile(
    sourcePath,
    "function health() { return false; }\nrouter.get('/health', health);\n",
  );

  await assert.rejects(
    buildContract(
      repositoryPath,
      modelForContract(handlerId, endpointId),
      { model: "fixture-model", reuseGraph: true },
    ),
    /Cannot reuse stale repository graph.*src\/app\.ts/,
  );
});

test("rejects colliding graph and contract output paths", async () => {
  const repositoryPath = await createRepository();

  await assert.rejects(
    buildContract(repositoryPath, modelForContract("x", "y"), {
      graphPath: "artifact.yaml",
      outputPath: "artifact.yaml",
    }),
    /must be different/,
  );
});

test("loads contract configuration from an explicit .env file", async () => {
  const repositoryPath = await createRepository();
  const environmentPath = join(repositoryPath, ".env");
  const originalApiKey = process.env.DEEPSEEK_API_KEY;
  const originalModel = process.env.DEEPSEEK_MODEL;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_MODEL;

  try {
    await writeFile(
      environmentPath,
      "DEEPSEEK_API_KEY=test-from-env-file\nDEEPSEEK_MODEL=fixture-model\n",
    );

    assert.equal(loadContractEnvironment(environmentPath), environmentPath);
    assert.equal(process.env.DEEPSEEK_API_KEY, "test-from-env-file");
    assert.equal(process.env.DEEPSEEK_MODEL, "fixture-model");
  } finally {
    restoreEnvironmentVariable("DEEPSEEK_API_KEY", originalApiKey);
    restoreEnvironmentVariable("DEEPSEEK_MODEL", originalModel);
  }
});

test("loads a raw DeepSeek key from the existing one-line .env format", async () => {
  const repositoryPath = await createRepository();
  const environmentPath = join(repositoryPath, ".env");
  const originalApiKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;

  try {
    await writeFile(environmentPath, "sk-test-raw-deepseek-key\n");

    assert.equal(loadContractEnvironment(environmentPath), environmentPath);
    assert.equal(process.env.DEEPSEEK_API_KEY, "sk-test-raw-deepseek-key");
  } finally {
    restoreEnvironmentVariable("DEEPSEEK_API_KEY", originalApiKey);
  }
});

function modelForContract(handlerId, endpointId) {
  return new QueueModel([
    toolResponse("source-endpoint", endpointId),
    toolResponse("source-handler", handlerId),
    {
      id: "final",
      status: "completed",
      output: [],
      outputText: JSON.stringify({
        featureDossiers: [
          {
            id: "health-feature",
            title: "Health endpoint",
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
            id: "health-endpoint",
            dossierId: "health-feature",
            title: "Health endpoint",
            description: "Exposes a health response.",
            entrypointNodeIds: [endpointId],
            evidenceNodeIds: [endpointId, handlerId],
          },
        ],
        userFlows: [],
        requirements: [
          {
            id: "health-response",
            category: "behavior",
            statement: "The health handler returns an ok response.",
            evidenceNodeIds: [handlerId],
          },
        ],
        uncertainties: [],
      }),
    },
    toolResponse("review-source", handlerId),
    {
      id: "review-final",
      status: "completed",
      output: [],
      outputText: JSON.stringify({
        reviews: [
          review("feature_dossier", "health-feature", handlerId),
          review("capability", "health-endpoint", handlerId),
          review("requirement", "health-response", handlerId),
        ],
      }),
    },
  ]);
}

function review(targetKind, targetId, evidenceNodeId) {
  return {
    targetKind,
    targetId,
    hypothesis: `Review ${targetId}.`,
    status: "CONFIRMED",
    conclusion: "The source directly supports the claim.",
    evidenceNodeIds: [evidenceNodeId],
  };
}

class QueueModel {
  provider = "fixture";

  constructor(responses) {
    this.responses = responses;
  }

  async createResponse() {
    const response = this.responses.shift();
    if (response === undefined) throw new Error("Model response queue exhausted");
    return response;
  }
}

function toolResponse(callId, id) {
  return {
    id: `response-${callId}`,
    status: "completed",
    output: [
      {
        type: "function_call",
        call_id: callId,
        name: "get_source",
        arguments: JSON.stringify({ id, maxLines: null, maxBytes: null }),
      },
    ],
    outputText: null,
  };
}

async function createRepository() {
  const repositoryPath = await mkdtemp(join(tmpdir(), "build-contract-"));
  temporaryRepositories.push(repositoryPath);
  return repositoryPath;
}

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

function restoreEnvironmentVariable(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
