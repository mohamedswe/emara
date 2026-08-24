import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import {
  CONTRACT_DISCOVERY_TOOL_DEFINITIONS,
  createContractDiscoveryTools,
} from "./discoveryTools.ts";

const temporaryRepositories = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((repositoryPath) =>
      rm(repositoryPath, { recursive: true, force: true }),
    ),
  );
});

test("exposes strict bounded discovery and exact navigation tools", () => {
  assert.deepEqual(
    CONTRACT_DISCOVERY_TOOL_DEFINITIONS.map((tool) => tool.name),
    [
      "search_graph",
      "get_node",
      "get_neighbors",
      "get_source",
      "get_sources",
      "list_endpoints",
      "search_symbols",
      "list_files",
      "find_definition",
      "find_references",
      "find_callers",
      "find_callees",
      "find_importers",
      "find_consumers",
      "is_reachable",
      "find_paths_from_entrypoints",
      "find_paths_to_external_behavior",
    ],
  );
  assert.ok(
    CONTRACT_DISCOVERY_TOOL_DEFINITIONS.every(
      (tool) =>
        tool.type === "function" &&
        tool.strict === true &&
        tool.parameters.additionalProperties === false,
    ),
  );
});

test("queries graph structure and marks only successful exact source inspections", async () => {
  const repositoryPath = await createRepository();
  await writeFixture(
    repositoryPath,
    "src/app.ts",
    [
      'import { work } from "./worker.js";',
      "function health() { return true; }",
      "export function start() { work(); }",
      'router.get("/health", health);',
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "src/worker.ts",
    "export function work() { return 1; }\n",
  );
  const { graph } = await indexRepository(repositoryPath);
  const tools = createContractDiscoveryTools(graph, repositoryPath);

  const endpoints = await tools.execute("list_endpoints", {
    kind: null,
    offset: null,
    limit: 999,
  });
  assert.equal(endpoints.ok, true);
  assert.equal(endpoints.value.items.length, 1);
  assert.equal(endpoints.value.limit, 100);

  const symbolSearch = await tools.execute("search_symbols", {
    query: "health",
    kind: "function",
    exported: false,
    limit: null,
  });
  assert.equal(symbolSearch.ok, true);
  assert.equal(
    symbolSearch.value.matches[0].symbol.id,
    "function:src/app.ts:health",
  );

  const definition = await tools.execute("find_definition", {
    symbol: "work",
  });
  assert.equal(definition.ok, true);
  assert.equal(
    definition.value.results[0].nodeId,
    "function:src/worker.ts:work",
  );

  const callers = await tools.execute("find_callers", { symbol: "work" });
  assert.equal(callers.ok, true);
  assert.equal(
    callers.value.results[0].nodeId,
    "function:src/app.ts:start",
  );

  const importers = await tools.execute("find_importers", { symbol: "work" });
  assert.equal(importers.ok, true);
  assert.equal(importers.value.results[0].nodeId, "file:src/app.ts");

  const reachability = await tools.execute("is_reachable", {
    id: "function:src/app.ts:health",
    maxDepth: null,
    maxPaths: null,
  });
  assert.equal(reachability.ok, true);
  assert.equal(reachability.value.status, "reachable");

  const graphSearch = await tools.execute("search_graph", {
    query: "start",
    maxSeeds: null,
    maxDepth: 1,
    maxNodes: 999,
    maxEdges: 999,
  });
  assert.equal(graphSearch.ok, true);
  assert.equal(graphSearch.value.limits.maxNodes, 50);
  assert.equal(graphSearch.value.limits.maxEdges, 100);

  const node = await tools.execute("get_node", {
    id: "function:src/app.ts:start",
  });
  assert.equal(node.ok, true);
  assert.equal(node.value.ownerFile.path, "src/app.ts");

  const neighbors = await tools.execute("get_neighbors", {
    id: "function:src/app.ts:start",
    direction: "outgoing",
    edgeTypes: ["CALLS"],
    limit: null,
  });
  assert.equal(neighbors.ok, true);
  assert.deepEqual(
    neighbors.value.neighbors.map((item) => item.node.id),
    ["function:src/worker.ts:work"],
  );

  const files = await tools.execute("list_files", {
    query: "src",
    language: "typescript",
    offset: 0,
    limit: 1,
  });
  assert.equal(files.ok, true);
  assert.equal(files.value.items.length, 1);
  assert.equal(files.value.nextOffset, 1);

  const fileSource = await tools.execute("get_source", {
    id: "file:src/app.ts",
    maxLines: null,
    maxBytes: null,
  });
  assert.equal(fileSource.ok, true);
  assert.match(fileSource.value.content, /function health/);
  assert.deepEqual(tools.inspectedNodeIds(), ["file:src/app.ts"]);

  const source = await tools.execute("get_source", {
    id: "function:src/app.ts:health",
    maxLines: null,
    maxBytes: null,
  });
  assert.equal(source.ok, true);
  assert.equal(source.value.content, "function health() { return true; }");
  assert.deepEqual(tools.inspectedNodeIds(), [
    "file:src/app.ts",
    "function:src/app.ts:health",
  ]);

  const sources = await tools.execute("get_sources", {
    ids: ["function:src/app.ts:start", "function:src/worker.ts:work"],
    maxLines: null,
    maxBytes: null,
  });
  assert.equal(sources.ok, true);
  assert.deepEqual(
    sources.value.sources.map((item) => item.nodeId),
    ["function:src/app.ts:start", "function:src/worker.ts:work"],
  );
  assert.deepEqual(tools.inspectedNodeIds(), [
    "file:src/app.ts",
    "function:src/app.ts:health",
    "function:src/app.ts:start",
    "function:src/worker.ts:work",
  ]);
});

test("returns bounded errors to the model instead of throwing tool failures", async () => {
  const repositoryPath = await createRepository();
  await writeFixture(repositoryPath, "src/app.ts", "export function run() {}\n");
  const { graph } = await indexRepository(repositoryPath);
  const tools = createContractDiscoveryTools(graph, repositoryPath);

  assert.deepEqual(await tools.execute("missing_tool", {}), {
    ok: false,
    error: "Unknown contract discovery tool: missing_tool",
  });
  assert.deepEqual(await tools.execute("get_node", { id: "missing" }), {
    ok: false,
    error: 'Graph node not found: "missing"',
  });
  assert.deepEqual(await tools.execute("list_files", null), {
    ok: false,
    error: "Tool arguments must be an object",
  });
});

test("uses the full bounded allowance for contract-bearing file evidence", async () => {
  const repositoryPath = await createRepository();
  const documentation = Array.from(
    { length: 2_200 },
    (_, index) => `Documented promise ${index + 1}`,
  ).join("\n");
  await writeFixture(repositoryPath, "docs/system-design.md", documentation);
  const { graph } = await indexRepository(repositoryPath);
  const tools = createContractDiscoveryTools(graph, repositoryPath);

  const source = await tools.execute("get_source", {
    id: "file:docs/system-design.md",
    maxLines: null,
    maxBytes: null,
  });

  assert.equal(source.ok, true);
  assert.equal(source.value.lineCount, 2_200);
  assert.match(source.value.content, /Documented promise 2200$/);
});

test("uses the full bounded allowance for large symbol evidence", async () => {
  const repositoryPath = await createRepository();
  const largeClass = [
    "export class PostgresSessionRepository {",
    ...Array.from(
      { length: 1_895 },
      (_, index) => `  method${index + 1}() { return ${index + 1}; }`,
    ),
    "}",
  ].join("\n");
  await writeFixture(
    repositoryPath,
    "src/repository.ts",
    `${largeClass}\n`,
  );
  const { graph } = await indexRepository(repositoryPath);
  const tools = createContractDiscoveryTools(graph, repositoryPath);

  const source = await tools.execute("get_source", {
    id: "class:src/repository.ts:PostgresSessionRepository",
    maxLines: null,
    maxBytes: null,
  });

  assert.equal(source.ok, true);
  assert.equal(source.value.lineCount, 1_897);
  assert.match(source.value.content, /method1895\(\)/);
});

async function createRepository() {
  const repositoryPath = await mkdtemp(
    join(tmpdir(), "contract-discovery-tools-"),
  );
  temporaryRepositories.push(repositoryPath);
  return repositoryPath;
}

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
