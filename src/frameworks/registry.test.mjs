import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSourceFile } from "../parser/parseSourceFile.ts";
import { FrameworkRegistry } from "./registry.ts";

const quantumPack = {
  id: "quantum-web",
  displayName: "Quantum Web",
  family: "custom-http",
  languages: ["typescript"],
  support: "entrypoints",
  versionPolicy: "major-fixtures",
  detection: {
    packageNames: ["quantum-web"],
    importPrefixes: ["quantum-web"],
  },
  javascript: {
    httpFactoryNames: ["Quantum"],
    httpMethods: ["fetch"],
  },
};

test("custom framework packs extend parsing without changing the engine", () => {
  const registry = new FrameworkRegistry([quantumPack]);
  const parsed = parseSourceFile("src/server.ts", [
    'import { Quantum } from "quantum-web";',
    "const runtime = Quantum();",
    "function users() {}",
    'runtime.fetch("/users", users);',
  ].join("\n"), registry);

  assert.deepEqual(parsed.entrypoints, [{
    kind: "http",
    name: "FETCH /users",
    exposure: "external",
    httpMethod: "FETCH",
    route: "/users",
    handlerName: "users",
    lineRange: { start: 4, end: 4 },
  }]);
});

test("framework registries reject duplicate and empty packs deterministically", () => {
  assert.throws(
    () => new FrameworkRegistry([quantumPack, quantumPack]),
    /Duplicate framework pack ID: quantum-web/,
  );
  assert.throws(
    () => new FrameworkRegistry([{ ...quantumPack, id: "" }]),
    /Framework pack ID must not be empty/,
  );
  assert.throws(
    () => new FrameworkRegistry([{ ...quantumPack, id: "empty", languages: [] }]),
    /must support at least one language/,
  );
});
