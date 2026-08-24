import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { indexRepository } from "./indexRepository.ts";
import { validateRepositoryGraph } from "./validateRepositoryGraph.ts";

const temporaryRepositories = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((repositoryPath) =>
      rm(repositoryPath, { recursive: true, force: true }),
    ),
  );
});

test("indexes a repository and persists a repeatable self-excluding graph.json", async () => {
  const repositoryPath = await createTemporaryRepository();
  await writeFixture(
    repositoryPath,
    "src/worker.ts",
    "export function run() {}\n",
  );
  await writeFixture(
    repositoryPath,
    "src/index.ts",
    [
      'import { run } from "./worker.js";',
      "export function start() {",
      "  run();",
      "}",
      "function health() {}",
      'router.get("/health", health);',
    ].join("\n"),
  );

  const first = await indexRepository(repositoryPath);
  const firstContents = await readFile(first.outputPath, "utf8");
  const second = await indexRepository(repositoryPath);
  const secondContents = await readFile(second.outputPath, "utf8");
  const persistedGraph = JSON.parse(secondContents);

  assert.equal(first.outputPath, join(repositoryPath, "graph.json"));
  assert.equal(secondContents, firstContents);
  assert.deepEqual(second.graph, first.graph);
  assert.equal(persistedGraph.version, 4);
  assert.deepEqual(persistedGraph.analysis, {
    sourceFileCount: 2,
    parsedSourceFileCount: 2,
    unparsedSourceFiles: [],
    diagnostics: [],
  });
  assert.deepEqual(persistedGraph.entrypoints, [
    {
      id: "entrypoint:http:src/index.ts:6:GET /health",
      type: "entrypoint",
      kind: "http",
      name: "GET /health",
      exposure: "external",
      httpMethod: "GET",
      route: "/health",
      fileId: "file:src/index.ts",
      handlerSymbolId: "function:src/index.ts:health",
      lineRange: { start: 6, end: 6 },
      evidence: {
        file: "src/index.ts",
        line: 6,
        extractor: "tree-sitter",
      },
    },
  ]);
  assert.equal(persistedGraph.files.some((file) => file.path === "graph.json"), false);
  assert.deepEqual(
    Object.fromEntries(
      ["CONTAINS", "IMPORTS", "CALLS"].map((type) => [
        type,
        persistedGraph.edges.filter((edge) => edge.type === type).length,
      ]),
    ),
    { CONTAINS: 5, IMPORTS: 1, CALLS: 1 },
  );
  validateRepositoryGraph(persistedGraph);
});

test("resolves a relative custom output path from the repository root", async () => {
  const repositoryPath = await createTemporaryRepository();
  await writeFixture(repositoryPath, "src/index.ts", "export function run() {}\n");

  const result = await indexRepository(repositoryPath, {
    outputPath: "artifacts/graph.json",
  });

  assert.equal(result.outputPath, join(repositoryPath, "artifacts", "graph.json"));
  assert.equal(
    result.graph.files.some((file) => file.path === "artifacts/graph.json"),
    false,
  );
});

test("excludes generated contract artifacts from repeated indexing", async () => {
  const repositoryPath = await createTemporaryRepository();
  await writeFixture(repositoryPath, "src/index.ts", "export function run() {}\n");
  await writeFixture(repositoryPath, "contract.yaml", "version: 1\n");

  const result = await indexRepository(repositoryPath, {
    excludePaths: ["contract.yaml"],
  });

  assert.equal(
    result.graph.files.some((file) => file.path === "contract.yaml"),
    false,
  );
  await assert.rejects(
    indexRepository(repositoryPath, { excludePaths: [""] }),
    /Excluded path must not be empty/,
  );
});

test("indexes Python applications and reports detected framework support", async () => {
  const repositoryPath = await createTemporaryRepository();
  await writeFixture(repositoryPath, "requirements.txt", "fastapi==0.1\n");
  await writeFixture(repositoryPath, "app/services.py", [
    "def load_user(user_id):",
    "    return user_id",
  ].join("\n"));
  await writeFixture(repositoryPath, "app/api.py", [
    "from fastapi import FastAPI",
    "from .services import load_user",
    "app = FastAPI()",
    "@app.get('/users/{user_id}')",
    "def get_user(user_id):",
    "    return load_user(user_id)",
  ].join("\n"));

  const result = await indexRepository(repositoryPath);

  assert.ok(result.graph.files.some((file) =>
    file.path === "app/api.py" && file.language === "python"
  ));
  assert.ok(result.graph.entrypoints.some((entrypoint) =>
    entrypoint.name === "GET /users/{user_id}" &&
    entrypoint.handlerSymbolId === "function:app/api.py:get_user"
  ));
  assert.ok(result.graph.edges.some((edge) =>
    edge.type === "CALLS" &&
    edge.source === "function:app/api.py:get_user" &&
    edge.target === "function:app/services.py:load_user"
  ));
  assert.deepEqual(result.support.unparsedSourceFiles, []);
  assert.ok(result.support.frameworks.some((framework) =>
    framework.id === "python-http" && framework.support === "semantic"
  ));
  validateRepositoryGraph(result.graph);
});

test("loads JSONC TypeScript aliases and applies them to imports and calls", async () => {
  const repositoryPath = await createTemporaryRepository();
  await writeFixture(repositoryPath, "frontend/tsconfig.json", [
    "{",
    "  // Application-local import alias",
    '  "compilerOptions": {',
    '    "baseUrl": ".",',
    '    "paths": { "@/*": ["./*"], },',
    "  },",
    "}",
  ].join("\n"));
  await writeFixture(repositoryPath, "frontend/lib/api.ts", [
    "export function send() {}",
  ].join("\n"));
  await writeFixture(repositoryPath, "frontend/app/page.ts", [
    'import { send } from "@/lib/api";',
    "export function page() {",
    "  send();",
    "}",
  ].join("\n"));

  const result = await indexRepository(repositoryPath);

  assert.ok(result.graph.edges.some((edge) =>
    edge.type === "IMPORTS" &&
    edge.source === "file:frontend/app/page.ts" &&
    edge.target === "file:frontend/lib/api.ts"
  ));
  assert.ok(result.graph.edges.some((edge) =>
    edge.type === "CALLS" &&
    edge.source === "function:frontend/app/page.ts:page" &&
    edge.target === "function:frontend/lib/api.ts:send"
  ));
});

test("keeps files with parser diagnostics visible without indexing partial symbols", async () => {
  const repositoryPath = await createTemporaryRepository();
  await writeFixture(repositoryPath, "src/valid.ts", "export function valid() {}\n");
  await writeFixture(repositoryPath, "src/broken.ts", "export function broken(\n");

  const result = await indexRepository(repositoryPath);

  assert.ok(result.graph.files.some((file) => file.path === "src/broken.ts"));
  assert.ok(result.graph.symbols.some((symbol) => symbol.name === "valid"));
  assert.ok(!result.graph.symbols.some((symbol) => symbol.fileId === "file:src/broken.ts"));
  assert.ok(result.support.unparsedSourceFiles.includes("src/broken.ts"));
  assert.ok(result.support.diagnostics.some((diagnostic) =>
    diagnostic.kind === "parse-error" && diagnostic.file === "src/broken.ts"
  ));
  assert.deepEqual(result.graph.analysis.unparsedSourceFiles, ["src/broken.ts"]);
  assert.equal(result.graph.analysis.sourceFileCount, 2);
  assert.equal(result.graph.analysis.parsedSourceFileCount, 1);
  assert.ok(result.graph.analysis.diagnostics.some((diagnostic) =>
    diagnostic.kind === "parse-error" && diagnostic.file === "src/broken.ts"
  ));
  validateRepositoryGraph(result.graph);
});

async function createTemporaryRepository() {
  const repositoryPath = await mkdtemp(
    join(tmpdir(), "software-auditor-indexer-"),
  );
  temporaryRepositories.push(repositoryPath);
  return repositoryPath;
}

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
