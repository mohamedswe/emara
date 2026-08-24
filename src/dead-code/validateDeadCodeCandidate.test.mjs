import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import { findDeadCodeCandidates } from "./findDeadCodeCandidates.ts";
import { findUnusedImportCandidates } from "./findUnusedImportCandidates.ts";
import { validateDeadCodeCandidate } from "./validateDeadCodeCandidate.ts";

test("promotes a disconnected file only after isolated commands and feature fingerprint pass", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const candidate = findDeadCodeCandidates(graph).find((value) =>
    value.file === "dead.js"
  );
  assert.ok(candidate);

  const result = await validateDeadCodeCandidate(
    graph,
    repositoryPath,
    candidate,
    [{ command: process.execPath, args: ["--check", "app.js"] }],
  );

  assert.equal(result.candidate.verdict, "VALIDATED_SAFE_TO_DELETE");
  assert.equal(result.candidate.validation?.passed, true);
  assert.equal(
    result.candidate.validation?.featureFingerprintUnchanged,
    true,
  );
});

test("keeps a candidate validation-required when an isolated command fails", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const candidate = findDeadCodeCandidates(graph).find((value) =>
    value.file === "dead.js"
  );
  assert.ok(candidate);

  const result = await validateDeadCodeCandidate(
    graph,
    repositoryPath,
    candidate,
    [{ command: process.execPath, args: ["--check", "missing.js"] }],
  );

  assert.equal(result.candidate.verdict, "VALIDATION_REQUIRED");
  assert.equal(result.candidate.validation?.passed, false);
  assert.notEqual(result.commandResults[0]?.exitCode, 0);
});

test("removes one unused Python import binding in isolation", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "delete-import-fixture-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(
    repositoryPath,
    "service.py",
    [
      "from models import Used, Unused",
      "def handler():",
      "    return Used()",
    ].join("\n"),
  );
  await writeFixture(repositoryPath, "models.py", "class Used:\n    pass\nclass Unused:\n    pass");
  const { graph } = await indexRepository(repositoryPath);
  const candidate = (await findUnusedImportCandidates(graph, repositoryPath))
    .find((value) => value.symbol === "Unused");
  assert.ok(candidate);

  const result = await validateDeadCodeCandidate(
    graph,
    repositoryPath,
    candidate,
    [{
      command: process.execPath,
      args: [
        "-e",
        "const s=require('fs').readFileSync('service.py','utf8');if(/import[^\\n]*Unused/.test(s))process.exit(1)",
      ],
    }],
  );

  assert.equal(result.candidate.verdict, "VALIDATED_SAFE_TO_DELETE");
});

async function fixtureRepository(context) {
  const repositoryPath = await mkdtemp(join(tmpdir(), "delete-validation-fixture-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(
    repositoryPath,
    "app.js",
    [
      "function health() { return { ok: true }; }",
      "router.get('/health', health);",
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "dead.js",
    "export function dormant() { return 'unused'; }",
  );
  return repositoryPath;
}

async function writeFixture(repositoryPath, relativePath, content) {
  const path = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${content}\n`);
}
