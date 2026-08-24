import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertFeatureClustersRespectReachability,
  clusterRepositoryFeatures,
  findFeatureImpact,
} from "./clusterRepositoryFeatures.ts";

test("builds overlapping feature clusters and isolates shared database infrastructure", () => {
  const graph = ecommerceGraph();
  const options = {
    documentationSeeds: [
      {
        id: "doc:checkout-email",
        evidenceNodeId: "file:README.md",
        heading: "Checkout notifications",
        text: "Email the customer a receipt after checkout.",
      },
      {
        id: "doc:invoice-export",
        evidenceNodeId: "file:README.md",
        heading: "Invoice export",
        text: "Customers can export invoices.",
      },
    ],
  };

  const result = clusterRepositoryFeatures(graph, options);
  const checkout = result.clusters.find((cluster) => cluster.label === "POST /checkout");
  const orders = result.clusters.find((cluster) => cluster.label === "GET /orders");

  assert.ok(checkout);
  assert.ok(orders);
  assert.ok(checkout.members.some((member) => member.nodeId === "function:sendReceipt"));
  assert.ok(checkout.members.some((member) => member.nodeId === "function:databaseQuery"));
  assert.ok(orders.members.some((member) => member.nodeId === "function:databaseQuery"));
  assert.ok(!orders.members.some((member) => member.nodeId === "function:sendReceipt"));

  assert.deepEqual(checkout.documentationSeedIds, ["doc:checkout-email"]);
  assert.equal(
    result.documentationMappings.find(
      (mapping) => mapping.documentationSeedId === "doc:invoice-export",
    )?.status,
    "unmatched",
  );

  assert.equal(result.sharedSubsystems.length, 1);
  assert.equal(result.sharedSubsystems[0].label, "Database subsystem");
  assert.deepEqual(result.sharedSubsystems[0].featureClusterIds, [
    checkout.id,
    orders.id,
  ].sort());
  assert.ok(
    result.sharedSubsystems[0].memberNodeIds.includes("function:databaseQuery"),
  );
  assert.ok(
    result.sharedSubsystems[0].memberNodeIds.includes("function:beginTransaction"),
  );
  assert.ok(
    result.sharedSubsystems[0].memberNodeIds.includes("file:src/database.ts"),
  );

  assert.deepEqual(
    result.unassignedCode.map((candidate) => candidate.nodeId),
    ["function:unusedCouponFormatter"],
  );
  assert.equal(result.unassignedCode[0].reviewKind, "isolated");
  assert.equal(
    result.unassignedCode[0].reachabilityStatus,
    "disconnected_candidate",
  );
  assert.match(result.unassignedCode[0].reason, /candidate, not proof/);

  const invalid = structuredClone(result);
  invalid.clusters[0].members.push({
    nodeId: "function:unusedCouponFormatter",
    role: "service",
    score: 0.5,
    path: [],
    reachabilityStatus: "disconnected_candidate",
  });
  assert.throws(
    () => assertFeatureClustersRespectReachability(invalid),
    /contains disallowed disconnected_candidate node/,
  );

  const databaseImpact = findFeatureImpact(result, "function:databaseQuery");
  assert.deepEqual(databaseImpact.featureClusterIds, [checkout.id, orders.id].sort());
  assert.deepEqual(databaseImpact.sharedSubsystemIds, [result.sharedSubsystems[0].id]);

  const emailImpact = findFeatureImpact(result, "function:sendReceipt");
  assert.deepEqual(emailImpact.featureClusterIds, [checkout.id]);
  assert.deepEqual(emailImpact.sharedSubsystemIds, []);

  assert.deepEqual(clusterRepositoryFeatures(graph, options), result);
});

test("attaches class state initialization without pulling in unrelated methods", () => {
  const routeFile = file("file:route.py", "route.py");
  const serviceFile = file("file:service.py", "service.py");
  const symbols = [
    symbol("function:handler", "handler", routeFile.id, true),
    { ...symbol("class:Service", "Service", serviceFile.id, true), type: "class" },
    symbol("function:Service.__init__", "Service.__init__", serviceFile.id, false),
    symbol("function:Service.run", "Service.run", serviceFile.id, false),
    symbol("function:Service.unused", "Service.unused", serviceFile.id, false),
    symbol("function:database", "database", serviceFile.id, false),
  ];
  const source = entrypoint(
    "entrypoint:run",
    "Run",
    "POST",
    "/run",
    routeFile.id,
    "function:handler",
  );
  const endpointNode = endpoint("endpoint:run", source);
  const graph = {
    version: 4,
    analysis: {
      sourceFileCount: 2,
      parsedSourceFileCount: 2,
      unparsedSourceFiles: [],
      diagnostics: [],
    },
    files: [routeFile, serviceFile],
    symbols,
    entrypoints: [source],
    entities: [endpointNode],
    edges: [
      edge(endpointNode.id, "function:handler", "HANDLED_BY", "route.py"),
      edge("function:handler", "function:Service.run", "CALLS", "route.py"),
      edge("function:Service.__init__", "function:database", "CALLS", "service.py"),
    ],
  };

  const cluster = clusterRepositoryFeatures(graph).clusters[0];
  assert.ok(cluster.members.some((member) => member.nodeId === "class:Service"));
  assert.ok(cluster.members.some((member) => member.nodeId === "function:Service.__init__"));
  assert.ok(cluster.members.some((member) => member.nodeId === "function:database"));
  assert.ok(!cluster.members.some((member) => member.nodeId === "function:Service.unused"));
});

function ecommerceGraph() {
  const files = [
    file("file:src/checkout.ts", "src/checkout.ts"),
    file("file:src/orders.ts", "src/orders.ts"),
    file("file:src/database.ts", "src/database.ts"),
    file("file:src/email.ts", "src/email.ts"),
    file("file:src/unused.ts", "src/unused.ts"),
  ];
  const symbols = [
    symbol("function:checkout", "checkout", "file:src/checkout.ts", false),
    symbol("function:persistOrder", "persistOrder", "file:src/checkout.ts", false),
    symbol("function:orders", "orders", "file:src/orders.ts", false),
    symbol("function:readOrders", "readOrders", "file:src/orders.ts", false),
    symbol(
      "function:beginTransaction",
      "beginTransaction",
      "file:src/database.ts",
      true,
    ),
    symbol("function:databaseQuery", "databaseQuery", "file:src/database.ts", true),
    symbol("function:sendReceipt", "sendReceipt", "file:src/email.ts", true),
    symbol(
      "function:unusedCouponFormatter",
      "unusedCouponFormatter",
      "file:src/unused.ts",
      false,
    ),
  ];
  const checkoutEntrypoint = entrypoint(
    "entrypoint:checkout",
    "Checkout",
    "POST",
    "/checkout",
    "file:src/checkout.ts",
    "function:checkout",
  );
  const ordersEntrypoint = entrypoint(
    "entrypoint:orders",
    "Orders",
    "GET",
    "/orders",
    "file:src/orders.ts",
    "function:orders",
  );
  const checkoutEndpoint = endpoint(
    "endpoint:checkout",
    checkoutEntrypoint,
  );
  const ordersEndpoint = endpoint("endpoint:orders", ordersEntrypoint);

  return {
    version: 4,
    analysis: {
      sourceFileCount: files.length,
      parsedSourceFileCount: files.length,
      unparsedSourceFiles: [],
      diagnostics: [],
    },
    files,
    symbols,
    entrypoints: [checkoutEntrypoint, ordersEntrypoint],
    entities: [checkoutEndpoint, ordersEndpoint],
    edges: [
      edge(
        checkoutEndpoint.id,
        "function:checkout",
        "HANDLED_BY",
        "src/checkout.ts",
      ),
      edge(
        ordersEndpoint.id,
        "function:orders",
        "HANDLED_BY",
        "src/orders.ts",
      ),
      edge(
        "function:checkout",
        "function:persistOrder",
        "CALLS",
        "src/checkout.ts",
      ),
      edge(
        "function:persistOrder",
        "function:beginTransaction",
        "CALLS",
        "src/checkout.ts",
      ),
      edge(
        "function:beginTransaction",
        "function:databaseQuery",
        "CALLS",
        "src/database.ts",
      ),
      edge(
        "function:checkout",
        "function:sendReceipt",
        "CALLS",
        "src/checkout.ts",
      ),
      edge(
        "function:orders",
        "function:readOrders",
        "CALLS",
        "src/orders.ts",
      ),
      edge(
        "function:readOrders",
        "function:databaseQuery",
        "CALLS",
        "src/orders.ts",
      ),
    ],
  };
}

function file(id, path) {
  return {
    id,
    type: "file",
    path,
    language: "typescript",
    contentHash: `hash:${path}`,
    lineRange: { start: 1, end: 20 },
  };
}

function symbol(id, name, fileId, exported) {
  return {
    id,
    type: "function",
    name,
    fileId,
    lineRange: { start: 1, end: 2 },
    exported,
  };
}

function entrypoint(id, name, httpMethod, route, fileId, handlerSymbolId) {
  const path = fileId.replace(/^file:/, "");
  return {
    id,
    type: "entrypoint",
    kind: "http",
    name,
    exposure: "external",
    httpMethod,
    route,
    fileId,
    handlerSymbolId,
    lineRange: { start: 1, end: 2 },
    evidence: { file: path, line: 1, extractor: "scanner" },
  };
}

function endpoint(id, sourceEntrypoint) {
  const path = sourceEntrypoint.fileId.replace(/^file:/, "");
  return {
    id,
    type: "endpoint",
    name: sourceEntrypoint.name,
    fileId: sourceEntrypoint.fileId,
    entrypointId: sourceEntrypoint.id,
    kind: sourceEntrypoint.kind,
    httpMethod: sourceEntrypoint.httpMethod,
    route: sourceEntrypoint.route,
    lineRange: { start: 1, end: 2 },
    evidence: { file: path, line: 1, extractor: "scanner" },
  };
}

function edge(source, target, type, filePath) {
  return {
    source,
    target,
    type,
    evidence: { file: filePath, line: 1, extractor: "resolver" },
  };
}
