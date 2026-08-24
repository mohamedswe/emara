import assert from "node:assert/strict";
import { test } from "node:test";

import { FRAMEWORK_PACKS, mergedJavaScriptConventions } from "./catalog.ts";
import { detectRepositoryFrameworks } from "./detectFrameworks.ts";

test("framework catalog has stable unique IDs and migrated JavaScript conventions", () => {
  const ids = FRAMEWORK_PACKS.map((pack) => pack.id);
  assert.equal(new Set(ids).size, ids.length);
  const conventions = mergedJavaScriptConventions();
  assert.ok(conventions.httpReceivers.includes("fastify"));
  assert.equal(conventions.httpDecorators.Get, "GET");
  assert.ok(conventions.cliReceivers.includes("program"));
});

test("detects frameworks from imports, dependency manifests, and route files", () => {
  const frameworks = detectRepositoryFrameworks({
    parsedFiles: [{
      path: "server/app.py",
      language: "python",
      symbols: [],
      imports: [{
        kind: "named",
        source: "fastapi",
        importedName: "FastAPI",
        localName: "FastAPI",
        typeOnly: false,
        lineRange: { start: 1, end: 1 },
      }],
      exports: [], calls: [], entrypoints: [], events: [], renders: [], diagnostics: [],
    }],
    scannedPaths: ["server/app.py", "web/app/users/route.ts"],
    packageNames: new Set(["next"]),
  });

  assert.ok(frameworks.some((item) => item.id === "python-http"));
  assert.ok(frameworks.some((item) => item.id === "next-app-router"));
  assert.ok(frameworks.some((item) => item.id === "javascript-application"));
});
