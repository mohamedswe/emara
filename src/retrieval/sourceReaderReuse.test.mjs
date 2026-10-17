import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createContractDiscoveryTools } from "../contract/discoveryTools.ts";
import { findDeadCodeCandidates } from "../dead-code/findDeadCodeCandidates.ts";
import { filterFrameworkWiringCandidates } from "../dead-code/filterFrameworkWiringCandidates.ts";
import { findMechanicalDeadCodeCandidates } from "../dead-code/findMechanicalDeadCodeCandidates.ts";
import { findUnusedImportCandidates } from "../dead-code/findUnusedImportCandidates.ts";
import { indexRepository } from "../graph/indexRepository.ts";

const NAMES = ["alpha", "beta", "gamma", "delta"];

async function pythonRepository(context) {
  const repositoryPath = await mkdtemp(join(tmpdir(), "source-reader-reuse-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  for (const name of NAMES) {
    await writeFile(join(repositoryPath, `${name}.py`), `import os\n\ndef ${name}_handler():\n    return 1\n`);
  }
  return repositoryPath;
}

/** validateRepositoryGraph reads graph.version exactly once per run. */
function countValidations(graph) {
  const counter = { count: 0 };
  Object.defineProperty(graph, "version", {
    configurable: true,
    get() { counter.count += 1; return 4; },
  });
  return counter;
}

test("unused-import sweep validates the graph once, and not at all for indexed sources", async (context) => {
  const repositoryPath = await pythonRepository(context);
  const { graph, sourceFiles } = await indexRepository(repositoryPath);
  const validations = countValidations(graph);
  assert.equal((await findUnusedImportCandidates(graph, repositoryPath)).length, NAMES.length);
  assert.equal(validations.count, 1);
  validations.count = 0;
  await findUnusedImportCandidates(graph, repositoryPath, sourceFiles);
  assert.equal(validations.count, 0);
});

test("mechanical dead-code sweep validates the graph once for all fallback reads", async (context) => {
  const repositoryPath = await pythonRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const validations = countValidations(graph);
  await findMechanicalDeadCodeCandidates(graph, repositoryPath);
  assert.equal(validations.count, 1);
});

test("framework-wiring filter validates the graph once across candidate files", async (context) => {
  const repositoryPath = await pythonRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const candidates = findDeadCodeCandidates(graph);
  assert.ok(new Set(candidates.map((candidate) => candidate.file)).size >= 2);
  const validations = countValidations(graph);
  await filterFrameworkWiringCandidates(candidates, graph, repositoryPath);
  assert.equal(validations.count, 1);
});

test("discovery tools validate at creation and reuse one reader for every get_source call", async (context) => {
  const repositoryPath = await pythonRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const validations = countValidations(graph);
  const tools = createContractDiscoveryTools(graph, repositoryPath);
  for (const name of NAMES) {
    const result = await tools.execute("get_source", { id: `file:${name}.py`, maxLines: null, maxBytes: null });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  assert.equal(validations.count, 2);
});
