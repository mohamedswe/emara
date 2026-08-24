import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isSupportedSourceFile,
  parseWithLanguageFrontend,
} from "./languageFrontends.ts";

test("dispatches Python through the Python frontend and detects its framework", () => {
  const file = { path: "app.py", language: "python", contentHash: "hash" };
  const parsed = parseWithLanguageFrontend(file, [
    "from fastapi import FastAPI",
    "app = FastAPI()",
  ].join("\n"));

  assert.equal(parsed.language, "python");
  assert.ok(parsed.detectedFrameworks.includes("python-http"));
});

test("extracts line-preserving script blocks from Vue and Svelte files", () => {
  const vue = parseWithLanguageFrontend(
    { path: "pages/users.vue", language: "vue", contentHash: "hash" },
    [
      "<template><UserList /></template>",
      '<script setup lang="ts">',
      'import { loadUsers } from "../users";',
      "export function refresh() {",
      "  return loadUsers();",
      "}",
      "</script>",
    ].join("\n"),
  );
  assert.equal(vue.language, "typescript");
  assert.equal(vue.symbols.find((item) => item.name === "refresh")?.lineRange.start, 4);
  assert.ok(vue.detectedFrameworks.includes("vue-family"));
  assert.ok(vue.entrypoints.some((item) => item.name === "PAGE /users"));

  const astro = parseWithLanguageFrontend(
    { path: "src/pages/index.astro", language: "astro", contentHash: "hash" },
    [
      "---",
      'import { loadHome } from "../home";',
      "const home = loadHome();",
      "---",
      "<main>{home.title}</main>",
    ].join("\n"),
  );
  assert.ok(astro.calls.some((call) => call.callee === "loadHome"));
  assert.ok(astro.entrypoints.some((item) => item.name === "PAGE /"));
  assert.ok(astro.detectedFrameworks.includes("astro"));

  assert.equal(isSupportedSourceFile({ path: "view.svelte", language: "svelte", contentHash: "x" }), true);
  assert.equal(isSupportedSourceFile({ path: "readme.md", language: "markdown", contentHash: "x" }), false);
});

test("extracts modern file-based JavaScript and TypeScript routes", () => {
  const hono = parseWithLanguageFrontend(
    { path: "server.ts", language: "typescript", contentHash: "hash" },
    [
      'import { Hono } from "hono";',
      "const web = new Hono();",
      "function health() {}",
      'web.get("/health", health);',
    ].join("\n"),
  );
  assert.ok(hono.entrypoints.some((item) =>
    item.kind === "http" && item.httpMethod === "GET" && item.route === "/health"
  ));

  const next = parseWithLanguageFrontend(
    { path: "app/users/[id]/route.ts", language: "typescript", contentHash: "hash" },
    "export async function GET() { return Response.json({}); }\n",
  );
  assert.ok(next.entrypoints.some((item) =>
    item.kind === "http" && item.httpMethod === "GET" && item.route === "/users/:id"
  ));

  const expo = parseWithLanguageFrontend(
    { path: "app/trips/[tripId]/index.tsx", language: "typescript", contentHash: "hash" },
    "export default function TripScreen() { return <View />; }\n",
  );
  assert.ok(expo.entrypoints.some((item) =>
    item.kind === "application" && item.name === "PAGE /trips/:tripId"
  ));
});

test("parses Python notebook code cells without losing original JSON line evidence", () => {
  const notebookSource = JSON.stringify({
    cells: [{
      cell_type: "code",
      source: [
        "from fastapi import FastAPI\n",
        "app = FastAPI()\n",
        "@app.get('/health')\n",
        "def health():\n",
        "    return {'ok': True}\n",
      ],
    }],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  }, null, 2);
  const parsed = parseWithLanguageFrontend(
    { path: "notebooks/api.ipynb", language: "jupyter", contentHash: "hash" },
    notebookSource,
  );

  const health = parsed.symbols.find((item) => item.name === "health");
  assert.ok(health);
  assert.match(notebookSource.split("\n")[health.lineRange.start - 1], /def health/);
  assert.ok(parsed.entrypoints.some((item) => item.name === "GET /health"));
  assert.ok(parsed.detectedFrameworks.includes("python-data-ui"));
});

test("diagnoses compact notebooks whose code cannot retain exact JSON line evidence", () => {
  const compactNotebook = JSON.stringify({
    cells: [{ cell_type: "code", source: ["def health():\n", "    return True\n"] }],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  });
  const parsed = parseWithLanguageFrontend(
    { path: "notebooks/compact.ipynb", language: "jupyter", contentHash: "hash" },
    compactNotebook,
  );

  assert.deepEqual(parsed.symbols, []);
  assert.match(parsed.frameworkDiagnostics?.[0]?.message ?? "", /pretty-printed JSON/u);
});

test("reports unknown route conventions instead of silently pretending coverage", () => {
  const parsed = parseWithLanguageFrontend(
    { path: "server.ts", language: "typescript", contentHash: "hash" },
    [
      "function health() {}",
      'mysteryRuntime.get("/health", health);',
    ].join("\n"),
  );

  assert.deepEqual(parsed.entrypoints, []);
  assert.deepEqual(parsed.frameworkDiagnostics, [{
    kind: "unresolved-registration",
    message: "Unrecognized route receiver in registration: mysteryRuntime.get",
    lineRange: { start: 2, end: 2 },
  }]);
});
