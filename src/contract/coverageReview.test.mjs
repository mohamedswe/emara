import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import { hydrateSoftwareContract } from "./hydrateContract.ts";
import {
  applyCoverageInvestigations,
  reviewCoverage,
} from "./coverageReview.ts";

const temporaryRepositories = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

test("finds and classifies meaningful graph regions omitted from dossiers", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "coverage-review-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "src/app.ts", [
    "function health() { return { ok: true }; }",
    'router.get("/health", health);',
    "function tinyHelper() { return 1; }",
    "export function orphanExport() { return 2; }",
    "export const appConfig = { port: 3000 };",
  ].join("\n"));
  await writeFixture(
    repositoryPath,
    "README.md",
    "# Product promise\nThe service exposes resource recommendations.\n",
  );
  const { graph } = await indexRepository(repositoryPath);
  const endpoint = graph.entrypoints.find((node) => node.kind === "http");
  const handler = graph.symbols.find((node) => node.name === "health");
  assert.ok(endpoint);
  assert.ok(handler);

  const result = reviewCoverage(graph, {
    featureDossiers: [
      {
        id: "health-feature",
        title: "Health",
        entrypoints: [endpoint.id],
        ui: [],
        handlers: [handler.id],
        services: [],
        schemas: [],
        stateTransitions: [],
        events: [],
        tests: [],
        config: [],
        documentation: [],
        evidenceNodeIds: [endpoint.id, handler.id],
        unresolvedQuestions: [],
        reachability: "reachable",
      },
    ],
    capabilities: [],
    userFlows: [],
    requirements: [],
    uncertainties: [],
  });

  const orphan = graph.symbols.find((node) => node.name === "orphanExport");
  const tiny = graph.symbols.find((node) => node.name === "tinyHelper");
  assert.ok(orphan);
  assert.ok(tiny);
  assert.ok(result.coveragePercent < 100);
  assert.ok(result.unexplained.some(
    (item) =>
      item.nodeId === orphan.id &&
      item.classification !== "dead/unreachable" &&
      item.reachability === "unknown"
  ));
  assert.ok(!result.unexplained.some((item) => item.nodeId === tiny.id));
  assert.ok(
    result.unexplained.some(
      (item) =>
        item.nodeId === "file:README.md" &&
        item.classification === "documentation",
    ),
  );
  assert.ok(
    result.unexplained.every(
      (item) => item.classification.length > 0 && item.reason.length > 0,
    ),
  );
  assert.equal(
    Object.values(result.classificationCounts).reduce((sum, count) => sum + count, 0),
    result.unexplainedMeaningfulNodes,
  );

  const investigated = applyCoverageInvestigations(result, [{
    nodeId: "file:README.md",
    classification: "utility",
    conclusion: "The file contains contributor support notes, not product behavior.",
    evidence: [],
  }]);
  assert.ok(!investigated.unaccounted.some((item) => item.nodeId === "file:README.md"));
  // The deterministic cascade already accounts for documentation files before any
  // LLM investigation, so README.md is support-accounted in the baseline result.
  assert.ok(result.supportAccountedMeaningfulNodes > 0);
  assert.ok(investigated.supportAccountedMeaningfulNodes >= result.supportAccountedMeaningfulNodes);
});

test("counts containing files and uncertainties as contract coverage", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "coverage-containment-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "src/models.py", [
    "class RequestModel:",
    "    pass",
    "class ResponseModel:",
    "    pass",
  ].join("\n"));
  await writeFixture(repositoryPath, "src/orphan.py", [
    "class DynamicPlugin:",
    "    pass",
  ].join("\n"));
  const { graph } = await indexRepository(repositoryPath);
  const request = graph.symbols.find((node) => node.name === "RequestModel");
  const response = graph.symbols.find((node) => node.name === "ResponseModel");
  const plugin = graph.symbols.find((node) => node.name === "DynamicPlugin");
  assert.ok(request);
  assert.ok(response);
  assert.ok(plugin);

  const result = reviewCoverage(graph, {
    featureDossiers: [{
      id: "models",
      title: "Models",
      entrypoints: [],
      ui: [],
      handlers: [],
      services: [],
      schemas: ["file:src/models.py"],
      stateTransitions: [],
      events: [],
      tests: [],
      config: [],
      documentation: [],
      evidenceNodeIds: ["file:src/models.py"],
      unresolvedQuestions: [],
      reachability: "unknown",
    }],
    capabilities: [],
    userFlows: [],
    requirements: [],
    uncertainties: [{
      id: "dynamic-plugin",
      statement: "Dynamic plugin registration cannot be resolved statically.",
      reason: "No static registration edge exists.",
      evidenceNodeIds: [plugin.id],
    }],
  });

  assert.ok(!result.unexplained.some((item) => item.nodeId === request.id));
  assert.ok(!result.unexplained.some((item) => item.nodeId === response.id));
  assert.ok(!result.unexplained.some((item) => item.nodeId === plugin.id));
});

test("accounts nested handlers through a covered enclosing component", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "coverage-lexical-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "src/FilesPanel.tsx", [
    "function validateFile() {}",
    "function uploadFile() {}",
    "function recordUpload() {}",
    "export function FilesPanel() {",
    "  function handleFiles() {",
    "    validateFile();",
    "    uploadFile();",
    "    recordUpload();",
    "  }",
    "  return <button onClick={handleFiles}>Upload</button>;",
    "}",
  ].join("\n"));
  const { graph } = await indexRepository(repositoryPath);
  const component = graph.entities.find(
    (node) => node.type === "component" && node.name === "FilesPanel",
  );
  const handler = graph.symbols.find((node) => node.name === "handleFiles");
  assert.ok(component);
  assert.ok(handler);

  const result = reviewCoverage(graph, {
    featureDossiers: [{
      id: "files-panel",
      title: "Files panel",
      entrypoints: [],
      ui: [component.id],
      handlers: [],
      services: [],
      schemas: [],
      stateTransitions: [],
      events: [],
      tests: [],
      config: [],
      documentation: [],
      evidenceNodeIds: [component.id],
      unresolvedQuestions: [],
      reachability: "reachable",
    }],
    capabilities: [],
    userFlows: [],
    requirements: [],
    uncertainties: [],
  });

  assert.ok(!result.unexplained.some((item) => item.nodeId === handler.id));
});

test("counts deterministic support code as accounted without inventing product claims", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "coverage-support-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "package.json", '{"name":"support-only"}\n');
  await writeFixture(repositoryPath, "backend/test_chat_quality.py", [
    "def test_quality():",
    "    assert True",
    "if __name__ == '__main__':",
    "    test_quality()",
  ].join("\n"));
  const { graph } = await indexRepository(repositoryPath);
  const result = reviewCoverage(graph, {
    featureDossiers: [],
    capabilities: [],
    userFlows: [],
    requirements: [],
    uncertainties: [],
  });

  assert.ok(result.unexplainedMeaningfulNodes > 0);
  assert.equal(result.unaccountedMeaningfulNodes, 0);
  assert.equal(result.accountedMeaningfulNodes, result.meaningfulNodes);
  assert.equal(result.coveragePercent, 100);
  assert.ok(result.supportAccountedMeaningfulNodes > 0);
  assert.deepEqual(graph.entrypoints, []);

  const testSymbol = graph.symbols.find((node) => node.name === "test_quality");
  assert.ok(testSymbol);
  const contract = hydrateSoftwareContract(
    graph,
    {
      featureDossiers: [],
      capabilities: [],
      userFlows: [],
      requirements: [],
      uncertainties: [{
        id: "test-observation",
        statement: "A test harness exists.",
        reason: "This assertion checks evidence-role classification.",
        evidenceNodeIds: [testSymbol.id],
      }],
    },
    {
      provider: "fixture",
      model: "fixture",
      toolCallCount: 1,
      reviewTurnCount: 0,
      coverageInvestigationTurnCount: 0,
      correctionConverged: true,
      inspectedNodeIds: [testSymbol.id],
    },
    [],
    [],
  );
  assert.equal(contract.uncertainties[0].evidence[0].role, "test");

  assert.throws(
    () => hydrateSoftwareContract(
      graph,
      {
        featureDossiers: [{
          id: "chat-quality-test",
          title: "Chat quality test",
          entrypoints: [],
          ui: [],
          handlers: [testSymbol.id],
          services: [],
          schemas: [],
          stateTransitions: [],
          events: [],
          tests: [`test:backend/test_chat_quality.py`],
          config: [],
          documentation: [],
          evidenceNodeIds: [testSymbol.id],
          unresolvedQuestions: [],
          reachability: "test_only",
        }],
        capabilities: [],
        userFlows: [],
        requirements: [],
        uncertainties: [],
      },
      {
        provider: "fixture",
        model: "fixture",
        toolCallCount: 1,
        reviewTurnCount: 1,
        coverageInvestigationTurnCount: 0,
        correctionConverged: true,
        inspectedNodeIds: [testSymbol.id],
      },
      [{
        targetKind: "feature_dossier",
        targetId: "chat-quality-test",
        hypothesis: "The test is a product feature.",
        status: "CONFIRMED",
        conclusion: "Fixture review.",
        evidenceNodeIds: [testSymbol.id],
      }],
      [],
    ),
    /supported only by test evidence/u,
  );
});

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
