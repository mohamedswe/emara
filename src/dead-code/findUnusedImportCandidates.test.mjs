import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import { findUnusedImportCandidates } from "./findUnusedImportCandidates.ts";

test("finds an unused Python import without promoting it to safe deletion", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "dead-import-python-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(
    repositoryPath,
    "app.py",
    [
      "from models import Used, UserResponse",
      "",
      "def handler():",
      "    return Used()",
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "models.py",
    [
      "class Used:",
      "    pass",
      "",
      "class UserResponse:",
      "    pass",
    ].join("\n"),
  );

  const { graph, sourceFiles } = await indexRepository(repositoryPath);
  const uncachedCandidates = await findUnusedImportCandidates(
    graph,
    repositoryPath,
  );
  const candidates = await findUnusedImportCandidates(
    graph,
    repositoryPath,
    sourceFiles,
  );

  assert.deepEqual(candidates, uncachedCandidates);

  assert.deepEqual(
    candidates.map((candidate) => [candidate.file, candidate.line, candidate.symbol]),
    [["app.py", 1, "UserResponse"]],
  );
  assert.equal(candidates[0]?.verdict, "VALIDATION_REQUIRED");
  assert.equal(candidates[0]?.validation, null);
});

test("skips comments, same-line ambiguity, duplicate bindings, and test files conservatively", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "dead-import-guards-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(
    repositoryPath,
    "app.py",
    [
      "import alpha; alpha.run()",
      "import beta",
      "# beta is intentionally named in a comment, so lexical evidence keeps it",
      "from first import Same",
      "from second import Same",
    ].join("\n"),
  );
  await writeFixture(repositoryPath, "tests/test_app.py", "import definitely_unused\n");

  const { graph } = await indexRepository(repositoryPath);
  const candidates = await findUnusedImportCandidates(graph, repositoryPath);

  assert.deepEqual(candidates, []);
});

test("keeps Pydantic Field calls while reporting an import-only Field binding", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "dead-import-pydantic-field-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(
    repositoryPath,
    "models/used.py",
    [
      "from pydantic import Field",
      "",
      "class UsedModel:",
      "    active: bool = Field(default=True)",
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "models/car.py",
    "from pydantic import Field",
  );

  const { graph } = await indexRepository(repositoryPath);
  const candidates = await findUnusedImportCandidates(graph, repositoryPath);

  assert.deepEqual(
    candidates.map((candidate) => [candidate.file, candidate.symbol]),
    [["models/car.py", "Field"]],
  );
});

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${content}\n`);
}
