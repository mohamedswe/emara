import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { parseArguments } from "./runFunctionalityAudit.ts";

test("defaults output artifacts inside the target repository", () => {
  const repositoryPath = resolve("fixture-repository");
  const options = parseArguments([repositoryPath, "--deterministic"]);

  assert.equal(options.repositoryPath, repositoryPath);
  assert.equal(
    options.outputPath,
    resolve(repositoryPath, "audit-output", "functionality-audit.json"),
  );
  assert.equal(
    options.graphPath,
    resolve(repositoryPath, "audit-output", "graph.json"),
  );
  assert.equal(options.deterministic, true);
});

test("accepts deterministic as a valueless flag among valued options", () => {
  const options = parseArguments([
    "fixture-repository",
    "--model=deepseek-chat",
    "--deterministic",
    "--expected-commit",
    "abc123",
  ]);

  assert.equal(options.deterministic, true);
  assert.equal(options.model, "deepseek-chat");
  assert.equal(options.expectedCommit, "abc123");
});
