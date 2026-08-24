import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import { applyRepositoryRealityChecks } from "./applyRepositoryRealityChecks.ts";

const temporaryRepositories = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    ),
  );
});

test("rejects create-next-app scaffold evidence and groups documented zero-import packages", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "repository-reality-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "frontend/package.json", JSON.stringify({
    dependencies: {
      "@tanstack/react-query": "1.0.0",
      "next": "1.0.0",
      "react-dropzone": "1.0.0",
      "react-markdown": "1.0.0",
    },
  }));
  await writeFixture(repositoryPath, "frontend/app/page.tsx", [
    "export default function Home() {",
    "  return <main>",
    "    <img src=\"/next.svg\" alt=\"Next.js logo\" />",
    "    <p>To get started, edit the page.tsx file.</p>",
    "  </main>;",
    "}",
  ].join("\n"));

  const { graph } = await indexRepository(repositoryPath);
  const file = graph.files.find((candidate) =>
    candidate.path === "frontend/app/page.tsx"
  );
  const entrypoint = graph.entrypoints.find((candidate) =>
    candidate.fileId === file?.id
  );
  assert.ok(file);
  assert.ok(entrypoint);
  const implementationNodeIds = [
    file.id,
    ...graph.symbols.filter((node) => node.fileId === file.id).map((node) => node.id),
    ...graph.entities.filter((node) => node.fileId === file.id).map((node) => node.id),
  ].sort();
  const promises = [
    { id: "promise:app", text: "A Next.js dashboard/chat interface for AI Tutor." },
    { id: "promise:query", text: "React Query (TanStack Query)" },
    { id: "promise:dropzone", text: "React Dropzone" },
    { id: "promise:markdown", text: "React Markdown" },
  ];
  const features = [{
    id: "page",
    title: "Home Page",
    kind: "functional",
    status: "IMPLEMENTED_DOCUMENTED",
    entrypointNodeIds: [entrypoint.id],
    implementationNodeIds,
    documentationPromiseIds: ["promise:query"],
    gaps: [],
    confidence: "HIGH",
  }];

  const result = await applyRepositoryRealityChecks(
    features,
    promises,
    graph,
    repositoryPath,
  );
  const root = result.find((feature) => feature.id === "page");
  const phantom = result.find((feature) => feature.id === "phantom-frontend-packages");

  assert.equal(root?.title, "Root App Entry");
  assert.equal(root?.status, "DOCUMENTED_NOT_IMPLEMENTED");
  assert.deepEqual(root?.entrypointNodeIds, []);
  assert.deepEqual(root?.implementationNodeIds, []);
  assert.deepEqual(root?.documentationPromiseIds, ["promise:app"]);
  assert.equal(phantom?.status, "DOCUMENTED_NOT_IMPLEMENTED");
  assert.deepEqual(phantom?.documentationPromiseIds, [
    "promise:dropzone",
    "promise:markdown",
    "promise:query",
  ]);
  assert.match(phantom?.title ?? "", /React Query/u);
  assert.match(phantom?.title ?? "", /React Dropzone/u);
  assert.match(phantom?.title ?? "", /React Markdown/u);
});

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
