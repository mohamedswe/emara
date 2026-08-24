import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDossierReferences } from "./resolveDossierReferences.ts";

test("resolves exact dossier labels to every matching typed graph node without guessing", () => {
  const draft = emptyDraft();
  draft.featureDossiers.push({
    id: "offers",
    title: "Offers",
    entrypoints: ["POST /offers"],
    ui: [],
    handlers: [],
    services: ["DriverService.offerTrip"],
    schemas: [],
    stateTransitions: [],
    events: ["driver.offer.updated", "missing-event"],
    tests: [],
    config: [],
    documentation: [],
    evidenceNodeIds: ["function:service:DriverService.offerTrip"],
    unresolvedQuestions: [],
    reachability: "reachable",
  });
  draft.capabilities.push({
    id: "offer-capability",
    dossierId: "offers",
    title: "Offers",
    description: "Shows offers.",
    entrypointNodeIds: [
      "function:service:DriverService.offerTrip",
      "POST /offers",
    ],
    evidenceNodeIds: ["class:service:DriverService.offerTrip"],
  });

  const resolved = resolveDossierReferences(graph(), draft);

  assert.deepEqual(resolved.featureDossiers[0].entrypoints, ["entrypoint:offers"]);
  assert.deepEqual(resolved.featureDossiers[0].services, [
    "function:service:DriverService.offerTrip",
  ]);
  assert.deepEqual(resolved.featureDossiers[0].events, [
    "event:offer-updated:1",
    "event:offer-updated:2",
  ]);
  assert.deepEqual(resolved.featureDossiers[0].unresolvedQuestions, [
    'No graph node resolved events reference "missing-event".',
  ]);
  assert.deepEqual(draft.featureDossiers[0].events, [
    "driver.offer.updated",
    "missing-event",
  ]);
  assert.deepEqual(resolved.capabilities[0].entrypointNodeIds, [
    "entrypoint:offers",
  ]);
  assert.deepEqual(resolved.capabilities[0].evidenceNodeIds, [
    "function:service:DriverService.offerTrip",
  ]);
  const invented = structuredClone(draft);
  invented.capabilities[0].evidenceNodeIds = ["class:service:invented"];
  assert.deepEqual(
    resolveDossierReferences(graph(), invented).capabilities[0].evidenceNodeIds,
    ["class:service:invented"],
  );
});

test("canonicalizes a line-qualified model reference by exact type, file, and name", () => {
  const repositoryGraph = graph();
  repositoryGraph.files.push(
    { id: "file:routers/tutors.py", type: "file", path: "routers/tutors.py", language: "python", contentHash: "tutors" },
    { id: "file:routers/tutors_additions.py", type: "file", path: "routers/tutors_additions.py", language: "python", contentHash: "additions" },
  );
  repositoryGraph.symbols.push(
    { id: "function:routers/tutors.py:create_session_log", type: "function", name: "create_session_log", fileId: "file:routers/tutors.py", lineRange: { start: 1152, end: 1251 }, exported: true },
    { id: "function:routers/tutors_additions.py:create_session_log", type: "function", name: "create_session_log", fileId: "file:routers/tutors_additions.py", lineRange: { start: 196, end: 295 }, exported: true },
  );
  const draft = emptyDraft();
  draft.uncertainties.push({
    id: "session-log",
    statement: "Session logging behavior requires review.",
    reason: "Two implementations exist.",
    evidenceNodeIds: ["function:routers/tutors.py:1152:create_session_log"],
  });

  const resolved = resolveDossierReferences(repositoryGraph, draft);

  assert.deepEqual(resolved.uncertainties[0].evidenceNodeIds, [
    "function:routers/tutors.py:create_session_log",
  ]);
});

test("canonicalizes a component-screen alias only within the exact file and name", () => {
  const repositoryGraph = graph();
  repositoryGraph.files.push(
    { id: "file:app/create-listing.tsx", type: "file", path: "app/create-listing.tsx", language: "typescript", contentHash: "listing" },
  );
  repositoryGraph.symbols.push(
    { id: "function:app/create-listing.tsx:CreateListingScreen", type: "function", name: "CreateListingScreen", fileId: "file:app/create-listing.tsx", lineRange: { start: 24, end: 446 }, exported: true },
  );
  repositoryGraph.entities.push(
    { id: "screen:app/create-listing.tsx:CreateListingScreen", type: "screen", name: "CreateListingScreen", symbolId: "function:app/create-listing.tsx:CreateListingScreen", fileId: "file:app/create-listing.tsx", lineRange: { start: 24, end: 446 }, evidence: { file: "app/create-listing.tsx", line: 24, extractor: "tree-sitter" } },
  );
  const draft = emptyDraft();
  draft.uncertainties.push({
    id: "listing-ui",
    statement: "Listing creation has a UI.",
    reason: "Confirm the screen behavior.",
    evidenceNodeIds: ["component:app/create-listing.tsx:CreateListingScreen"],
  });

  const resolved = resolveDossierReferences(repositoryGraph, draft);

  assert.deepEqual(resolved.uncertainties[0].evidenceNodeIds, [
    "screen:app/create-listing.tsx:CreateListingScreen",
  ]);
});

function graph() {
  return {
    version: 4,
    analysis: {
      sourceFileCount: 1,
      parsedSourceFileCount: 1,
      unparsedSourceFiles: [],
      diagnostics: [],
    },
    files: [{ id: "file:service", type: "file", path: "service.ts", language: "typescript", contentHash: "hash" }],
    symbols: [{ id: "function:service:DriverService.offerTrip", type: "function", name: "DriverService.offerTrip", fileId: "file:service", lineRange: { start: 1, end: 2 }, exported: false }],
    entrypoints: [{ id: "entrypoint:offers", type: "entrypoint", kind: "http", name: "POST /offers", exposure: "external", httpMethod: "POST", route: "/offers", fileId: "file:service", lineRange: { start: 4, end: 4 }, evidence: { file: "service.ts", line: 4, extractor: "tree-sitter" } }],
    entities: [
      { id: "event:offer-updated:1", type: "event", name: "driver.offer.updated", operation: "publish", fileId: "file:service", lineRange: { start: 6, end: 6 }, evidence: { file: "service.ts", line: 6, extractor: "tree-sitter" } },
      { id: "event:offer-updated:2", type: "event", name: "driver.offer.updated", operation: "publish", fileId: "file:service", lineRange: { start: 7, end: 7 }, evidence: { file: "service.ts", line: 7, extractor: "tree-sitter" } },
    ],
    edges: [],
  };
}

function emptyDraft() {
  return {
    featureDossiers: [],
    capabilities: [],
    userFlows: [],
    requirements: [],
    uncertainties: [],
  };
}
