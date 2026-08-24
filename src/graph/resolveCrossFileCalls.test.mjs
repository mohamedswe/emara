import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSourceFile } from "../parser/parseSourceFile.ts";
import { parsePythonSourceFile } from "../languages/python/parsePythonSourceFile.ts";
import { buildRepositoryGraph } from "./buildRepositoryGraph.ts";

test("resolves Python from-imports and relative module members", () => {
  const services = parsePythonSourceFile(
    "app/services.py",
    "def create(payload):\n    return payload\n",
  );
  const helpers = parsePythonSourceFile(
    "app/helpers.py",
    "def audit(payload):\n    return payload\n",
  );
  const api = parsePythonSourceFile("app/api.py", [
    "from .services import create",
    "from . import helpers",
    "def create_user(payload):",
    "    helpers.audit(payload)",
    "    return create(payload)",
  ].join("\n"));
  const graph = buildRepositoryGraph(
    [
      scannedFile("app/api.py", "python"),
      scannedFile("app/helpers.py", "python"),
      scannedFile("app/services.py", "python"),
    ],
    [api, helpers, services],
  );

  assert.deepEqual(callEdges(graph), [
    callEdge("app/api.py", "create_user", "app/helpers.py", "audit", 4),
    callEdge("app/api.py", "create_user", "app/services.py", "create", 5),
  ]);
});

test("resolves Python same-file calls without crossing parameter shadowing", () => {
  const parsed = parsePythonSourceFile("app/api.py", [
    "def helper():",
    "    return True",
    "def endpoint():",
    "    return helper()",
    "def shadowed(helper):",
    "    return helper()",
  ].join("\n"));
  const graph = buildRepositoryGraph(
    [scannedFile("app/api.py", "python")],
    [parsed],
  );

  assert.deepEqual(callEdges(graph), [
    callEdge("app/api.py", "endpoint", "app/api.py", "helper", 4),
  ]);
});

test("resolves Python imported singleton methods and same-class helper calls", () => {
  const service = parsePythonSourceFile("app/service.py", [
    "class ChatService:",
    "    def helper(self):",
    "        return True",
    "    def chat(self):",
    "        return self.helper()",
    "chat_service = ChatService()",
  ].join("\n"));
  const api = parsePythonSourceFile("app/api.py", [
    "from .service import chat_service",
    "def endpoint():",
    "    return chat_service.chat()",
  ].join("\n"));
  const graph = buildRepositoryGraph(
    [
      scannedFile("app/api.py", "python"),
      scannedFile("app/service.py", "python"),
    ],
    [api, service],
  );

  assert.deepEqual(callEdges(graph), [
    callEdge("app/api.py", "endpoint", "app/service.py", "ChatService.chat", 3),
    callEdge(
      "app/service.py",
      "ChatService.chat",
      "app/service.py",
      "ChatService.helper",
      5,
    ),
  ]);
});

test("resolves imported class method calls to the method symbol", () => {
  const controller = parsePythonSourceFile("app/client_controller.py", [
    "class ClientController:",
    "    @staticmethod",
    "    async def get_client(client_id):",
    "        return client_id",
  ].join("\n"));
  const routes = parsePythonSourceFile("app/routes.py", [
    "from .client_controller import ClientController",
    "async def get_client(client_id):",
    "    return await ClientController.get_client(client_id)",
  ].join("\n"));
  const graph = buildRepositoryGraph(
    [
      scannedFile("app/client_controller.py", "python"),
      scannedFile("app/routes.py", "python"),
    ],
    [controller, routes],
  );

  assert.deepEqual(callEdges(graph), [
    callEdge(
      "app/routes.py",
      "get_client",
      "app/client_controller.py",
      "ClientController.get_client",
      3,
    ),
  ]);
});

test("does not infer imported singleton methods without a unique local constructor", () => {
  const service = parsePythonSourceFile("app/service.py", [
    "class ChatService:",
    "    def chat(self):",
    "        return True",
    "chat_service = make_service()",
  ].join("\n"));
  const api = parsePythonSourceFile("app/api.py", [
    "from .service import chat_service",
    "def endpoint():",
    "    return chat_service.chat()",
  ].join("\n"));
  const graph = buildRepositoryGraph(
    [
      scannedFile("app/api.py", "python"),
      scannedFile("app/service.py", "python"),
    ],
    [api, service],
  );

  assert.deepEqual(callEdges(graph), []);
});

test("resolves uniquely imported functions and namespace members", () => {
  const payment = parseSourceFile(
    "src/payment.ts",
    [
      "export function charge(amount: number) {}",
      "function refundImpl() {}",
      "export { refundImpl as refund };",
      "export default function settle() {}",
    ].join("\n"),
  );
  const checkout = parseSourceFile(
    "src/checkout.ts",
    [
      'import settlePayment, { charge as chargeCard, refund } from "./payment.js";',
      'import * as payments from "./payment.js";',
      "export function checkout() {",
      "  chargeCard(10);",
      "  refund();",
      "  settlePayment();",
      "  payments.charge(20);",
      "  payments.refund();",
      "}",
    ].join("\n"),
  );
  const scannedFiles = [
    scannedFile("src/payment.ts"),
    scannedFile("src/checkout.ts"),
  ];

  const graph = buildRepositoryGraph(scannedFiles, [payment, checkout]);
  const rebuilt = buildRepositoryGraph(
    [...scannedFiles].reverse(),
    [payment, checkout].map(reverseParsedArrays).reverse(),
  );

  assert.deepEqual(callEdges(graph), [
    callEdge("src/checkout.ts", "checkout", "src/payment.ts", "charge", 4),
    callEdge(
      "src/checkout.ts",
      "checkout",
      "src/payment.ts",
      "refundImpl",
      5,
    ),
    callEdge("src/checkout.ts", "checkout", "src/payment.ts", "settle", 6),
    callEdge("src/checkout.ts", "checkout", "src/payment.ts", "charge", 7),
    callEdge(
      "src/checkout.ts",
      "checkout",
      "src/payment.ts",
      "refundImpl",
      8,
    ),
  ]);
  assert.equal(JSON.stringify(graph), JSON.stringify(rebuilt));
});

test("resolves destructured and namespace-style CommonJS calls", () => {
  const payment = parseSourceFile(
    "src/payment.cjs",
    [
      "function charge() {}",
      "exports.charge = charge;",
      "exports.handler = () => {};",
    ].join("\n"),
  );
  const checkout = parseSourceFile(
    "src/checkout.cjs",
    [
      'const { charge: runCharge } = require("./payment.cjs");',
      'const payment = require("./payment.cjs");',
      "function checkout() {",
      "  runCharge();",
      "  payment.handler();",
      "}",
    ].join("\n"),
  );
  const graph = buildRepositoryGraph(
    [
      scannedFile("src/checkout.cjs", "javascript"),
      scannedFile("src/payment.cjs", "javascript"),
    ],
    [checkout, payment],
  );

  assert.deepEqual(callEdges(graph), [
    callEdge("src/checkout.cjs", "checkout", "src/payment.cjs", "charge", 4),
    callEdge("src/checkout.cjs", "checkout", "src/payment.cjs", "handler", 5),
  ]);
});

test("resolves calls through the local CommonJS export object", () => {
  const utility = parseSourceFile(
    "server/util.cjs",
    [
      "exports.ping = async () => exports.pingAsync();",
      "exports.pingAsync = async () => true;",
      "module.exports.run = () => module.exports.runAsync();",
      "module.exports.runAsync = () => true;",
    ].join("\n"),
  );
  const graph = buildRepositoryGraph(
    [scannedFile("server/util.cjs", "javascript")],
    [utility],
  );

  assert.deepEqual(callEdges(graph), [
    callEdge("server/util.cjs", "ping", "server/util.cjs", "pingAsync", 1),
    callEdge("server/util.cjs", "run", "server/util.cjs", "runAsync", 3),
  ]);
});

test("resolves local calls without fabricating imported calls across shadowing", () => {
  const target = parseSourceFile(
    "src/target.ts",
    [
      "export function run() {}",
      "function hidden() {}",
      "export class Service {}",
    ].join("\n"),
  );
  const barrel = parseSourceFile(
    "src/barrel.ts",
    'export { run } from "./target";',
  );
  const source = parseSourceFile(
    "src/source.ts",
    [
      'import { run } from "./target";',
      'import defaultThing from "./target";',
      'import * as target from "./target";',
      'import { run as barrelRun } from "./barrel";',
      "run();",
      "export function parameter(run: () => void) { run(); }",
      "export function local() { const run = () => {}; run(); }",
      "export function indirect() { run.call(null); target.run.deep(); defaultThing.method(); }",
      "export function classCall() { target.Service(); }",
      "export function hiddenCall() { target.hidden(); }",
      "export function barrelCall() { barrelRun(); }",
    ].join("\n"),
  );
  const graph = buildRepositoryGraph(
    [
      scannedFile("src/barrel.ts"),
      scannedFile("src/source.ts"),
      scannedFile("src/target.ts"),
    ],
    [source, target, barrel],
  );

  assert.deepEqual(callEdges(graph), [
    callEdge("src/source.ts", "local", "src/source.ts", "run", 7),
  ]);
});

function callEdges(graph) {
  return graph.edges.filter((edge) => edge.type === "CALLS");
}

function scannedFile(path, language = "typescript") {
  return {
    path,
    language,
    contentHash: `${path}-hash`,
  };
}

function callEdge(sourcePath, caller, targetPath, target, line) {
  return {
    source: `function:${sourcePath}:${caller}`,
    target: `function:${targetPath}:${target}`,
    type: "CALLS",
    evidence: {
      file: sourcePath,
      line,
      extractor: "resolver",
    },
  };
}

function reverseParsedArrays(parsedFile) {
  return {
    ...parsedFile,
    symbols: [...parsedFile.symbols].reverse(),
    imports: [...parsedFile.imports].reverse(),
    exports: [...parsedFile.exports].reverse(),
    calls: [...parsedFile.calls].reverse(),
  };
}
