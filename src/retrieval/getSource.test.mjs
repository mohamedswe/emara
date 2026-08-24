import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import { getSource } from "./getSource.ts";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directoryPath) =>
      rm(directoryPath, { recursive: true, force: true }),
    ),
  );
});

test("retrieves an exact hash-verified symbol slice with original line endings", async () => {
  const repositoryPath = await createTemporaryDirectory("source-repository-");
  const source = [
    'import { value } from "./value.js";',
    "export function greet(name: string) {",
    "  return `Hello, ${name} — ${value}`;",
    "}",
    "export const tail = true;",
    "",
  ].join("\r\n");
  await writeFixture(repositoryPath, "src/greet.ts", source);
  await writeFixture(repositoryPath, "src/value.ts", "export const value = 1;\r\n");
  const { graph } = await indexRepository(repositoryPath);

  const result = await getSource(
    graph,
    repositoryPath,
    "function:src/greet.ts:greet",
  );
  const expectedContent = [
    "export function greet(name: string) {",
    "  return `Hello, ${name} — ${value}`;",
    "}",
  ].join("\r\n");

  assert.deepEqual(result, {
    nodeId: "function:src/greet.ts:greet",
    fileId: "file:src/greet.ts",
    path: "src/greet.ts",
    language: "typescript",
    lineRange: { start: 2, end: 4 },
    content: expectedContent,
    lineCount: 3,
    byteLength: Buffer.byteLength(expectedContent, "utf8"),
    contentHash: createHash("sha256").update(source).digest("hex"),
    integrity: "verified",
    limits: {
      maxLines: 200,
      maxBytes: 65_536,
    },
  });
  assert.equal(result.content.includes("import"), false);
  assert.equal(result.content.includes("tail"), false);
});

test("retrieves the exact registration line for an entrypoint node", async () => {
  const repositoryPath = await createTemporaryDirectory("source-entrypoint-");
  await writeFixture(
    repositoryPath,
    "src/app.ts",
    [
      "function checkout() {}",
      'router.post("/checkout", checkout);',
      "const unrelated = true;",
    ].join("\n"),
  );
  const { graph } = await indexRepository(repositoryPath);
  const entrypoint = graph.entrypoints[0];
  assert.ok(entrypoint);

  const result = await getSource(graph, repositoryPath, entrypoint.id);

  assert.equal(result.content, 'router.post("/checkout", checkout);');
  assert.deepEqual(result.lineRange, { start: 2, end: 2 });
  assert.equal(result.lineCount, 1);
  assert.equal(result.integrity, "verified");
});

test("fails closed when source content changed after graph construction", async () => {
  const repositoryPath = await createTemporaryDirectory("source-stale-");
  await writeFixture(
    repositoryPath,
    "src/app.ts",
    "export function run() { return 1; }\n",
  );
  const { graph } = await indexRepository(repositoryPath);
  await writeFixture(
    repositoryPath,
    "src/app.ts",
    "export function run() { return 2; }\n",
  );

  await assert.rejects(
    getSource(graph, repositoryPath, "function:src/app.ts:run"),
    /has changed since graph construction: expected SHA-256 .* received/,
  );
});

test("enforces explicit line and byte limits without returning partial evidence", async () => {
  const repositoryPath = await createTemporaryDirectory("source-limits-");
  const source = [
    "export function run() {",
    "  return 1;",
    "}",
  ].join("\n");
  await writeFixture(repositoryPath, "src/app.ts", source);
  const { graph } = await indexRepository(repositoryPath);
  const nodeId = "function:src/app.ts:run";

  await assert.rejects(
    getSource(graph, repositoryPath, nodeId, { maxLines: 2 }),
    /spans 3 lines, exceeding maxLines 2/,
  );
  await assert.rejects(
    getSource(graph, repositoryPath, nodeId, {
      maxBytes: Buffer.byteLength(source, "utf8") - 1,
    }),
    /exceeding maxBytes/,
  );

  const result = await getSource(graph, repositoryPath, nodeId, {
    maxLines: 3,
    maxBytes: Buffer.byteLength(source, "utf8"),
  });
  assert.equal(result.content, source);
});

test("retrieves file-wide evidence and rejects unknown, malformed, and out-of-range requests", async () => {
  const repositoryPath = await createTemporaryDirectory("source-invalid-");
  await writeFixture(repositoryPath, "src/app.ts", "export function run() {}\n");
  const { graph } = await indexRepository(repositoryPath);

  const fileSource = await getSource(graph, repositoryPath, "file:src/app.ts");
  assert.equal(fileSource.content, "export function run() {}\n");
  assert.deepEqual(fileSource.lineRange, { start: 1, end: 2 });
  await assert.rejects(
    getSource(graph, repositoryPath, "function:src/app.ts:missing"),
    /Source node not found/,
  );
  await assert.rejects(
    getSource(graph, repositoryPath, ""),
    /Source node ID must not be empty/,
  );
  await assert.rejects(
    getSource(graph, repositoryPath, "function:src/app.ts:run", {
      maxLines: 0,
    }),
    /maxLines must be a positive safe integer/,
  );
  await assert.rejects(
    getSource(graph, repositoryPath, "function:src/app.ts:run", {
      maxBytes: Number.POSITIVE_INFINITY,
    }),
    /maxBytes must be a positive safe integer/,
  );

  const outOfRangeGraph = structuredClone(graph);
  outOfRangeGraph.symbols[0].lineRange.end = 99;
  await assert.rejects(
    getSource(
      outOfRangeGraph,
      repositoryPath,
      outOfRangeGraph.symbols[0].id,
      { maxLines: 100 },
    ),
    /exceeds source length/,
  );
});

test("rejects graph paths that escape the resolved repository root", async () => {
  const parentPath = await createTemporaryDirectory("source-escape-");
  const repositoryPath = join(parentPath, "repository");
  const outsidePath = join(parentPath, "outside.ts");
  const source = "export function outside() {}\n";
  await mkdir(repositoryPath);
  await writeFile(outsidePath, source);
  const graph = {
    version: 4,
    analysis: {
      sourceFileCount: 1,
      parsedSourceFileCount: 1,
      unparsedSourceFiles: [],
      diagnostics: [],
    },
    files: [
      {
        id: "file:../outside.ts",
        type: "file",
        path: "../outside.ts",
        language: "typescript",
        contentHash: createHash("sha256").update(source).digest("hex"),
      },
    ],
    symbols: [
      {
        id: "function:../outside.ts:outside",
        type: "function",
        name: "outside",
        fileId: "file:../outside.ts",
        lineRange: { start: 1, end: 1 },
        exported: true,
      },
    ],
    entrypoints: [],
    entities: [],
    edges: [
      {
        source: "file:../outside.ts",
        target: "function:../outside.ts:outside",
        type: "CONTAINS",
        evidence: {
          file: "../outside.ts",
          line: 1,
          extractor: "tree-sitter",
        },
      },
    ],
  };

  await assert.rejects(
    getSource(graph, repositoryPath, "function:../outside.ts:outside"),
    /Graph file path escapes repository root/,
  );
});

async function createTemporaryDirectory(prefix) {
  const directoryPath = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directoryPath);
  return directoryPath;
}

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
