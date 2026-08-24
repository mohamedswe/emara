import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRepositoryGraph } from "./buildRepositoryGraph.ts";

test("builds file and symbol nodes with evidence-backed CONTAINS edges", () => {
  const scannedFiles = [
    {
      path: "src/checkout.ts",
      language: "typescript",
      contentHash: "checkout-hash",
    },
    {
      path: "README.md",
      language: "markdown",
      contentHash: "readme-hash",
    },
  ];
  const parsedFiles = [
    parsedFile("src/checkout.ts", [
      symbol("function", "checkout", 3, 6, true),
      symbol("class", "Checkout", 8, 12, false),
    ]),
  ];

  const graph = buildRepositoryGraph(scannedFiles, parsedFiles);

  assert.deepEqual(graph, {
    version: 4,
    analysis: {
      sourceFileCount: 1,
      parsedSourceFileCount: 1,
      unparsedSourceFiles: [],
      diagnostics: [],
    },
    files: [
      {
        id: "file:README.md",
        type: "file",
        path: "README.md",
        language: "markdown",
        contentHash: "readme-hash",
      },
      {
        id: "file:src/checkout.ts",
        type: "file",
        path: "src/checkout.ts",
        language: "typescript",
        contentHash: "checkout-hash",
      },
    ],
    symbols: [
      {
        id: "function:src/checkout.ts:checkout",
        type: "function",
        name: "checkout",
        fileId: "file:src/checkout.ts",
        lineRange: { start: 3, end: 6 },
        exported: true,
      },
      {
        id: "class:src/checkout.ts:Checkout",
        type: "class",
        name: "Checkout",
        fileId: "file:src/checkout.ts",
        lineRange: { start: 8, end: 12 },
        exported: false,
      },
    ],
    entrypoints: [],
    entities: [],
    edges: [
      {
        source: "file:src/checkout.ts",
        target: "function:src/checkout.ts:checkout",
        type: "CONTAINS",
        evidence: {
          file: "src/checkout.ts",
          line: 3,
          extractor: "tree-sitter",
        },
      },
      {
        source: "file:src/checkout.ts",
        target: "class:src/checkout.ts:Checkout",
        type: "CONTAINS",
        evidence: {
          file: "src/checkout.ts",
          line: 8,
          extractor: "tree-sitter",
        },
      },
    ],
  });
});

test("returns identical JSON without mutating differently ordered inputs", () => {
  const alpha = {
    path: "src/alpha.ts",
    language: "typescript",
    contentHash: "alpha-hash",
  };
  const beta = {
    path: "src/beta.js",
    language: "javascript",
    contentHash: "beta-hash",
  };
  const alphaParsed = parsedFile("src/alpha.ts", [
    symbol("class", "Later", 10, 12, false),
    symbol("function", "first", 2, 4, true),
  ]);
  const betaParsed = parsedFile("src/beta.js", [
    symbol("function", "run", 1, 1, false),
  ], "javascript");
  const scannedFiles = [beta, alpha];
  const parsedFiles = [betaParsed, alphaParsed];

  const graph = buildRepositoryGraph(scannedFiles, parsedFiles);
  const reversedGraph = buildRepositoryGraph(
    [...scannedFiles].reverse(),
    parsedFiles.map((file) => ({
      ...file,
      symbols: [...file.symbols].reverse(),
    })).reverse(),
  );

  assert.equal(JSON.stringify(graph), JSON.stringify(reversedGraph));
  assert.deepEqual(scannedFiles, [beta, alpha]);
  assert.deepEqual(parsedFiles, [betaParsed, alphaParsed]);
  assert.ok(graph.edges.every((edge) => edge.type === "CONTAINS"));
});

test("keeps scanned files that have no parsed symbols", () => {
  const graph = buildRepositoryGraph(
    [
      {
        path: "README.md",
        language: "markdown",
        contentHash: "hash",
        lineCount: 4,
      },
    ],
    [],
  );

  assert.equal(graph.files.length, 1);
  assert.deepEqual(graph.files[0].lineRange, { start: 1, end: 4 });
  assert.deepEqual(graph.symbols, []);
  assert.deepEqual(graph.edges, []);
});

test("builds entrypoint nodes with handler links and CONTAINS evidence", () => {
  const parsed = parsedFile(
    "src/app.ts",
    [symbol("function", "handler", 5, 7, true)],
  );
  parsed.entrypoints.push(
    {
      kind: "http",
      name: "GET /health",
      exposure: "external",
      httpMethod: "GET",
      route: "/health",
      handlerName: "handler",
      lineRange: { start: 2, end: 2 },
    },
    {
      kind: "cli",
      name: "serve",
      exposure: "external",
      lineRange: { start: 3, end: 3 },
    },
  );

  const graph = buildRepositoryGraph(
    [
      {
        path: "src/app.ts",
        language: "typescript",
        contentHash: "hash",
      },
    ],
    [parsed],
  );
  const rebuilt = buildRepositoryGraph(
    [
      {
        path: "src/app.ts",
        language: "typescript",
        contentHash: "hash",
      },
    ],
    [{ ...parsed, entrypoints: [...parsed.entrypoints].reverse() }],
  );

  assert.deepEqual(graph.entrypoints, [
    {
      id: "entrypoint:http:src/app.ts:2:GET /health",
      type: "entrypoint",
      kind: "http",
      name: "GET /health",
      exposure: "external",
      httpMethod: "GET",
      route: "/health",
      fileId: "file:src/app.ts",
      handlerSymbolId: "function:src/app.ts:handler",
      lineRange: { start: 2, end: 2 },
      evidence: {
        file: "src/app.ts",
        line: 2,
        extractor: "tree-sitter",
      },
    },
    {
      id: "entrypoint:cli:src/app.ts:3:serve",
      type: "entrypoint",
      kind: "cli",
      name: "serve",
      exposure: "external",
      fileId: "file:src/app.ts",
      lineRange: { start: 3, end: 3 },
      evidence: {
        file: "src/app.ts",
        line: 3,
        extractor: "tree-sitter",
      },
    },
  ]);
  assert.deepEqual(
    graph.edges.filter((edge) => edge.target.startsWith("entrypoint:")),
    [
      {
        source: "file:src/app.ts",
        target: "entrypoint:http:src/app.ts:2:GET /health",
        type: "CONTAINS",
        evidence: {
          file: "src/app.ts",
          line: 2,
          extractor: "tree-sitter",
        },
      },
      {
        source: "file:src/app.ts",
        target: "entrypoint:cli:src/app.ts:3:serve",
        type: "CONTAINS",
        evidence: {
          file: "src/app.ts",
          line: 3,
          extractor: "tree-sitter",
        },
      },
    ],
  );
  assert.equal(JSON.stringify(rebuilt), JSON.stringify(graph));
});

test("does not promote test harness routes or listeners to runtime entrypoints", () => {
  const scanned = [
    {
      path: "server/app.ts",
      language: "typescript",
      contentHash: "app-hash",
    },
    {
      path: "server/tests/app.test.ts",
      language: "typescript",
      contentHash: "test-hash",
    },
  ];
  const runtime = parsedFile("server/app.ts");
  runtime.entrypoints.push({
    kind: "http",
    name: "GET /health",
    exposure: "external",
    httpMethod: "GET",
    route: "/health",
    lineRange: { start: 1, end: 1 },
  });
  const harness = parsedFile("server/tests/app.test.ts");
  harness.entrypoints.push({
    kind: "startup",
    name: "listen",
    exposure: "startup",
    lineRange: { start: 5, end: 5 },
  });

  const graph = buildRepositoryGraph(scanned, [runtime, harness]);

  assert.deepEqual(
    graph.entrypoints.map(({ name, fileId }) => ({ name, fileId })),
    [{ name: "GET /health", fileId: "file:server/app.ts" }],
  );
  assert.ok(graph.entities.some((node) => node.type === "test"));
});

test("treats Python test modules as test evidence rather than production startup", () => {
  const path = "backend/test_chat_quality.py";
  const harness = parsedFile(path, [
    symbol("function", "main", 3, 8, false),
  ], "python");
  harness.entrypoints.push({
    kind: "startup",
    name: "python __main__",
    exposure: "startup",
    handlerName: "main",
    lineRange: { start: 10, end: 10 },
  });

  const graph = buildRepositoryGraph(
    [{ path, language: "python", contentHash: "test-hash" }],
    [harness],
  );

  assert.deepEqual(graph.entrypoints, []);
  assert.ok(graph.entities.some((node) => node.id === `test:${path}`));
});

test("rejects duplicate or unscanned file inputs", () => {
  const scannedFile = {
    path: "src/index.ts",
    language: "typescript",
    contentHash: "hash",
  };

  assert.throws(
    () => buildRepositoryGraph([scannedFile, scannedFile], []),
    /Duplicate scanned file path: src\/index\.ts/,
  );
  assert.throws(
    () =>
      buildRepositoryGraph(
        [scannedFile],
        [parsedFile("src/index.ts"), parsedFile("src/index.ts")],
      ),
    /Duplicate parsed file path: src\/index\.ts/,
  );
  assert.throws(
    () => buildRepositoryGraph([], [parsedFile("src/missing.ts")]),
    /Parsed file was not present in the scan: src\/missing\.ts/,
  );
});

test("disambiguates same-name symbols by source line and rejects parser diagnostics", () => {
  const scannedFile = {
    path: "src/index.ts",
    language: "typescript",
    contentHash: "hash",
  };

  const duplicateNames = buildRepositoryGraph(
    [scannedFile],
    [
      parsedFile("src/index.ts", [
        symbol("function", "run", 1, 1, false),
        symbol("function", "run", 3, 3, false),
      ]),
    ],
  );
  assert.deepEqual(
    duplicateNames.symbols.map((item) => item.id),
    [
      "function:src/index.ts:run",
      "function:src/index.ts:run:line:3",
    ],
  );

  const withDiagnostics = parsedFile("src/index.ts");
  withDiagnostics.diagnostics.push({
    kind: "error",
    nodeType: "ERROR",
    lineRange: { start: 1, end: 1 },
  });

  assert.throws(
    () => buildRepositoryGraph([scannedFile], [withDiagnostics]),
    /Cannot construct a graph from a file with parse diagnostics: src\/index\.ts/,
  );
});

function parsedFile(path, symbols = [], language = "typescript") {
  return {
    path,
    language,
    symbols,
    imports: [],
    exports: [],
    calls: [],
    entrypoints: [],
    diagnostics: [],
  };
}

function symbol(type, name, start, end, exported) {
  return {
    type,
    name,
    exported,
    lineRange: { start, end },
  };
}
