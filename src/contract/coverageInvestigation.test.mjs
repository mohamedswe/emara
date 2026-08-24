import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import { createContractDiscoveryTools } from "./discoveryTools.ts";
import { runCoverageInvestigation } from "./coverageInvestigation.ts";
import { reviewCoverage } from "./coverageReview.ts";

const temporaryRepositories = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

test("investigates every suspicious unknown in a separate evidence-backed pass", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "coverage-investigation-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(
    repositoryPath,
    "src/helper.ts",
    "export function helper() { return 1; }",
  );
  await writeFixture(repositoryPath, "src/isolated.ts", [
    'import { helper } from "./helper";',
    "export function isolated() { return helper(); }",
  ].join("\n"));
  const { graph } = await indexRepository(repositoryPath);
  const coverage = reviewCoverage(graph, emptyDraft());
  const isolated = graph.symbols.find((node) => node.name === "isolated");
  assert.ok(isolated);
  assert.ok(coverage.suspiciousUnknowns.some((item) => item.nodeId === isolated.id));
  const suspicious = coverage.suspiciousUnknowns.filter(
    (item) => item.nodeId === isolated.id,
  );

  const model = new QueueModel([
    finalResponse({
      investigations: [{
        nodeId: isolated.id,
        classification: "utility",
        conclusion: "The exported function is connected only to an internal helper.",
        evidenceNodeIds: ["file:src/isolated.ts"],
      }],
    }),
  ]);
  const result = await runCoverageInvestigation(
    graph,
    suspicious,
    model,
    "fixture-model",
    createContractDiscoveryTools(graph, repositoryPath),
    { maxTurns: 4, maxOutputTokens: 2_000 },
  );

  assert.equal(result.turns, 1);
  assert.equal(result.toolCalls, 1);
  assert.equal(result.investigations[0].classification, "utility");
  assert.deepEqual(result.investigations[0].evidenceNodeIds, [isolated.id]);
  assert.match(model.requests[0].instructions, /unexplained-code investigator/);
  assert.match(model.requests[0].input[0].content, /Hash-verified targetSources/);
});

class QueueModel {
  provider = "fixture";
  constructor(responses) {
    this.responses = [...responses];
    this.requests = [];
  }
  async createResponse(request) {
    this.requests.push(structuredClone(request));
    const response = this.responses.shift();
    if (response === undefined) throw new Error("Model response queue exhausted");
    return response;
  }
}

function finalResponse(value) {
  return { id: "final", status: "completed", output: [], outputText: JSON.stringify(value) };
}

function emptyDraft() {
  return {
    featureDossiers: [],
    capabilities: [],
    userFlows: [],
    requirements: [],
    uncertainties: [],
  };
}

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
