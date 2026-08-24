import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import {
  buildReachabilityLedger,
  reachabilityEntry,
} from "./reachabilityLedger.ts";

test("builds an exhaustive product-liveness ledger without calling candidates proven dead", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "reachability-ledger-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(repositoryPath, "server/app.ts", [
    'import { live, uncertain } from "./service.js";',
    "export function route() { return live(); }",
    'app.get("/live", route);',
    "export function main() {}",
    "export const reference = uncertain;",
  ].join("\n"));
  await writeFixture(repositoryPath, "server/service.ts", [
    "export function live() { return true; }",
    "export function uncertain() { return false; }",
    "export function disconnected() { return null; }",
  ].join("\n"));
  await writeFixture(
    repositoryPath,
    "server/helper.test.ts",
    'import { disconnected } from "./service.js";\ndisconnected();',
  );
  await writeFixture(
    repositoryPath,
    "ui/UnusedPanel.tsx",
    "export default function UnusedPanel() { return <section />; }",
  );

  const { graph } = await indexRepository(repositoryPath);
  const ledger = buildReachabilityLedger(graph);

  assert.equal(
    reachabilityEntry(ledger, "function:server/service.ts:live")?.status,
    "product_reachable",
  );
  assert.equal(
    reachabilityEntry(ledger, "function:server/app.ts:main")?.status,
    "startup_reachable",
  );
  assert.equal(
    reachabilityEntry(ledger, "function:server/service.ts:uncertain")?.status,
    "dynamic_unknown",
  );
  assert.equal(
    reachabilityEntry(ledger, "function:server/service.ts:disconnected")?.status,
    "test_only",
  );
  const unused = reachabilityEntry(
    ledger,
    "function:ui/UnusedPanel.tsx:UnusedPanel",
  );
  assert.equal(unused?.status, "disconnected_candidate");
  assert.equal(unused?.confidence, "tentative");
  assert.match(unused?.reason ?? "", /not proof of safety/);
  assert.equal(
    Object.values(ledger.counts).reduce((total, value) => total + value, 0),
    ledger.entries.length,
  );
  assert.deepEqual(buildReachabilityLedger(graph), ledger);
});

test("protects exported symbols as unproven public APIs in repositories without entrypoints", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "reachability-library-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(
    repositoryPath,
    "src/index.ts",
    "export function formatPublicValue() { return 'value'; }",
  );

  const { graph } = await indexRepository(repositoryPath);
  const ledger = buildReachabilityLedger(graph);
  assert.equal(
    reachabilityEntry(
      ledger,
      "function:src/index.ts:formatPublicValue",
    )?.status,
    "public_api_unproven",
  );
});

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${content}\n`);
}
