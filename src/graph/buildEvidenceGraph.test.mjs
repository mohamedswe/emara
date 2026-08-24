import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { indexRepository } from "./indexRepository.ts";
import { validateRepositoryGraph } from "./validateRepositoryGraph.ts";

test("builds focused evidence entities and evidence-bearing semantic relationships", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "evidence-graph-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));

  await writeFixture(
    repositoryPath,
    "server/app.ts",
    [
      'import { coordinatesSchema } from "./schemas.js";',
      "export function requestTrip(request) {",
      "  return coordinatesSchema.safeParse(request.body);",
      "}",
      'app.post("/trips/request", requestTrip);',
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "server/schemas.ts",
    "export const coordinatesSchema = { safeParse(value) { return value; } };",
  );
  await writeFixture(
    repositoryPath,
    "ui/trip.tsx",
    [
      "export function PaymentSheet() { return <section />; }",
      "export function RiderScreen() { return <PaymentSheet />; }",
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "server/events.ts",
    [
      "export function connection(socket, emitter) {",
      '  socket.on("close", () => {});',
      '  emitter.emit("trip.updated", {});',
      "}",
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "server/config.ts",
    "export const serverConfig = { durable: false };",
  );
  await writeFixture(
    repositoryPath,
    "server/bootstrap.ts",
    'import { serverConfig } from "./config.js";\nexport function bootstrap() { return serverConfig; }',
  );
  await writeFixture(
    repositoryPath,
    "server/app.test.ts",
    'import { requestTrip } from "./app.js";\nrequestTrip({ body: {} });',
  );

  const { graph } = await indexRepository(repositoryPath);
  validateRepositoryGraph(graph);

  assert.deepEqual(
    [...new Set(graph.entities.map((node) => node.type))].sort(),
    ["component", "config", "endpoint", "event", "schema", "screen", "test"],
  );
  assert.equal(
    graph.entities.some(
      (node) => node.type === "event" && node.name === "close",
    ),
    true,
  );
  assert.equal(
    graph.entrypoints.some((entrypoint) => entrypoint.name === "close"),
    false,
  );

  const relationships = new Set(graph.edges.map((edge) => edge.type));
  for (const relationship of [
    "HANDLED_BY",
    "VALIDATED_BY",
    "TESTED_BY",
    "RENDERS",
    "PUBLISHES",
    "SUBSCRIBES_TO",
    "CONFIGURED_BY",
  ]) {
    assert.equal(relationships.has(relationship), true, relationship);
  }

  const endpoint = graph.entities.find(
    (node) => node.type === "endpoint" && node.route === "/trips/request",
  );
  assert.ok(endpoint);
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.type === "HANDLED_BY" &&
        edge.source === endpoint.id &&
        edge.target === "function:server/app.ts:requestTrip",
    ),
  );
  assert.ok(
    graph.edges.every(
      (edge) =>
        typeof edge.evidence.file === "string" &&
        edge.evidence.file.length > 0 &&
        typeof edge.evidence.extractor === "string",
    ),
  );
});

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${content}\n`);
}
