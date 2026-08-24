import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import {
  findCallees,
  findCallers,
  findConsumers,
  findDefinition,
  findImporters,
  findReferences,
} from "./symbolNavigation.ts";

test("navigates exact definitions, imports, calls, and consumers", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "symbol-navigation-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));

  await writeFixture(
    repositoryPath,
    "src/domain.ts",
    [
      "export const coordinatesSchema = { safeParse() {} };",
      "export function normalizePhone(value) { return value.trim(); }",
      "export function assertTripTransition() { return true; }",
      "export function PaymentSheet() { return null; }",
      "export class DriverService { offerTrip() {} }",
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "src/app.ts",
    [
      'import { coordinatesSchema, normalizePhone, assertTripTransition, PaymentSheet } from "./domain.js";',
      "export function submit(phone) {",
      "  coordinatesSchema.safeParse({});",
      "  normalizePhone(phone);",
      "  assertTripTransition();",
      "  return PaymentSheet();",
      "}",
    ].join("\n"),
  );

  const { graph } = await indexRepository(repositoryPath);

  for (const name of [
    "normalizePhone",
    "coordinatesSchema",
    "PaymentSheet",
    "offerTrip",
    "assertTripTransition",
  ]) {
    const response = findDefinition(graph, name);
    assert.equal(response.ambiguous, false, name);
    assert.equal(response.results.length, 1, name);
    assert.equal(response.results[0].relationship, "DEFINITION");
  }

  assert.deepEqual(
    findImporters(graph, "coordinatesSchema").results.map((result) => ({
      nodeId: result.nodeId,
      file: result.file,
      lineRange: result.lineRange,
      relationship: result.relationship,
      confidence: result.confidence,
    })),
    [{
      nodeId: "file:src/app.ts",
      file: "src/app.ts",
      lineRange: { start: 1, end: 1 },
      relationship: "IMPORTER",
      confidence: 1,
    }],
  );
  assert.equal(
    findCallers(graph, "normalizePhone").results[0].nodeId,
    "function:src/app.ts:submit",
  );
  assert.deepEqual(
    findCallees(graph, "submit").results.map((result) => result.nodeId),
    [
      "function:src/domain.ts:normalizePhone",
      "function:src/domain.ts:assertTripTransition",
      "function:src/domain.ts:PaymentSheet",
    ],
  );
  assert.equal(findReferences(graph, "PaymentSheet").total, 2);
  assert.equal(findConsumers(graph, "PaymentSheet").total, 2);
});

test("returns candidates instead of guessing for ambiguous unqualified methods", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "symbol-ambiguity-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(
    repositoryPath,
    "src/services.ts",
    "export class DriverService { offerTrip() {} }\nexport class MockService { offerTrip() {} }\n",
  );

  const { graph } = await indexRepository(repositoryPath);
  const response = findDefinition(graph, "offerTrip");
  assert.equal(response.ambiguous, true);
  assert.deepEqual(
    response.candidates.map((candidate) => candidate.nodeId),
    [
      "function:src/services.ts:DriverService.offerTrip",
      "function:src/services.ts:MockService.offerTrip",
    ],
  );
});

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${content}\n`);
}
