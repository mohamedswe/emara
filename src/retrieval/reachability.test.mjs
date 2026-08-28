import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import {
  findPathsFromEntrypoints,
  findPathsToExternalBehavior,
  isReachable,
} from "./reachability.ts";

test("classifies external, startup, test-only, unreferenced, and unknown code conservatively", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "reachability-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));

  await writeFixture(
    repositoryPath,
    "server/app.ts",
    [
      'import { offerTrip } from "./service.js";',
      "export function requestTrip() { return offerTrip(); }",
      'app.post("/trips/request", requestTrip);',
      "export function main() {}",
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "server/service.ts",
    [
      "export function offerTrip() {",
      '  emitter.emit("trip.offered", {});',
      "}",
      "export function uncertainUtility() {}",
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "ui/PaymentSheet.tsx",
    "export function PaymentSheet() { return <section />; }",
  );
  await writeFixture(
    repositoryPath,
    "server/test-helper.ts",
    "export function fixtureOnly() {}",
  );
  await writeFixture(
    repositoryPath,
    "server/test-helper.test.ts",
    'import { fixtureOnly } from "./test-helper.js";\nfixtureOnly();',
  );
  await writeFixture(
    repositoryPath,
    "server/consumer.ts",
    'import { uncertainUtility } from "./service.js";\nexport const value = uncertainUtility;',
  );

  const { graph } = await indexRepository(repositoryPath);
  const offerTripId = "function:server/service.ts:offerTrip";
  const reachable = isReachable(graph, offerTripId);
  assert.equal(reachable.status, "reachable");
  assert.equal(reachable.confidence, "proven");
  assert.deepEqual(
    reachable.paths[0].edges.map((edge) => edge.type),
    ["HANDLED_BY", "CALLS"],
  );

  assert.equal(
    isReachable(graph, "function:server/app.ts:main").status,
    "internally_reachable",
  );
  assert.equal(
    isReachable(graph, "function:server/test-helper.ts:fixtureOnly").status,
    "test_only",
  );
  const payment = isReachable(
    graph,
    "function:ui/PaymentSheet.tsx:PaymentSheet",
  );
  assert.equal(payment.status, "unknown");
  assert.equal(payment.confidence, "tentative");
  assert.equal(
    isReachable(graph, "function:server/service.ts:uncertainUtility").status,
    "unknown",
  );

  const paths = findPathsFromEntrypoints(graph, offerTripId);
  assert.equal(paths.paths.length, 1);
  assert.equal(paths.truncated, false);
  const externalBehavior = findPathsToExternalBehavior(graph, offerTripId);
  assert.deepEqual(
    externalBehavior.paths[0].edges.map((edge) => edge.type),
    ["PUBLISHES"],
  );
  assert.ok(
    externalBehavior.paths[0].edges.every(
      (edge) => edge.evidence.file === "server/service.ts",
    ),
  );
});

test("traces file-routed UI entrypoints through JSX render relationships", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "reachability-ui-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(
    repositoryPath,
    "app/dashboard/index.tsx",
    [
      'import { DashboardView } from "../../components/DashboardView";',
      "export default function DashboardScreen() {",
      "  const openSettings = () => {};",
      "  const closeSettings = () => {};",
      "  return <DashboardView onPress={openSettings} onClose={() => closeSettings()} />;",
      "}",
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "components/DashboardView.tsx",
    "export function DashboardView() { return <section />; }",
  );

  const { graph } = await indexRepository(repositoryPath);
  const result = isReachable(
    graph,
    "function:components/DashboardView.tsx:DashboardView",
  );

  assert.equal(result.status, "reachable");
  assert.deepEqual(
    result.paths[0].edges.map((edge) => edge.type),
    ["HANDLED_BY", "RENDERS"],
  );

  const callbackResult = isReachable(
    graph,
    "function:app/dashboard/index.tsx:openSettings",
  );
  assert.equal(callbackResult.status, "reachable");
  assert.deepEqual(
    callbackResult.paths[0].edges.map((edge) => edge.type),
    ["HANDLED_BY", "REFERENCES"],
  );

  const calledCallbackResult = isReachable(
    graph,
    "function:app/dashboard/index.tsx:closeSettings",
  );
  assert.equal(calledCallbackResult.status, "reachable");
  assert.deepEqual(
    calledCallbackResult.paths[0].edges.map((edge) => edge.type),
    ["HANDLED_BY", "CALLS"],
  );
});

test("roots React bootstrap files and their rendered component trees", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "reachability-react-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(
    repositoryPath,
    "frontend/src/main.jsx",
    [
      'import { createRoot } from "react-dom/client";',
      'import App from "./App.jsx";',
      'createRoot(document.getElementById("root")).render(<App />);',
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "frontend/src/App.jsx",
    [
      'import { Layout, LoginModal, NavLink } from "./components.jsx";',
      "export default function App() {",
      "  return <Layout><NavLink /><LoginModal /></Layout>;",
      "}",
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "frontend/src/components.jsx",
    [
      "export function Layout({ children }) { return <main>{children}</main>; }",
      "export function LoginModal() { return <aside />; }",
      "export function NavLink() { return <a />; }",
    ].join("\n"),
  );

  const { graph } = await indexRepository(repositoryPath);
  assert.equal(
    graph.entrypoints.some((entrypoint) =>
      entrypoint.kind === "startup" &&
      entrypoint.name === "React createRoot" &&
      entrypoint.fileId === "file:frontend/src/main.jsx"
    ),
    true,
  );
  for (const name of ["App", "Layout", "LoginModal", "NavLink"]) {
    assert.equal(
      isReachable(
        graph,
        `function:frontend/src/${name === "App" ? "App.jsx" : "components.jsx"}:${name}`,
      ).status,
      "internally_reachable",
    );
  }
});

test("roots legacy ReactDOM.render component files and class component methods", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "reachability-react-render-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(
    repositoryPath,
    "web/src/index.jsx",
    [
      'import ReactDOM from "react-dom";',
      'import App from "./App.jsx";',
      'ReactDOM.render(<App />, document.getElementById("root"));',
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "web/src/App.jsx",
    [
      'import BookingModal from "./BookingModal.jsx";',
      'import { signIn, signOut } from "./auth.js";',
      "export default class App {",
      "  authenticate() { return signIn(); }",
      "  signOut() { return signOut(); }",
      "  render() { return <BookingModal />; }",
      "}",
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "web/src/BookingModal.jsx",
    "export default function BookingModal() { return <aside />; }",
  );
  await writeFixture(
    repositoryPath,
    "web/src/auth.js",
    [
      'import { decodeToken } from "./token.js";',
      "export function signIn() { return decodeToken(); }",
      "export function signOut() {}",
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "web/src/token.js",
    "export function decodeToken() { return null; }",
  );

  const { graph } = await indexRepository(repositoryPath);
  assert.equal(
    graph.entrypoints.some((entrypoint) =>
      entrypoint.kind === "startup" &&
      entrypoint.name === "React render" &&
      entrypoint.fileId === "file:web/src/index.jsx"
    ),
    true,
  );
  assert.equal(
    graph.edges.some((edge) =>
      edge.source === "file:web/src/index.jsx" &&
      edge.target === "class:web/src/App.jsx:App" &&
      edge.type === "REFERENCES" &&
      edge.evidence.line === 3 &&
      edge.evidence.extractor === "tree-sitter"
    ),
    true,
  );
  for (const id of [
    "class:web/src/App.jsx:App",
    "function:web/src/App.jsx:App.authenticate",
    "function:web/src/App.jsx:App.signOut",
    "function:web/src/App.jsx:App.render",
    "function:web/src/BookingModal.jsx:BookingModal",
    "function:web/src/auth.js:signIn",
    "function:web/src/auth.js:signOut",
    "function:web/src/token.js:decodeToken",
  ]) {
    assert.equal(isReachable(graph, id).status, "internally_reachable", id);
  }
});

test("roots node package scripts through transitive CommonJS imports", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "reachability-node-script-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(repositoryPath, "package.json", JSON.stringify({
    scripts: {
      start: "cross-env NODE_ENV=production node server.js",
      tool: "node ./extra/tool.mjs",
      ignored: "echo node ignored.js",
    },
  }));
  await writeFixture(repositoryPath, "server.js", 'require("./bootstrap.js");');
  await writeFixture(
    repositoryPath,
    "bootstrap.js",
    'const { run } = require("./worker.js");\nrun();',
  );
  await writeFixture(repositoryPath, "worker.js", "exports.run = () => true;");
  await writeFixture(repositoryPath, "extra/tool.mjs", "export const toolName = 'tool';");
  await writeFixture(repositoryPath, "ignored.js", "exports.ignored = () => true;");

  const { graph } = await indexRepository(repositoryPath);
  assert.deepEqual(
    graph.entrypoints
      .filter((entrypoint) => entrypoint.name.startsWith("npm script "))
      .map(({ name, fileId }) => ({ name, fileId })),
    [
      { name: "npm script tool", fileId: "file:extra/tool.mjs" },
      { name: "npm script start", fileId: "file:server.js" },
    ],
  );
  const reachable = isReachable(graph, "function:worker.js:run");
  assert.equal(reachable.status, "reachable");
  assert.deepEqual(
    reachable.paths[0].edges.map((edge) => edge.type),
    ["IMPORTS", "REFERENCES"],
  );
  assert.equal(
    isReachable(graph, "function:ignored.js:ignored").status,
    "unknown",
  );
});

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${content}\n`);
}
