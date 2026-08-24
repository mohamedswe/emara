import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  serializeRepositoryGraph,
  writeRepositoryGraph,
} from "./persistRepositoryGraph.ts";
import { validateRepositoryGraph } from "./validateRepositoryGraph.ts";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directoryPath) =>
      rm(directoryPath, { recursive: true, force: true }),
    ),
  );
});

test("serializes formatted deterministic JSON with a trailing newline", () => {
  const graph = emptyGraph();
  const serialized = serializeRepositoryGraph(graph);

  assert.equal(serialized, `${JSON.stringify(graph, null, 2)}\n`);
  assert.deepEqual(JSON.parse(serialized), graph);
});

test("validates before atomically replacing graph.json", async () => {
  const directoryPath = await createTemporaryDirectory();
  const outputPath = join(directoryPath, "nested", "graph.json");
  const graph = emptyGraph();

  assert.equal(
    await writeRepositoryGraph(graph, outputPath),
    outputPath,
  );
  assert.equal(await readFile(outputPath, "utf8"), serializeRepositoryGraph(graph));

  const invalidGraph = { ...graph, version: 1 };
  await assert.rejects(
    writeRepositoryGraph(invalidGraph, outputPath),
    /Invalid repository graph/,
  );
  assert.equal(await readFile(outputPath, "utf8"), serializeRepositoryGraph(graph));

  const entries = await readdir(join(directoryPath, "nested"));
  assert.deepEqual(entries, ["graph.json"]);
  validateRepositoryGraph(JSON.parse(await readFile(outputPath, "utf8")));
});

test("rejects an empty output path before writing", async () => {
  await assert.rejects(
    writeRepositoryGraph(emptyGraph(), ""),
    /Graph output path must not be empty/,
  );
});

async function createTemporaryDirectory() {
  const directoryPath = await mkdtemp(
    join(tmpdir(), "software-auditor-persistence-"),
  );
  temporaryDirectories.push(directoryPath);
  return directoryPath;
}

function emptyGraph() {
  return {
    version: 4,
    analysis: {
      sourceFileCount: 0,
      parsedSourceFileCount: 0,
      unparsedSourceFiles: [],
      diagnostics: [],
    },
    files: [],
    symbols: [],
    entrypoints: [],
    entities: [],
    edges: [],
  };
}
