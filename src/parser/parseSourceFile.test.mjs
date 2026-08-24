import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectParsedLanguage,
  parseSourceFile,
} from "./parseSourceFile.ts";

test("extracts TypeScript symbols, imports, exports, calls, and line ranges", () => {
  const source = [
    'import payment, {',
    '  charge as chargeCard,',
    '  type Card,',
    '} from "./payment";',
    'import * as utils from "./utils";',
    'import "./setup";',
    '',
    'export async function checkout(id: string) {',
    '  chargeCard(id);',
    '  utils.log(id);',
    '}',
    '',
    'const helper = (value: number) => value;',
    'export default class Checkout {',
    '  run() {',
    '    helper(1);',
    '    this.finish();',
    '  }',
    '  private finish() {}',
    '}',
    'export { helper as assist };',
    'export type { Card };',
    'export * from "./shared";',
    'export * as shared from "./shared";',
  ].join("\n");

  const parsed = parseSourceFile("src/checkout.ts", source);

  assert.equal(parsed.path, "src/checkout.ts");
  assert.equal(parsed.language, "typescript");
  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(parsed.symbols, [
    {
      type: "function",
      name: "checkout",
      exported: true,
      lineRange: { start: 8, end: 11 },
    },
    {
      type: "function",
      name: "helper",
      exported: true,
      lineRange: { start: 13, end: 13 },
    },
    {
      type: "class",
      name: "Checkout",
      exported: true,
      lineRange: { start: 14, end: 20 },
    },
    {
      type: "function",
      name: "Checkout.run",
      exported: false,
      lineRange: { start: 15, end: 18 },
    },
    {
      type: "function",
      name: "Checkout.finish",
      exported: false,
      lineRange: { start: 19, end: 19 },
    },
  ]);

  assert.deepEqual(
    parsed.imports.map(
      ({ kind, source: importSource, importedName, localName, typeOnly }) => ({
        kind,
        source: importSource,
        importedName,
        localName,
        typeOnly,
      }),
    ),
    [
      {
        kind: "default",
        source: "./payment",
        importedName: "default",
        localName: "payment",
        typeOnly: false,
      },
      {
        kind: "named",
        source: "./payment",
        importedName: "charge",
        localName: "chargeCard",
        typeOnly: false,
      },
      {
        kind: "named",
        source: "./payment",
        importedName: "Card",
        localName: "Card",
        typeOnly: true,
      },
      {
        kind: "namespace",
        source: "./utils",
        importedName: "*",
        localName: "utils",
        typeOnly: false,
      },
      {
        kind: "side-effect",
        source: "./setup",
        importedName: undefined,
        localName: undefined,
        typeOnly: false,
      },
    ],
  );

  assert.deepEqual(
    parsed.exports.map(
      ({ kind, exportedName, localName, source: exportSource, typeOnly }) => ({
        kind,
        exportedName,
        localName,
        source: exportSource,
        typeOnly,
      }),
    ),
    [
      {
        kind: "named",
        exportedName: "checkout",
        localName: "checkout",
        source: undefined,
        typeOnly: false,
      },
      {
        kind: "default",
        exportedName: "default",
        localName: "Checkout",
        source: undefined,
        typeOnly: false,
      },
      {
        kind: "named",
        exportedName: "assist",
        localName: "helper",
        source: undefined,
        typeOnly: false,
      },
      {
        kind: "named",
        exportedName: "Card",
        localName: "Card",
        source: undefined,
        typeOnly: true,
      },
      {
        kind: "all",
        exportedName: "*",
        localName: undefined,
        source: "./shared",
        typeOnly: false,
      },
      {
        kind: "namespace",
        exportedName: "shared",
        localName: undefined,
        source: "./shared",
        typeOnly: false,
      },
    ],
  );

  assert.deepEqual(parsed.calls, [
    {
      callee: "chargeCard",
      kind: "identifier",
      caller: "checkout",
      importedLocalName: "chargeCard",
      lineRange: { start: 9, end: 9 },
    },
    {
      callee: "utils.log",
      kind: "member",
      caller: "checkout",
      importedLocalName: "utils",
      lineRange: { start: 10, end: 10 },
    },
    {
      callee: "helper",
      kind: "identifier",
      caller: "Checkout.run",
      localTargetName: "helper",
      lineRange: { start: 16, end: 16 },
    },
    {
      callee: "this.finish",
      kind: "member",
      caller: "Checkout.run",
      lineRange: { start: 17, end: 17 },
    },
  ]);
});

test("extracts assigned functions and class field functions from JavaScript", () => {
  const source = [
    "const worker = function process() {",
    "  return run();",
    "};",
    "",
    "class Service {",
    "  execute() {",
    "    worker();",
    "  }",
    "  handler = () => notify();",
    "}",
    "",
    "export { Service };",
  ].join("\n");

  const parsed = parseSourceFile("src/service.js", source);

  assert.equal(parsed.language, "javascript");
  assert.deepEqual(
    parsed.symbols.map(({ name, exported }) => ({ name, exported })),
    [
      { name: "worker", exported: false },
      { name: "Service", exported: true },
      { name: "Service.execute", exported: false },
      { name: "Service.handler", exported: false },
    ],
  );
  assert.deepEqual(
    parsed.calls.map(({ callee, caller }) => ({ callee, caller })),
    [
      { callee: "run", caller: "worker" },
      { callee: "worker", caller: "Service.execute" },
      { callee: "notify", caller: "Service.handler" },
    ],
  );
  assert.deepEqual(parsed.diagnostics, []);
});

test("extracts top-level value definitions without duplicating assigned functions", () => {
  const parsed = parseSourceFile(
    "src/schemas.ts",
    [
      "export const coordinatesSchema = z.object({ lat: z.number() });",
      "const internalConfig = { durable: false };",
      "export const normalizePhone = (value) => value.trim();",
      "function local() { const nested = 1; return nested; }",
    ].join("\n"),
  );

  assert.deepEqual(parsed.symbols, [
    {
      type: "variable",
      name: "coordinatesSchema",
      exported: true,
      lineRange: { start: 1, end: 1 },
    },
    {
      type: "variable",
      name: "internalConfig",
      exported: false,
      lineRange: { start: 2, end: 2 },
    },
    {
      type: "function",
      name: "normalizePhone",
      exported: true,
      lineRange: { start: 3, end: 3 },
    },
    {
      type: "function",
      name: "local",
      exported: false,
      lineRange: { start: 4, end: 4 },
    },
  ]);
});

test("uses the TSX grammar and associates callback calls with the enclosing symbol", () => {
  const source = [
    "export function Button() {",
    "  return <button onClick={() => click()}>OK</button>;",
    "}",
  ].join("\n");

  const parsed = parseSourceFile("src/Button.tsx", source);

  assert.equal(parsed.language, "tsx");
  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(parsed.symbols.map((symbol) => symbol.name), ["Button"]);
  assert.deepEqual(parsed.calls, [
    {
      callee: "click",
      kind: "identifier",
      caller: "Button",
      lineRange: { start: 2, end: 2 },
    },
  ]);
});

test("recovers valid JSX text containing a bare ampersand without shifting line evidence", () => {
  const parsed = parseSourceFile("src/screen.tsx", [
    "export function Screen() {",
    "  return <Text>Help & Support</Text>;",
    "}",
    "export function after() { return true; }",
  ].join("\n"));

  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(
    parsed.symbols.map(({ name, lineRange }) => ({ name, lineRange })),
    [
      { name: "Screen", lineRange: { start: 1, end: 3 } },
      { name: "after", lineRange: { start: 4, end: 4 } },
    ],
  );
});

test("recovers bare ampersands in JSX attribute strings across supported JSX extensions", () => {
  const source = [
    "export default function Screen() {",
    "  return (",
    "    <a",
    '      href="https://example.com/docs?framework=next.js&utm_source=starter&utm_medium=app"',
    '      data-label="Help &amp; Support"',
    "    >",
    "      Documentation",
    "    </a>",
    "  );",
    "}",
    "export function after() { return true; }",
  ].join("\n");

  for (const path of ["src/screen.tsx", "src/screen.jsx", "src/screen.js"]) {
    const parsed = parseSourceFile(path, source);

    assert.deepEqual(parsed.diagnostics, [], path);
    assert.deepEqual(
      parsed.symbols.map(({ name, lineRange }) => ({ name, lineRange })),
      [
        { name: "Screen", lineRange: { start: 1, end: 10 } },
        { name: "after", lineRange: { start: 11, end: 11 } },
      ],
      path,
    );
  }
});

test("handles anonymous default functions without inventing a source name", () => {
  const source = [
    "export default function () {",
    "  boot();",
    "}",
  ].join("\n");

  const parsed = parseSourceFile("src/bootstrap.ts", source);

  assert.deepEqual(parsed.symbols, [
    {
      type: "function",
      name: "default",
      exported: true,
      lineRange: { start: 1, end: 3 },
    },
  ]);
  assert.deepEqual(parsed.calls[0], {
    callee: "boot",
    kind: "identifier",
    caller: "default",
    lineRange: { start: 2, end: 2 },
  });
});

test("does not mark nested declarations as exported", () => {
  const source = [
    "export function outer() {",
    "  function inner() {",
    "    run();",
    "  }",
    "  inner();",
    "}",
  ].join("\n");

  const parsed = parseSourceFile("src/nested.ts", source);

  assert.deepEqual(
    parsed.symbols.map(({ name, exported }) => ({ name, exported })),
    [
      { name: "outer", exported: true },
      { name: "inner", exported: false },
    ],
  );
});

test("extracts abstract classes and their declared methods", () => {
  const source = [
    "export abstract class BaseService {",
    "  abstract run(): void;",
    "  execute() {",
    "    work();",
    "  }",
    "}",
  ].join("\n");

  const parsed = parseSourceFile("src/base-service.ts", source);

  assert.deepEqual(
    parsed.symbols.map(({ type, name, exported }) => ({ type, name, exported })),
    [
      { type: "class", name: "BaseService", exported: true },
      { type: "function", name: "BaseService.run", exported: false },
      { type: "function", name: "BaseService.execute", exported: false },
    ],
  );
  assert.deepEqual(parsed.calls[0], {
    callee: "work",
    kind: "identifier",
    caller: "BaseService.execute",
    lineRange: { start: 4, end: 4 },
  });
});

test("extracts TypeScript import-equals declarations", () => {
  const parsed = parseSourceFile(
    "src/legacy.ts",
    'import payment = require("./payment");',
  );

  assert.deepEqual(parsed.imports, [
    {
      kind: "namespace",
      source: "./payment",
      importedName: "*",
      localName: "payment",
      typeOnly: false,
      lineRange: { start: 1, end: 1 },
    },
  ]);
});

test("extracts CommonJS and dynamic module syntax conservatively", () => {
  const source = [
    'const payment = require("./payment");',
    'const { charge: chargeCard, refund } = require("./payment");',
    'require("./setup");',
    'async function load() {',
    '  return import("./lazy");',
    '}',
    'module.exports = payment;',
    'exports.charge = chargeCard;',
    'module.exports.refund = refund;',
    'exports.handler = () => chargeCard();',
  ].join("\n");

  const parsed = parseSourceFile("src/payment.cjs", source);

  assert.deepEqual(
    parsed.imports.map(
      ({ kind, source: importSource, importedName, localName }) => ({
        kind,
        source: importSource,
        importedName,
        localName,
      }),
    ),
    [
      {
        kind: "commonjs",
        source: "./payment",
        importedName: "*",
        localName: "payment",
      },
      {
        kind: "commonjs",
        source: "./payment",
        importedName: "charge",
        localName: "chargeCard",
      },
      {
        kind: "commonjs",
        source: "./payment",
        importedName: "refund",
        localName: "refund",
      },
      {
        kind: "commonjs",
        source: "./setup",
        importedName: undefined,
        localName: undefined,
      },
      {
        kind: "dynamic",
        source: "./lazy",
        importedName: undefined,
        localName: undefined,
      },
    ],
  );
  assert.deepEqual(
    parsed.exports.map(({ kind, exportedName, localName }) => ({
      kind,
      exportedName,
      localName,
    })),
    [
      { kind: "default", exportedName: "default", localName: "payment" },
      { kind: "named", exportedName: "charge", localName: "chargeCard" },
      { kind: "named", exportedName: "refund", localName: "refund" },
      { kind: "named", exportedName: "handler", localName: undefined },
    ],
  );
  assert.deepEqual(
    parsed.symbols.map(({ name, exported }) => ({ name, exported })),
    [
      { name: "payment", exported: true },
      { name: "load", exported: false },
      { name: "handler", exported: true },
    ],
  );
  assert.deepEqual(
    parsed.calls.find((call) => call.callee === "chargeCard"),
    {
    callee: "chargeCard",
    kind: "identifier",
    caller: "handler",
    importedLocalName: "chargeCard",
    lineRange: { start: 10, end: 10 },
    },
  );
  assert.deepEqual(parsed.diagnostics, []);
});

test("reports syntax diagnostics and rejects unsupported file types", () => {
  const parsed = parseSourceFile("src/broken.ts", "const = ;");

  assert.ok(parsed.diagnostics.length > 0);
  assert.ok(
    parsed.diagnostics.every(
      (diagnostic) => diagnostic.lineRange.start === 1,
    ),
  );
  assert.throws(
    () => parseSourceFile("src/component.vue", "export default {};"),
    /Unsupported TypeScript\/JavaScript file/,
  );
});

test("detects supported parser languages case-insensitively", () => {
  assert.equal(detectParsedLanguage("source.CTS"), "typescript");
  assert.equal(detectParsedLanguage("source.JSX"), "javascript");
  assert.equal(detectParsedLanguage("source.TSX"), "tsx");
});

test("marks only unique unshadowed import roots on calls", () => {
  const parsed = parseSourceFile(
    "src/shadowing.ts",
    [
      'import { run } from "./worker";',
      "function direct() { run(); }",
      "function parameter(run: () => void) { run(); }",
      "function local() { const run = () => {}; run(); }",
      "function callback() { items.map((run) => run()); }",
    ].join("\n"),
  );

  assert.deepEqual(
    parsed.calls
      .filter((call) => call.callee === "run")
      .map(({ caller, importedLocalName }) => ({
        caller,
        importedLocalName,
      })),
    [
      { caller: "direct", importedLocalName: "run" },
      { caller: "parameter", importedLocalName: undefined },
      { caller: "local", importedLocalName: undefined },
      { caller: "callback", importedLocalName: undefined },
    ],
  );
});

test("extracts explicit runtime entrypoint registrations conservatively", () => {
  const parsed = parseSourceFile(
    "src/app.ts",
    [
      'router.get("/users", listUsers);',
      'app.post("/users", async () => {});',
      'program.command("serve");',
      'consumer.on("ready", handleReady);',
      'cron.schedule("* * * * *", cleanup);',
      'schema.query("viewer", viewer);',
      "class Controller {",
      '  @Get("/items")',
      "  list() {}",
      '  @Mutation("save")',
      "  save() {}",
      '  @Cron("0 * * * *")',
      "  sync() {}",
      '  @OnEvent("created")',
      "  created() {}",
      "}",
      "export function handler() {}",
      "export function main() {}",
      "export default function bootstrap() {}",
      'cache.get("key", callback);',
      "router.get(dynamicPath, callback);",
      "cron.schedule(expression, cleanup);",
      "function listUsers() {}",
    ].join("\n"),
  );

  assert.deepEqual(parsed.entrypoints, [
    entrypoint("http", "GET /users", 1, "listUsers"),
    entrypoint("http", "POST /users", 2),
    entrypoint("cli", "serve", 3),
    entrypoint("event", "ready", 4, "handleReady"),
    entrypoint("scheduled", "* * * * *", 5, "cleanup"),
    entrypoint("graphql", "query viewer", 6, "viewer"),
    entrypoint("http", "GET /items", 8, "Controller.list"),
    entrypoint("graphql", "mutation save", 10, "Controller.save"),
    entrypoint("scheduled", "Cron 0 * * * *", 12, "Controller.sync"),
    entrypoint("event", "created", 14, "Controller.created"),
    entrypoint("application", "handler", 17, "handler"),
    entrypoint("startup", "main", 18, "main"),
    entrypoint("startup", "bootstrap", 19, "bootstrap"),
  ]);
});

test("models Next.js App Router files and framework-invoked exports without promoting app helpers", () => {
  for (const path of [
    "web/app/[locale]/components/Card.tsx",
    "web/app/[locale]/contexts/AuthContext.tsx",
    "web/app/[locale]/hooks/useAccount.ts",
    "web/app/[locale]/sections/Hero.tsx",
  ]) {
    const parsed = parseSourceFile(
      path,
      "export default function Helper() { return null; }",
    );
    assert.deepEqual(parsed.entrypoints, [], path);
  }

  const page = parseSourceFile("web/app/[locale]/page.tsx", [
    "export const metadata = { title: 'Home' };",
    "export const dynamic = 'force-dynamic';",
    "export const revalidate = 60;",
    "export async function generateMetadata() { return metadata; }",
    "export default function Page() { return null; }",
  ].join("\n"));
  assert.deepEqual(
    page.entrypoints.map(({ name, handlerName }) => ({ name, handlerName })),
    [
      { name: "Next.js route metadata generateMetadata", handlerName: "generateMetadata" },
      { name: "PAGE /:locale", handlerName: "Page" },
    ],
  );

  const route = parseSourceFile(
    "web/app/api/users/route.ts",
    "export async function GET() { return new Response('ok'); }",
  );
  assert.deepEqual(route.entrypoints, [
    entrypoint("http", "GET /api/users", 1, "GET"),
  ]);

  const middleware = parseSourceFile("web/middleware.ts", [
    "export function middleware() { return null; }",
    "export const config = { matcher: ['/account'] };",
  ].join("\n"));
  assert.deepEqual(
    middleware.entrypoints.map(({ name, handlerName }) => ({ name, handlerName })),
    [
      { name: "Next.js middleware middleware", handlerName: "middleware" },
    ],
  );

  const layout = parseSourceFile(
    "web/app/[locale]/layout.tsx",
    "export default function LocaleLayout() { return null; }",
  );
  assert.deepEqual(
    layout.entrypoints.map(({ kind, name, handlerName }) => ({
      kind,
      name,
      handlerName,
    })),
    [{
      kind: "startup",
      name: "Next.js App Router layout default",
      handlerName: "LocaleLayout",
    }],
  );

  assert.equal(
    parseSourceFile(
      "mobile/app/settings/index.tsx",
      "export default function Settings() { return null; }",
    ).entrypoints[0]?.name,
    "PAGE /settings",
  );
});

test("does not turn outbound HTTP client calls into server entrypoints", () => {
  const parsed = parseSourceFile(
    "frontend/lib/api.ts",
    [
      'import axios from "axios";',
      'const api = axios.create({ baseURL: "http://localhost:8000" });',
      "export async function createSubject(data: unknown) {",
      '  return api.post("/api/subjects/", data);',
      "}",
    ].join("\n"),
  );

  assert.deepEqual(parsed.entrypoints, []);
  assert.deepEqual(parsed.frameworkDiagnostics, undefined);
});

test("detects React DOM createRoot and hydrateRoot bootstraps as startup entrypoints", () => {
  const createRoot = parseSourceFile(
    "frontend/src/main.jsx",
    [
      'import { createRoot as mount } from "react-dom/client";',
      'import App from "./App.jsx";',
      'mount(document.getElementById("root")).render(<App />);',
    ].join("\n"),
  );
  const hydrateRoot = parseSourceFile(
    "frontend/src/hydrate.jsx",
    [
      'import * as ReactDOM from "react-dom/client";',
      'ReactDOM.hydrateRoot(document.getElementById("root"), <App />);',
    ].join("\n"),
  );
  const shadowed = parseSourceFile(
    "frontend/src/helper.jsx",
    [
      'import { createRoot } from "react-dom/client";',
      "export function helper(createRoot) {",
      '  return createRoot(document.getElementById("root"));',
      "}",
    ].join("\n"),
  );

  assert.deepEqual(createRoot.entrypoints, [
    entrypoint("startup", "React createRoot", 3),
  ]);
  assert.deepEqual(hydrateRoot.entrypoints, [
    entrypoint("startup", "React hydrateRoot", 2),
  ]);
  assert.deepEqual(shadowed.entrypoints, []);
});

test("uses server factory provenance even when the receiver has a generic name", () => {
  const parsed = parseSourceFile(
    "server/routes.ts",
    [
      'import express from "express";',
      "const service = express();",
      'service.get("/health", (_request, response) => response.send("ok"));',
    ].join("\n"),
  );

  assert.deepEqual(parsed.entrypoints, [
    entrypoint("http", "GET /health", 3),
  ]);
});

test("distinguishes Fastify WebSocket routes and startup from socket callbacks", () => {
  const parsed = parseSourceFile(
    "server/app.ts",
    [
      "function websocketHandler(socket) {",
      '  socket.on("close", () => {});',
      "}",
      'app.get("/driver", { websocket: true }, websocketHandler);',
      'app.route({ method: "POST", url: "/rider", websocket: true, handler: riderSocket });',
      'app.ws("/legacy", legacySocket);',
      'app.route({ method: "PUT", path: "/trips/:id", handler: updateTrip });',
      "function buildApp() {}",
      "app.listen({ port: 3000 });",
    ].join("\n"),
  );

  assert.deepEqual(parsed.entrypoints, [
    {
      kind: "websocket",
      name: "WS /driver",
      exposure: "external",
      httpMethod: "GET",
      route: "/driver",
      handlerName: "websocketHandler",
      lineRange: { start: 4, end: 4 },
    },
    {
      kind: "websocket",
      name: "WS /rider",
      exposure: "external",
      httpMethod: "POST",
      route: "/rider",
      handlerName: "riderSocket",
      lineRange: { start: 5, end: 5 },
    },
    {
      kind: "websocket",
      name: "WS /legacy",
      exposure: "external",
      httpMethod: "GET",
      route: "/legacy",
      handlerName: "legacySocket",
      lineRange: { start: 6, end: 6 },
    },
    {
      kind: "http",
      name: "PUT /trips/:id",
      exposure: "external",
      httpMethod: "PUT",
      route: "/trips/:id",
      handlerName: "updateTrip",
      lineRange: { start: 7, end: 7 },
    },
    {
      kind: "startup",
      name: "buildApp",
      exposure: "startup",
      handlerName: "buildApp",
      lineRange: { start: 8, end: 8 },
    },
    {
      kind: "startup",
      name: "listen",
      exposure: "startup",
      lineRange: { start: 9, end: 9 },
    },
  ]);
  assert.equal(parsed.entrypoints.some(({ name }) => name === "close"), false);
});

test("discovers Fastify routes registered through a plugin callback alias", () => {
  const parsed = parseSourceFile(
    "server/app.ts",
    [
      "app.register(async function routes(routesApp) {",
      "  routesApp.get('/health', async () => ({ status: 'ok' }));",
      "  routesApp.post<{ Body: Input }>('/users', createUser);",
      "  routesApp.get<{ Params: Params }>(",
      "    '/realtime/:id',",
      "    { websocket: true },",
      "    (socket) => socket.send('ready'),",
      "  );",
      "});",
    ].join("\n"),
  );

  assert.deepEqual(parsed.entrypoints, [
    {
      kind: "http",
      name: "GET /health",
      exposure: "external",
      httpMethod: "GET",
      route: "/health",
      lineRange: { start: 2, end: 2 },
    },
    {
      kind: "http",
      name: "POST /users",
      exposure: "external",
      httpMethod: "POST",
      route: "/users",
      handlerName: "createUser",
      lineRange: { start: 3, end: 3 },
    },
    {
      kind: "websocket",
      name: "WS /realtime/:id",
      exposure: "external",
      httpMethod: "GET",
      route: "/realtime/:id",
      lineRange: { start: 4, end: 8 },
    },
  ]);
});

test("extracts domain event names from emitter helpers and typed messages", () => {
  const parsed = parseSourceFile(
    "src/events.ts",
    [
      "function reject(driverId) {",
      "  this.emitTripEvent(driverId, 'driver_offer_rejected');",
      "  this.publish(driverId, { type: 'driver.offer.updated' });",
      "  bus.publish(event, snapshot);",
      "}",
    ].join("\n"),
  );

  assert.deepEqual(parsed.events, [
    {
      name: "driver_offer_rejected",
      operation: "publish",
      ownerName: "reject",
      lineRange: { start: 2, end: 2 },
    },
    {
      name: "driver.offer.updated",
      operation: "publish",
      ownerName: "reject",
      lineRange: { start: 3, end: 3 },
    },
  ]);
});

test("parses source files larger than the native string input limit", () => {
  const padding = "// padding\n".repeat(3_500);
  const parsed = parseSourceFile(
    "src/large.ts",
    `${padding}export function handler() {}\n`,
  );

  assert.equal(parsed.diagnostics.length, 0);
  assert.equal(parsed.symbols.at(-1)?.name, "handler");
  assert.deepEqual(parsed.entrypoints.at(-1), {
    kind: "application",
    name: "handler",
    exposure: "external",
    handlerName: "handler",
    lineRange: { start: 3501, end: 3501 },
  });
});

function entrypoint(kind, name, line, handlerName) {
  return {
    kind,
    name,
    exposure: kind === "startup" ? "startup" : "external",
    ...(kind === "http"
      ? { httpMethod: name.split(" ", 1)[0], route: name.slice(name.indexOf(" ") + 1) }
      : {}),
    ...(handlerName === undefined ? {} : { handlerName }),
    lineRange: { start: line, end: line },
  };
}
