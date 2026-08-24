import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSourceFile } from "../parser/parseSourceFile.ts";
import { parsePythonSourceFile } from "../languages/python/parsePythonSourceFile.ts";
import { buildRepositoryGraph } from "./buildRepositoryGraph.ts";
import { resolveInternalImportEdges } from "./resolveInternalImports.ts";

test("resolves absolute and relative Python modules", () => {
  const api = parsePythonSourceFile("app/api/routes.py", [
    "from .handlers import handle",
    "from ..core import settings",
    "import app.shared as shared",
  ].join("\n"));
  const parsedFiles = [
    api,
    parsePythonSourceFile("app/api/handlers.py", "def handle():\n    pass\n"),
    parsePythonSourceFile("app/core.py", "settings = {}\n"),
    parsePythonSourceFile("app/shared/__init__.py", "VALUE = 1\n"),
  ];
  const scannedFiles = parsedFiles.map((file) => scannedFile(file.path, "python"));
  const graph = buildRepositoryGraph(scannedFiles, parsedFiles);

  assert.deepEqual(
    graph.edges.filter((edge) => edge.type === "IMPORTS").map(({ source, target }) => ({ source, target })),
    [
      { source: "file:app/api/routes.py", target: "file:app/api/handlers.py" },
      { source: "file:app/api/routes.py", target: "file:app/core.py" },
      { source: "file:app/api/routes.py", target: "file:app/shared/__init__.py" },
    ],
  );
});

test("infers a unique Python source root for absolute package imports", () => {
  const routes = parsePythonSourceFile(
    "backend/app/api/routes.py",
    "from app.services.users import load_user\n",
  );
  const services = parsePythonSourceFile(
    "backend/app/services/users.py",
    "def load_user():\n    pass\n",
  );
  const parsedFiles = [routes, services];
  const graph = buildRepositoryGraph(
    parsedFiles.map((file) => scannedFile(file.path, "python")),
    parsedFiles,
  );

  assert.deepEqual(
    graph.edges.filter((edge) => edge.type === "IMPORTS"),
    [importEdge("backend/app/api/routes.py", "backend/app/services/users.py", 1)],
  );
});

test("resolves TypeScript path aliases from the nearest scoped config", () => {
  const parsed = parseSourceFile(
    "frontend/app/page.tsx",
    'import { api } from "@/lib/api";\napi();',
  );
  const graph = buildRepositoryGraph(
    [
      scannedFile("frontend/app/page.tsx", "typescript"),
      scannedFile("frontend/lib/api.ts", "typescript"),
    ],
    [parsed],
    {
      typeScriptConfigs: [{
        directory: "frontend",
        baseUrl: ".",
        paths: { "@/*": ["./*"] },
      }],
    },
  );

  assert.deepEqual(
    graph.edges.filter((edge) => edge.type === "IMPORTS"),
    [importEdge("frontend/app/page.tsx", "frontend/lib/api.ts", 1)],
  );
});

test("resolves supported internal module references with resolver evidence", () => {
  const source = [
    'import { charge, refund } from "./payment";',
    'import "./setup";',
    'const config = require("./config.json");',
    'export * from "./shared";',
    'export { helper } from "./helper";',
    "async function load() {",
    '  return import("./lazy");',
    "}",
    'import stripe from "stripe";',
  ].join("\n");
  const scannedFiles = [
    scannedFile("src/shared.ts", "typescript"),
    scannedFile("src/payment.ts", "typescript"),
    scannedFile("src/setup/index.ts", "typescript"),
    scannedFile("src/lazy.js", "javascript"),
    scannedFile("src/index.ts", "typescript"),
    scannedFile("src/helper.ts", "typescript"),
    scannedFile("src/config.json", "json"),
  ];

  const graph = buildRepositoryGraph(
    scannedFiles,
    [parseSourceFile("src/index.ts", source)],
  );
  const importEdges = graph.edges.filter((edge) => edge.type === "IMPORTS");

  assert.deepEqual(importEdges, [
    importEdge("src/index.ts", "src/payment.ts", 1),
    importEdge("src/index.ts", "src/setup/index.ts", 2),
    importEdge("src/index.ts", "src/config.json", 3),
    importEdge("src/index.ts", "src/shared.ts", 4),
    importEdge("src/index.ts", "src/helper.ts", 5),
    importEdge("src/index.ts", "src/lazy.js", 7),
  ]);
  assert.equal(
    importEdges.filter(
      (edge) => edge.target === "file:src/payment.ts",
    ).length,
    1,
  );
});

test("supports TypeScript source substitution for JavaScript specifiers", () => {
  const graph = buildRepositoryGraph(
    [
      scannedFile("src/index.ts", "typescript"),
      scannedFile("src/payment.ts", "typescript"),
    ],
    [
      parseSourceFile(
        "src/index.ts",
        'import { charge } from "./payment.js";',
      ),
    ],
  );

  assert.deepEqual(
    graph.edges.filter((edge) => edge.type === "IMPORTS"),
    [importEdge("src/index.ts", "src/payment.ts", 1)],
  );
});

test("leaves external, escaping, missing, and ambiguous imports unresolved", () => {
  const parsed = parseSourceFile(
    "src/index.ts",
    [
      'import "package-name";',
      'import "../../outside";',
      'import "./missing";',
      'import "./choice";',
      'import "./target.js";',
      'import "./folder";',
    ].join("\n"),
  );
  const files = [
    fileNode("src/index.ts", "typescript"),
    fileNode("src/choice.ts", "typescript"),
    fileNode("src/choice.js", "javascript"),
    fileNode("src/choice/index.ts", "typescript"),
    fileNode("src/target.ts", "typescript"),
    fileNode("src/target.js", "javascript"),
    fileNode("src/folder/index.ts", "typescript"),
    fileNode("src/folder/index.js", "javascript"),
    fileNode("outside.ts", "typescript"),
  ];

  assert.deepEqual(resolveInternalImportEdges(files, [parsed]), []);
});

test("returns deterministic edges and rejects duplicate file paths", () => {
  const alpha = fileNode("src/alpha.ts", "typescript");
  const beta = fileNode("src/beta.ts", "typescript");
  const parsedAlpha = parseSourceFile(
    "src/alpha.ts",
    'import "./beta";\nimport "./beta";',
  );

  const first = resolveInternalImportEdges([beta, alpha], [parsedAlpha]);
  const second = resolveInternalImportEdges([alpha, beta], [parsedAlpha]);

  assert.deepEqual(first, second);
  assert.deepEqual(first, [
    importEdge("src/alpha.ts", "src/beta.ts", 1),
    importEdge("src/alpha.ts", "src/beta.ts", 2),
  ]);
  assert.throws(
    () => resolveInternalImportEdges([alpha, alpha], [parsedAlpha]),
    /Duplicate file path during import resolution: src\/alpha\.ts/,
  );
});

function scannedFile(path, language) {
  return {
    path,
    language,
    contentHash: `${path}-hash`,
  };
}

function fileNode(path, language) {
  return {
    id: `file:${path}`,
    type: "file",
    path,
    language,
    contentHash: `${path}-hash`,
  };
}

function importEdge(sourcePath, targetPath, line) {
  return {
    source: `file:${sourcePath}`,
    target: `file:${targetPath}`,
    type: "IMPORTS",
    evidence: {
      file: sourcePath,
      line,
      extractor: "resolver",
    },
  };
}
