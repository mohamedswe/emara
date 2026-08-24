import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import { validateRepositoryGraph } from "../graph/validateRepositoryGraph.ts";

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "frameworks",
);
const temporaryRepositories = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    ),
  );
});

for (const fixture of [
  { name: "fastapi-app", framework: "python-http", entrypoint: "GET /users/{user_id}" },
  { name: "django-app", framework: "django", entrypoint: "HTTP health/" },
  { name: "next-app", framework: "javascript-application", entrypoint: "GET /users/:id" },
  { name: "hono-app", framework: "edge-http", entrypoint: "GET /health" },
  { name: "vue-app", framework: "vue-family", entrypoint: "PAGE /users" },
  { name: "knex-app", framework: "knex", entrypoint: "Knex migration up" },
]) {
  test(`indexes pinned ${fixture.name} compatibility application`, async () => {
    const repositoryPath = await copyFixture(fixture.name);
    const result = await indexRepository(repositoryPath);

    validateRepositoryGraph(result.graph);
    assert.deepEqual(result.support.unparsedSourceFiles, []);
    assert.ok(
      result.support.frameworks.some((item) => item.id === fixture.framework),
      `expected ${fixture.framework}; got ${result.support.frameworks.map((item) => item.id).join(", ")}`,
    );
    assert.ok(
      result.graph.entrypoints.some((item) => item.name === fixture.entrypoint),
      `expected ${fixture.entrypoint}; got ${result.graph.entrypoints.map((item) => item.name).join(", ")}`,
    );
  });
}

async function copyFixture(name) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "software-auditor-framework-"));
  const repositoryPath = join(temporaryRoot, basename(name));
  temporaryRepositories.push(temporaryRoot);
  await cp(join(fixtureRoot, name), repositoryPath, { recursive: true });
  return repositoryPath;
}
