import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { buildFeatureMap, validateFeatureMap } from "./buildFeatureMap.ts";
import { renderFeatureMapHtml } from "./renderFeatureMapHtml.ts";
import { parseGitHubSpec } from "./serveFeatureMap.ts";

function createSyntheticGraphAndAudit() {
  const graph = {
    version: 4,
    analysis: {
      sourceFileCount: 5,
      parsedSourceFileCount: 5,
      unparsedSourceFiles: [],
      diagnostics: [],
    },
    files: [
      {
        id: "file:src/config.ts",
        type: "file",
        path: "src/config.ts",
        language: "typescript",
        contentHash: "a".repeat(64),
        lineRange: { start: 1, end: 20 },
      },
      {
        id: "file:src/models/Room.ts",
        type: "file",
        path: "src/models/Room.ts",
        language: "typescript",
        contentHash: "b".repeat(64),
        lineRange: { start: 1, end: 60 },
      },
      {
        id: "file:src/routes/bookings.ts",
        type: "file",
        path: "src/routes/bookings.ts",
        language: "typescript",
        contentHash: "c".repeat(64),
        lineRange: { start: 1, end: 80 },
      },
      {
        id: "file:src/routes/rooms.ts",
        type: "file",
        path: "src/routes/rooms.ts",
        language: "typescript",
        contentHash: "d".repeat(64),
        lineRange: { start: 1, end: 50 },
      },
      {
        id: "file:src/legacy/unused.ts",
        type: "file",
        path: "src/legacy/unused.ts",
        language: "typescript",
        contentHash: "e".repeat(64),
        lineRange: { start: 1, end: 30 },
      },
    ],
    symbols: [
      {
        id: "variable:src/config.ts:dbUrl",
        type: "variable",
        name: "dbUrl",
        fileId: "file:src/config.ts",
        lineRange: { start: 3, end: 5 },
        exported: true,
      },
      {
        id: "function:src/routes/bookings.ts:createBooking",
        type: "function",
        name: "createBooking",
        fileId: "file:src/routes/bookings.ts",
        lineRange: { start: 10, end: 45 },
        exported: true,
      },
      {
        id: "function:src/routes/rooms.ts:listRooms",
        type: "function",
        name: "listRooms",
        fileId: "file:src/routes/rooms.ts",
        lineRange: { start: 8, end: 30 },
        exported: true,
      },
      {
        id: "class:src/models/Room.ts:RoomModel",
        type: "class",
        name: "RoomModel",
        fileId: "file:src/models/Room.ts",
        lineRange: { start: 5, end: 55 },
        exported: true,
      },
      {
        id: "function:src/legacy/unused.ts:oldHelper",
        type: "function",
        name: "oldHelper",
        fileId: "file:src/legacy/unused.ts",
        lineRange: { start: 1, end: 30 },
        exported: true,
      },
    ],
    entrypoints: [
      {
        id: "entrypoint:http:src/routes/bookings.ts:10:POST /bookings",
        type: "entrypoint",
        kind: "http",
        name: "POST /bookings",
        exposure: "external",
        httpMethod: "POST",
        route: "/bookings",
        fileId: "file:src/routes/bookings.ts",
        handlerSymbolId: "function:src/routes/bookings.ts:createBooking",
        lineRange: { start: 10, end: 45 },
        evidence: {
          file: "src/routes/bookings.ts",
          line: 10,
          extractor: "tree-sitter",
        },
      },
      {
        id: "entrypoint:http:src/routes/rooms.ts:8:GET /rooms",
        type: "entrypoint",
        kind: "http",
        name: "GET /rooms",
        exposure: "external",
        httpMethod: "GET",
        route: "/rooms",
        fileId: "file:src/routes/rooms.ts",
        handlerSymbolId: "function:src/routes/rooms.ts:listRooms",
        lineRange: { start: 8, end: 30 },
        evidence: {
          file: "src/routes/rooms.ts",
          line: 8,
          extractor: "tree-sitter",
        },
      },
    ],
    entities: [
      {
        id: "endpoint:http:src/routes/bookings.ts:10:POST /bookings",
        type: "endpoint",
        name: "POST /bookings",
        fileId: "file:src/routes/bookings.ts",
        entrypointId: "entrypoint:http:src/routes/bookings.ts:10:POST /bookings",
        kind: "http",
        httpMethod: "POST",
        route: "/bookings",
        lineRange: { start: 10, end: 45 },
        evidence: {
          file: "src/routes/bookings.ts",
          line: 10,
          extractor: "tree-sitter",
        },
      },
      {
        id: "endpoint:http:src/routes/rooms.ts:8:GET /rooms",
        type: "endpoint",
        name: "GET /rooms",
        fileId: "file:src/routes/rooms.ts",
        entrypointId: "entrypoint:http:src/routes/rooms.ts:8:GET /rooms",
        kind: "http",
        httpMethod: "GET",
        route: "/rooms",
        lineRange: { start: 8, end: 30 },
        evidence: {
          file: "src/routes/rooms.ts",
          line: 8,
          extractor: "tree-sitter",
        },
      },
      {
        id: "config:src/config.ts:dbUrl",
        type: "config",
        name: "dbUrl",
        fileId: "file:src/config.ts",
        symbolId: "variable:src/config.ts:dbUrl",
        lineRange: { start: 3, end: 5 },
        evidence: {
          file: "src/config.ts",
          line: 3,
          extractor: "tree-sitter",
        },
      },
      {
        id: "schema:src/models/Room.ts:roomSchema",
        type: "schema",
        name: "roomSchema",
        fileId: "file:src/models/Room.ts",
        symbolId: "class:src/models/Room.ts:RoomModel",
        lineRange: { start: 12, end: 40 },
        evidence: {
          file: "src/models/Room.ts",
          line: 12,
          extractor: "tree-sitter",
        },
      },
    ],
    edges: [
      {
        source: "endpoint:http:src/routes/bookings.ts:10:POST /bookings",
        target: "function:src/routes/bookings.ts:createBooking",
        type: "HANDLED_BY",
        evidence: {
          file: "src/routes/bookings.ts",
          line: 10,
          extractor: "tree-sitter",
        },
      },
      {
        source: "endpoint:http:src/routes/rooms.ts:8:GET /rooms",
        target: "function:src/routes/rooms.ts:listRooms",
        type: "HANDLED_BY",
        evidence: {
          file: "src/routes/rooms.ts",
          line: 8,
          extractor: "tree-sitter",
        },
      },
      {
        source: "file:src/routes/bookings.ts",
        target: "file:src/models/Room.ts",
        type: "IMPORTS",
        evidence: {
          file: "src/routes/bookings.ts",
          line: 2,
          extractor: "resolver",
        },
      },
      {
        source: "file:src/routes/rooms.ts",
        target: "file:src/models/Room.ts",
        type: "IMPORTS",
        evidence: {
          file: "src/routes/rooms.ts",
          line: 1,
          extractor: "resolver",
        },
      },
      {
        source: "file:src/models/Room.ts",
        target: "file:src/config.ts",
        type: "IMPORTS",
        evidence: {
          file: "src/models/Room.ts",
          line: 1,
          extractor: "resolver",
        },
      },
    ],
  };

  const audit = {
    schema: "functionality-audit/v2",
    repositoryCommit: "0123456789abcdef0123456789abcdef01234567",
    summary: {
      implemented_documented: 2,
      implemented_undocumented: 0,
      documented_not_implemented: 0,
      partially_implemented: 0,
      ambiguous: 0,
      dead_code_candidates: 1,
      ready_for_delete_validation: 1,
      validated_safe_to_delete: 0,
    },
    features: [
      {
        canonicalId: "feature-11111111111111111111",
        id: "post-bookings",
        title: "Create booking",
        kind: "functional",
        status: "IMPLEMENTED_DOCUMENTED",
        entrypointNodeIds: [
          "entrypoint:http:src/routes/bookings.ts:10:POST /bookings",
        ],
        implementationNodeIds: [
          "file:src/routes/bookings.ts",
          "function:src/routes/bookings.ts:createBooking",
        ],
        documentationPromiseIds: [],
        gaps: [],
        confidence: "HIGH",
      },
      {
        canonicalId: "feature-22222222222222222222",
        id: "get-rooms",
        title: "List rooms",
        kind: "functional",
        status: "IMPLEMENTED_DOCUMENTED",
        entrypointNodeIds: [
          "entrypoint:http:src/routes/rooms.ts:8:GET /rooms",
        ],
        implementationNodeIds: [
          "file:src/routes/rooms.ts",
          "function:src/routes/rooms.ts:listRooms",
        ],
        documentationPromiseIds: [],
        gaps: [],
        confidence: "HIGH",
      },
    ],
    documentationPromises: [],
    declaredClaims: [],
    featureSourceDisagreements: [],
    deadCodeCandidates: [
      {
        id: "dead:src/legacy/unused.ts:oldHelper",
        nodeIds: ["function:src/legacy/unused.ts:oldHelper"],
        file: "src/legacy/unused.ts",
        line: 1,
        symbol: "oldHelper",
        reachabilityStatus: "disconnected_candidate",
        verdict: "VALIDATION_REQUIRED",
        reason: "No runtime path reaches oldHelper.",
        blockers: ["Run isolated deletion validation."],
        validation: null,
      },
    ],
    coverage: {
      recognizedEntrypointIds: [
        "entrypoint:http:src/routes/bookings.ts:10:POST /bookings",
        "entrypoint:http:src/routes/rooms.ts:8:GET /rooms",
      ],
      entrypointFeatureMap: {
        "entrypoint:http:src/routes/bookings.ts:10:POST /bookings": [
          "post-bookings",
        ],
        "entrypoint:http:src/routes/rooms.ts:8:GET /rooms": ["get-rooms"],
      },
      unclassifiedEntrypointIds: [],
      documentationPromiseIds: [],
      documentationFeatureMap: {},
      unclassifiedDocumentationPromiseIds: [],
      productionReachabilityCounts: {
        product_reachable: 4,
        startup_reachable: 0,
        test_only: 0,
        public_api_unproven: 0,
        dynamic_unknown: 0,
        disconnected_candidate: 1,
      },
    },
    metrics: {
      wallClockMs: 0,
      deterministicWallClockMs: 0,
      modelRequests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cache: "cold",
    },
    limitations: [],
  };

  return { graph, audit };
}

test("buildFeatureMap partitions features, shared subsystems, baseplate infrastructure, and orphans", () => {
  const { graph, audit } = createSyntheticGraphAndAudit();
  const map = buildFeatureMap(graph, audit);

  validateFeatureMap(map);
  assert.equal(map.schema, "feature-map/v1");
  assert.equal(map.summary.featureBlocks, 2);
  assert.equal(map.summary.sharedSubsystemBlocks, 1);
  assert.equal(map.summary.infrastructureBlocks, 1);
  assert.equal(map.summary.orphanBlocks, 1);

  const bookings = map.blocks.find((b) => b.slug === "post-bookings");
  const rooms = map.blocks.find((b) => b.slug === "get-rooms");
  const sharedRoomModel = map.blocks.find((b) => b.kind === "shared_subsystem");
  const baseplate = map.blocks.find((b) => b.kind === "infrastructure");
  const orphan = map.blocks.find((b) => b.kind === "orphan");

  assert.ok(bookings);
  assert.ok(rooms);
  assert.ok(sharedRoomModel);
  assert.ok(baseplate);
  assert.ok(orphan);

  // Studs on feature blocks
  assert.equal(bookings.studs[0]?.label, "POST /bookings");
  assert.equal(rooms.studs[0]?.label, "GET /rooms");

  // Shared Room model exposes schema & class studs
  assert.ok(sharedRoomModel.filePaths.includes("src/models/Room.ts"));
  assert.ok(
    sharedRoomModel.studs.some((stud) => stud.label === "roomSchema"),
  );

  // Both features rest on the shared Room model with clickable source evidence
  const bookingsToModel = map.connections.find(
    (c) => c.from === bookings.id && c.to === sharedRoomModel.id,
  );
  const roomsToModel = map.connections.find(
    (c) => c.from === rooms.id && c.to === sharedRoomModel.id,
  );
  assert.ok(bookingsToModel);
  assert.equal(bookingsToModel.kind, "rests_on");
  assert.deepEqual(bookingsToModel.evidence[0], {
    file: "src/routes/bookings.ts",
    line: 2,
  });
  assert.ok(roomsToModel);

  // Counterfactual "Pull a brick out": removing bookings frees its exclusive file
  // and degrades the shared Room model from 2 consumers down to 1.
  assert.deepEqual(bookings.removalImpact?.freedFiles, [
    "src/routes/bookings.ts",
  ]);
  assert.equal(bookings.removalImpact?.freedLines, 80);
  assert.deepEqual(
    bookings.removalImpact?.degradedToSingleConsumerBlockIds,
    [sharedRoomModel.id],
  );

  // Repeat-run determinism
  const secondMap = buildFeatureMap(graph, audit);
  assert.deepEqual(map, secondMap);
});

test("buildFeatureMap derives Room & Auth shared subsystems on the room-booking fixture", async (t) => {
  const demoDir = resolve(
    process.cwd(),
    "../emara-viz/public/demo-mapping",
  );
  let graph;
  let audit;
  try {
    graph = JSON.parse(await readFile(resolve(demoDir, "graph.json"), "utf8"));
    audit = JSON.parse(
      await readFile(resolve(demoDir, "functionality-audit.json"), "utf8"),
    );
  } catch {
    t.skip("room-booking demo artifacts not present alongside repo");
    return;
  }

  const map = buildFeatureMap(graph, audit);
  validateFeatureMap(map);

  const sharedTitles = map.blocks
    .filter((b) => b.kind === "shared_subsystem")
    .map((b) => b.title);
  assert.ok(sharedTitles.includes("Shared: models/Room"));
  assert.ok(sharedTitles.includes("Shared: middleware/auth"));

  const roomModelBlock = map.blocks.find(
    (b) => b.title === "Shared: models/Room",
  );
  const roomsCapabilityBlock = map.blocks.find((b) =>
    b.memberFeatureIds?.includes("post-rooms"),
  );
  assert.ok(roomModelBlock);
  assert.ok(roomsCapabilityBlock);
  assert.equal(roomsCapabilityBlock.studs.length, 4);
  assert.ok(
    map.connections.some(
      (c) =>
        c.from === roomsCapabilityBlock.id &&
        c.to === roomModelBlock.id &&
        c.kind === "rests_on",
    ),
  );
});

test("renderFeatureMapHtml emits a self-contained HTML viewer with embedded payload and source lines", () => {
  const { graph, audit } = createSyntheticGraphAndAudit();
  const featureMap = buildFeatureMap(graph, audit);
  const html = renderFeatureMapHtml({
    repositoryName: "synthetic-booking",
    graph,
    featureMap,
    sourceFiles: [
      {
        file: {
          path: "src/routes/bookings.ts",
          language: "typescript",
          contentHash: "c".repeat(64),
        },
        content: "import { RoomModel } from '../models/Room';\nexport function createBooking() {}\n",
        parsed: { symbols: [], imports: [], calls: [], references: [], entities: [], entrypoints: [], diagnostics: [] },
      },
    ],
  });

  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.includes("synthetic-booking — Emara Feature Architecture"));
  assert.ok(html.includes("Create booking"));
  assert.ok(html.includes("Shared: models/Room"));
  assert.ok(html.includes("export function createBooking() {}"));
});

test("parseGitHubSpec parses GitHub commit URLs and owner/repo@sha shorthands", () => {
  assert.deepEqual(
    parseGitHubSpec("https://github.com/mohamedswe/emara/commit/9b40ef983d"),
    {
      owner: "mohamedswe",
      repo: "emara",
      ref: "9b40ef983d",
      cloneUrl: "https://github.com/mohamedswe/emara.git",
    },
  );
  assert.deepEqual(parseGitHubSpec("louislam/uptime-kuma@437fcd20ab"), {
    owner: "louislam",
    repo: "uptime-kuma",
    ref: "437fcd20ab",
    cloneUrl: "https://github.com/louislam/uptime-kuma.git",
  });
});


