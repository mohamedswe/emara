import assert from "node:assert/strict";
import { test } from "node:test";

import { validateRepositoryGraph } from "./validateRepositoryGraph.ts";

test("accepts a structurally valid evidence-bearing graph", () => {
  assert.doesNotThrow(() => validateRepositoryGraph(validGraph()));
});

test("rejects missing and inconsistent graph analysis metadata", () => {
  const missing = validGraph();
  delete missing.analysis;
  assert.throws(
    () => validateRepositoryGraph(missing),
    /analysis must be an object/u,
  );

  const inconsistent = validGraph();
  inconsistent.analysis.unparsedSourceFiles = ["src/missing.ts"];
  assert.throws(
    () => validateRepositoryGraph(inconsistent),
    /sourceFileCount must equal.*unparsedSourceFiles|references missing file/u,
  );
});

test("rejects duplicate IDs, paths, and evidence-bearing edges", () => {
  const graph = validGraph();
  graph.files.push({ ...graph.files[0], path: "src/copy.ts" });
  graph.files.push({
    ...graph.files[1],
    id: "file:src/duplicate-path.ts",
  });
  graph.edges.push(structuredClone(graph.edges[0]));

  assert.throws(
    () => validateRepositoryGraph(graph),
    (error) => {
      assert.match(error.message, /duplicates node ID/);
      assert.match(error.message, /duplicates file path/);
      assert.match(error.message, /duplicates an existing evidence-bearing edge/);
      return true;
    },
  );
});

test("rejects invalid node types, ownership, and line ranges", () => {
  const graph = validGraph();
  graph.symbols[0].type = "module";
  graph.symbols[0].fileId = "file:missing.ts";
  graph.symbols[0].lineRange = { start: 4, end: 2 };

  assert.throws(
    () => validateRepositoryGraph(graph),
    (error) => {
      assert.match(error.message, /type must be "function", "class", or "variable"/);
      assert.match(error.message, /fileId must reference a File node/);
      assert.match(error.message, /end must be greater than or equal to start/);
      return true;
    },
  );
});

test("rejects missing endpoints and edge types with invalid endpoint shapes", () => {
  const graph = validGraph();
  graph.edges[0].target = "function:missing.ts:nope";
  graph.edges[1].source = graph.symbols[0].id;
  graph.edges[2].target = graph.files[1].id;

  assert.throws(
    () => validateRepositoryGraph(graph),
    (error) => {
      assert.match(error.message, /target references missing node/);
      assert.match(error.message, /IMPORTS endpoints must be File -> File/);
      assert.match(error.message, /CALLS endpoints must be Function -> Function/);
      return true;
    },
  );
});

test("rejects missing, invalid, or source-misaligned evidence", () => {
  const graph = validGraph();
  delete graph.edges[0].evidence;
  graph.edges[1].evidence.file = "src/target.ts";
  graph.edges[2].evidence.extractor = "guess";
  graph.edges[2].evidence.line = 0;

  assert.throws(
    () => validateRepositoryGraph(graph),
    (error) => {
      assert.match(error.message, /evidence must be an object/);
      assert.match(error.message, /evidence\.file must match the relationship evidence owner file/);
      assert.match(error.message, /extractor must be "tree-sitter", "resolver", or "scanner"/);
      assert.match(error.message, /line must be a positive integer/);
      return true;
    },
  );
});

test("rejects invalid entrypoint ownership, handlers, kinds, and evidence", () => {
  const graph = validGraph();
  graph.entrypoints[0].kind = "guess";
  graph.entrypoints[0].fileId = "file:missing.ts";
  graph.entrypoints[0].handlerSymbolId = "class:missing.ts:Handler";
  const wrongEvidenceLine = structuredClone(graph.entrypoints[0]);
  wrongEvidenceLine.id = "entrypoint:http:src/source.ts:9:GET /other";
  wrongEvidenceLine.kind = "http";
  wrongEvidenceLine.fileId = "file:src/source.ts";
  wrongEvidenceLine.handlerSymbolId = "function:src/source.ts:start";
  wrongEvidenceLine.lineRange = { start: 9, end: 9 };
  wrongEvidenceLine.evidence = {
    file: "src/source.ts",
    line: 8,
    extractor: "tree-sitter",
  };
  graph.entrypoints.push(wrongEvidenceLine);

  assert.throws(
    () => validateRepositoryGraph(graph),
    (error) => {
      assert.match(error.message, /kind must be http, websocket, cli, event/);
      assert.match(error.message, /fileId must reference a File node/);
      assert.match(error.message, /handlerSymbolId must reference a Function node/);
      assert.match(error.message, /evidence\.line must match lineRange\.start/);
      return true;
    },
  );
});

test("rejects inconsistent entrypoint exposure and incomplete WebSocket metadata", () => {
  const graph = validGraph();
  graph.entrypoints[0].exposure = "startup";
  graph.entrypoints.push({
    ...structuredClone(graph.entrypoints[0]),
    id: "entrypoint:websocket:src/source.ts:3:WS /socket",
    kind: "websocket",
    name: "WS /socket",
    exposure: "external",
    lineRange: { start: 3, end: 3 },
    evidence: {
      file: "src/source.ts",
      line: 3,
      extractor: "tree-sitter",
    },
  });
  delete graph.entrypoints[1].route;

  assert.throws(
    () => validateRepositoryGraph(graph),
    (error) => {
      assert.match(error.message, /startup kind and exposure must agree/);
      assert.match(error.message, /route is required for WebSocket entrypoints/);
      return true;
    },
  );
});

function validGraph() {
  return {
    version: 4,
    analysis: {
      sourceFileCount: 2,
      parsedSourceFileCount: 2,
      unparsedSourceFiles: [],
      diagnostics: [],
    },
    files: [
      {
        id: "file:src/source.ts",
        type: "file",
        path: "src/source.ts",
        language: "typescript",
        contentHash: "source-hash",
      },
      {
        id: "file:src/target.ts",
        type: "file",
        path: "src/target.ts",
        language: "typescript",
        contentHash: "target-hash",
      },
    ],
    symbols: [
      {
        id: "function:src/source.ts:start",
        type: "function",
        name: "start",
        fileId: "file:src/source.ts",
        lineRange: { start: 2, end: 4 },
        exported: true,
      },
      {
        id: "function:src/target.ts:run",
        type: "function",
        name: "run",
        fileId: "file:src/target.ts",
        lineRange: { start: 1, end: 1 },
        exported: true,
      },
    ],
    entrypoints: [
      {
        id: "entrypoint:http:src/source.ts:1:GET /run",
        type: "entrypoint",
        kind: "http",
        name: "GET /run",
        exposure: "external",
        httpMethod: "GET",
        route: "/run",
        fileId: "file:src/source.ts",
        handlerSymbolId: "function:src/source.ts:start",
        lineRange: { start: 1, end: 1 },
        evidence: {
          file: "src/source.ts",
          line: 1,
          extractor: "tree-sitter",
        },
      },
    ],
    entities: [],
    edges: [
      {
        source: "file:src/source.ts",
        target: "function:src/source.ts:start",
        type: "CONTAINS",
        evidence: {
          file: "src/source.ts",
          line: 2,
          extractor: "tree-sitter",
        },
      },
      {
        source: "file:src/source.ts",
        target: "file:src/target.ts",
        type: "IMPORTS",
        evidence: {
          file: "src/source.ts",
          line: 1,
          extractor: "resolver",
        },
      },
      {
        source: "function:src/source.ts:start",
        target: "function:src/target.ts:run",
        type: "CALLS",
        evidence: {
          file: "src/source.ts",
          line: 3,
          extractor: "resolver",
        },
      },
      {
        source: "file:src/source.ts",
        target: "entrypoint:http:src/source.ts:1:GET /run",
        type: "CONTAINS",
        evidence: {
          file: "src/source.ts",
          line: 1,
          extractor: "tree-sitter",
        },
      },
    ],
  };
}
