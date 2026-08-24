import assert from "node:assert/strict";
import { test } from "node:test";

import { searchGraph } from "./searchGraph.ts";

test("ranks lexical seeds and expands evidence-bearing graph neighbors", () => {
  const graph = repositoryGraph();

  const result = searchGraph(graph, "function checkout", {
    maxSeeds: 1,
    maxDepth: 2,
    maxNodes: 10,
    maxEdges: 20,
  });

  assert.deepEqual(result.seeds, [
    {
      nodeId: "function:src/app.ts:checkout",
      score: 655,
      matchedFields: ["name", "kind", "id"],
    },
  ]);
  assert.deepEqual(
    result.nodes.map((node) => node.id),
    [
      "function:src/app.ts:checkout",
      "entrypoint:http:src/app.ts:20:GET /checkout",
      "function:src/payment.ts:charge",
      "file:src/app.ts",
      "file:src/payment.ts",
      "class:src/app.ts:Checkout",
      "function:src/app.ts:helper",
    ],
  );
  assert.ok(
    result.edges.some(
      (edge) =>
        edge.type === "CALLS" &&
        edge.source === "function:src/app.ts:checkout" &&
        edge.target === "function:src/payment.ts:charge",
    ),
  );
  assert.ok(
    result.edges.every((edge) =>
      result.nodes.some((node) => node.id === edge.source) &&
      result.nodes.some((node) => node.id === edge.target),
    ),
  );
  assert.deepEqual(result.truncated, {
    seeds: false,
    nodes: false,
    edges: false,
  });
});

test("treats an entrypoint handler reference as direct graph context", () => {
  const result = searchGraph(repositoryGraph(), "GET /checkout", {
    maxSeeds: 1,
    maxDepth: 1,
    maxNodes: 3,
  });

  assert.deepEqual(result.seeds, [
    {
      nodeId: "entrypoint:http:src/app.ts:20:GET /checkout",
      score: 1_050,
      matchedFields: ["name", "id"],
    },
  ]);
  assert.deepEqual(
    result.nodes.map((node) => node.id),
    [
      "entrypoint:http:src/app.ts:20:GET /checkout",
      "function:src/app.ts:checkout",
      "file:src/app.ts",
    ],
  );
  assert.equal(result.nodes[0].handlerSymbolId, result.nodes[1].id);
});

test("enforces node and edge bounds and reports truncation", () => {
  const result = searchGraph(repositoryGraph(), "src/app.ts", {
    maxSeeds: 1,
    maxDepth: 1,
    maxNodes: 3,
    maxEdges: 1,
  });

  assert.deepEqual(
    result.nodes.map((node) => node.id),
    ["file:src/app.ts", "file:src/payment.ts", "class:src/app.ts:Checkout"],
  );
  assert.deepEqual(result.edges, [
    {
      source: "file:src/app.ts",
      target: "file:src/payment.ts",
      type: "IMPORTS",
      evidence: {
        file: "src/app.ts",
        line: 1,
        extractor: "resolver",
      },
    },
  ]);
  assert.deepEqual(result.truncated, {
    seeds: true,
    nodes: true,
    edges: true,
  });
});

test("returns deterministic results for differently ordered graph arrays", () => {
  const graph = repositoryGraph();
  const reordered = {
    ...graph,
    files: [...graph.files].reverse(),
    symbols: [...graph.symbols].reverse(),
    entrypoints: [...graph.entrypoints].reverse(),
    edges: [...graph.edges].reverse(),
  };

  assert.equal(
    JSON.stringify(searchGraph(graph, "checkout")),
    JSON.stringify(searchGraph(reordered, "checkout")),
  );
});

test("returns an empty bounded subgraph when no lexical seed matches", () => {
  const result = searchGraph(repositoryGraph(), "missing-wombat");

  assert.deepEqual(result.seeds, []);
  assert.deepEqual(result.nodes, []);
  assert.deepEqual(result.edges, []);
  assert.deepEqual(result.truncated, {
    seeds: false,
    nodes: false,
    edges: false,
  });
});

test("rejects empty queries, invalid bounds, and invalid input graphs", () => {
  const graph = repositoryGraph();

  assert.throws(
    () => searchGraph(graph, "  "),
    /query must contain searchable text/,
  );
  assert.throws(
    () => searchGraph(graph, "checkout", { maxNodes: 0 }),
    /maxNodes must be a positive safe integer/,
  );
  assert.throws(
    () => searchGraph(graph, "checkout", { maxDepth: -1 }),
    /maxDepth must be a non-negative safe integer/,
  );
  assert.throws(
    () => searchGraph({ ...graph, version: 1 }, "checkout"),
    /version must be 4/,
  );
});

function repositoryGraph() {
  return {
    version: 4,
    analysis: {
      sourceFileCount: 3,
      parsedSourceFileCount: 3,
      unparsedSourceFiles: [],
      diagnostics: [],
    },
    files: [
      file("src/app.ts"),
      file("src/payment.ts"),
      file("src/unused.ts"),
    ],
    symbols: [
      symbol("function", "src/app.ts", "checkout", 2, true),
      symbol("function", "src/app.ts", "helper", 6, false),
      symbol("class", "src/app.ts", "Checkout", 10, true),
      symbol("function", "src/payment.ts", "charge", 1, true),
      symbol("function", "src/unused.ts", "unrelated", 1, false),
    ],
    entrypoints: [
      {
        id: "entrypoint:http:src/app.ts:20:GET /checkout",
        type: "entrypoint",
        kind: "http",
        name: "GET /checkout",
        exposure: "external",
        httpMethod: "GET",
        route: "/checkout",
        fileId: "file:src/app.ts",
        handlerSymbolId: "function:src/app.ts:checkout",
        lineRange: { start: 20, end: 20 },
        evidence: {
          file: "src/app.ts",
          line: 20,
          extractor: "tree-sitter",
        },
      },
    ],
    entities: [],
    edges: [
      contains("src/app.ts", "function:src/app.ts:checkout", 2),
      contains("src/app.ts", "function:src/app.ts:helper", 6),
      contains("src/app.ts", "class:src/app.ts:Checkout", 10),
      contains(
        "src/app.ts",
        "entrypoint:http:src/app.ts:20:GET /checkout",
        20,
      ),
      contains("src/payment.ts", "function:src/payment.ts:charge", 1),
      contains("src/unused.ts", "function:src/unused.ts:unrelated", 1),
      {
        source: "file:src/app.ts",
        target: "file:src/payment.ts",
        type: "IMPORTS",
        evidence: {
          file: "src/app.ts",
          line: 1,
          extractor: "resolver",
        },
      },
      {
        source: "function:src/app.ts:checkout",
        target: "function:src/payment.ts:charge",
        type: "CALLS",
        evidence: {
          file: "src/app.ts",
          line: 3,
          extractor: "resolver",
        },
      },
    ],
  };
}

function file(path) {
  return {
    id: `file:${path}`,
    type: "file",
    path,
    language: "typescript",
    contentHash: `${path}-hash`,
  };
}

function symbol(type, path, name, line, exported) {
  return {
    id: `${type}:${path}:${name}`,
    type,
    name,
    fileId: `file:${path}`,
    lineRange: { start: line, end: line + 1 },
    exported,
  };
}

function contains(path, target, line) {
  return {
    source: `file:${path}`,
    target,
    type: "CONTAINS",
    evidence: {
      file: path,
      line,
      extractor: "tree-sitter",
    },
  };
}
