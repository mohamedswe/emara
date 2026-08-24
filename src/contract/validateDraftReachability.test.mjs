import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import {
  assertDraftReachability,
  findDraftReachabilityViolations,
} from "./validateDraftReachability.ts";

test("rejects disconnected UI from reachable features, capabilities, and user flows", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "draft-reachability-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(repositoryPath, "app.ts", [
    "export function liveHandler() { return true; }",
    'app.get("/live", liveHandler);',
  ].join("\n"));
  await writeFixture(
    repositoryPath,
    "components/FileUpload.tsx",
    "export default function FileUpload() { return <input type='file' />; }",
  );
  const { graph } = await indexRepository(repositoryPath);
  const endpointId = graph.entrypoints.find((entrypoint) =>
    entrypoint.route === "/live"
  )?.id;
  const handlerId = "function:app.ts:liveHandler";
  const uploadId = graph.entities.find((entity) =>
    entity.type === "component" && entity.name === "FileUpload"
  )?.id;
  assert.ok(endpointId);
  assert.ok(uploadId);

  const draft = {
    featureDossiers: [{
      id: "live-feature",
      title: "Live feature",
      entrypoints: [endpointId],
      ui: [uploadId],
      handlers: [handlerId],
      services: [],
      schemas: [],
      stateTransitions: [],
      events: [],
      tests: [],
      config: [],
      documentation: [],
      evidenceNodeIds: [handlerId, uploadId],
      unresolvedQuestions: [],
      reachability: "reachable",
    }],
    capabilities: [{
      id: "upload-capability",
      dossierId: "live-feature",
      title: "Upload",
      description: "Upload a file.",
      entrypointNodeIds: [endpointId],
      evidenceNodeIds: [uploadId],
    }],
    userFlows: [{
      id: "upload-flow",
      title: "Upload",
      description: "Upload a file.",
      evidenceNodeIds: [uploadId],
      steps: [],
    }],
    requirements: [],
    uncertainties: [],
  };

  const violations = findDraftReachabilityViolations(graph, draft);
  assert.deepEqual(
    [...new Set(violations.map((violation) => violation.contractKind))],
    ["capability", "feature_dossier", "user_flow"],
  );
  assert.ok(
    violations.every(
      (violation) => violation.status === "disconnected_candidate",
    ),
  );
  assert.throws(
    () => assertDraftReachability(graph, draft),
    /Invalid contract reachability:.*FileUpload/,
  );

  draft.featureDossiers[0].ui = [];
  draft.featureDossiers[0].evidenceNodeIds = [handlerId];
  draft.capabilities[0].evidenceNodeIds = [handlerId];
  draft.userFlows = [];
  assert.doesNotThrow(() => assertDraftReachability(graph, draft));
});

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${content}\n`);
}
