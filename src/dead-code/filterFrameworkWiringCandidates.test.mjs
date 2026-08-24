import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import { buildReachabilityLedger } from "../retrieval/reachabilityLedger.ts";
import { findDeadCodeCandidates } from "./findDeadCodeCandidates.ts";
import { filterFrameworkWiringCandidates } from "./filterFrameworkWiringCandidates.ts";

const temporaryRepositories = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("framework decorators and module wiring keep Python functions alive", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "framework-wiring-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "backend/main.py", [
    "@app.on_event('startup')",
    "async def startup_event():",
    "    create_task(cleanup_task())",
    "",
    "@app.on_event('shutdown')",
    "async def shutdown_event():",
    "    return None",
    "",
    "async def cleanup_task():",
    "    return None",
    "",
    "@app.exception_handler(404)",
    "async def not_found_handler(request, exc):",
    "    return None",
    "",
    "@app.exception_handler(500)",
    "async def internal_error_handler(request, exc):",
    "    return None",
    "",
    "def decorator_argument():",
    "    return None",
    "",
    "@registry.register(decorator_argument)",
    "def decorator_registered_handler():",
    "    return None",
    "",
    "def unused_function():",
    "    return None",
  ].join("\n"));
  await writeFixture(repositoryPath, "backend/config.py", [
    "def get_origins():",
    "    return []",
    "",
    "CORS_ORIGINS = get_origins()",
  ].join("\n"));

  const { graph } = await indexRepository(repositoryPath);
  const raw = findDeadCodeCandidates(graph, {
    reachabilityLedger: buildReachabilityLedger(graph),
  });
  const filtered = await filterFrameworkWiringCandidates(raw, graph, repositoryPath);
  const symbols = new Set(filtered.map((candidate) => candidate.symbol));

  for (const alive of [
    "startup_event",
    "shutdown_event",
    "cleanup_task",
    "not_found_handler",
    "internal_error_handler",
    "decorator_argument",
    "decorator_registered_handler",
    "get_origins",
  ]) {
    assert.equal(symbols.has(alive), false, alive);
  }
  assert.equal(symbols.has("unused_function"), true);
});

test("FastAPI dependency defaults keep imported dependency functions alive", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "fastapi-dependency-wiring-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "backend/dependencies.py", [
    "def get_current_user_with_company():",
    "    return None",
    "",
    "def unused_dependency():",
    "    return None",
  ].join("\n"));
  await writeFixture(repositoryPath, "backend/routes.py", [
    "from .dependencies import get_current_user_with_company",
    "",
    "@router.get('/cars')",
    "async def list_cars(user=Depends(get_current_user_with_company)):",
    "    return []",
  ].join("\n"));

  const { graph } = await indexRepository(repositoryPath);
  const raw = findDeadCodeCandidates(graph, {
    reachabilityLedger: buildReachabilityLedger(graph),
  });
  const filtered = await filterFrameworkWiringCandidates(raw, graph, repositoryPath);
  const symbols = new Set(filtered.map((candidate) => candidate.symbol));

  assert.equal(symbols.has("get_current_user_with_company"), false);
  assert.equal(symbols.has("unused_dependency"), true);
});

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
