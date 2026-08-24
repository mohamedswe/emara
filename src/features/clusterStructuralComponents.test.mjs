import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import { clusterStructuralComponents } from "./clusterStructuralComponents.ts";

const temporaryRepositories = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    ),
  );
});

test("finds deterministic structural modules without entrypoints", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "structural-components-"));
  temporaryRepositories.push(repositoryPath);
  await Promise.all([
    writeFixture(
      repositoryPath,
      "src/graph/build.ts",
      "import { nodeId } from './node.ts';\nexport function buildGraph() { return nodeId(); }",
    ),
    writeFixture(
      repositoryPath,
      "src/graph/node.ts",
      "export function nodeId() { return 'node'; }",
    ),
    writeFixture(
      repositoryPath,
      "src/contract/build.ts",
      "import { validate } from './validate.ts';\nexport function buildContract() { return validate(); }",
    ),
    writeFixture(
      repositoryPath,
      "src/contract/validate.ts",
      "export function validate() { return true; }",
    ),
    writeFixture(
      repositoryPath,
      "src/dead-code/find.ts",
      "export function findDeadCode() { return []; }",
    ),
    writeFixture(
      repositoryPath,
      "README.md",
      "# Example\nThis file is documentation, not a code component.",
    ),
  ]);

  const { graph } = await indexRepository(repositoryPath);
  assert.equal(graph.entrypoints.length, 0);
  const first = clusterStructuralComponents(graph);
  const reordered = clusterStructuralComponents({
    ...graph,
    files: [...graph.files].reverse(),
    symbols: [...graph.symbols].reverse(),
    entrypoints: [...graph.entrypoints].reverse(),
    entities: [...graph.entities].reverse(),
    edges: [...graph.edges].reverse(),
  });

  assert.deepEqual(reordered, first);
  assert.equal(first.algorithm, "leiden-modularity");
  assert.equal(first.randomSeed, 42);
  assert.ok(first.components.some((component) => component.label === "Graph"));
  assert.ok(first.components.some((component) => component.label === "Contract"));
  assert.ok(first.components.some((component) => component.label === "Dead Code"));
  assert.ok(
    first.excludedFileNodeIds.includes("file:README.md"),
    "documentation files must not become implementation components",
  );
  assert.ok(
    first.components.every((component) =>
      component.memberNodeIds.some((nodeId) => nodeId.startsWith("file:"))
    ),
  );
});

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
