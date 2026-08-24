import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import { findDeadCodeCandidates } from "./findDeadCodeCandidates.ts";

test("promotes disconnected UI to validation-required without claiming safe deletion", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "dead-code-ui-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(repositoryPath, "app/page.tsx", [
    'import { LivePanel } from "../components/LivePanel";',
    "export default function Page() { return <LivePanel />; }",
  ].join("\n"));
  await writeFixture(
    repositoryPath,
    "components/LivePanel.tsx",
    "export function LivePanel() { return <section />; }",
  );
  await writeFixture(
    repositoryPath,
    "components/FileUpload.tsx",
    "export default function FileUpload() { return <input type='file' />; }",
  );

  const { graph } = await indexRepository(repositoryPath);
  const candidates = findDeadCodeCandidates(graph);
  const upload = candidates.find((candidate) =>
    candidate.file === "components/FileUpload.tsx" &&
    candidate.symbol === "FileUpload"
  );
  assert.ok(upload);
  assert.equal(upload.verdict, "VALIDATION_REQUIRED");
  assert.equal(upload.reachabilityStatus, "disconnected_candidate");
  assert.equal(upload.validation, null);
  assert.ok(
    !candidates.some((candidate) => candidate.symbol === "LivePanel"),
  );
});

test("promotes exported production functions referenced only by tests", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "dead-code-test-only-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(repositoryPath, "backend/main.py", [
    "from fastapi import FastAPI",
    "app = FastAPI()",
    "",
    "@app.get('/health')",
    "def health():",
    "    return {'ok': True}",
  ].join("\n"));
  await writeFixture(repositoryPath, "backend/services/auth_service.py", [
    "def verify_company_access(company_id):",
    "    return company_id == 'allowed'",
  ].join("\n"));
  await writeFixture(repositoryPath, "backend/tests/unit/test_auth_service.py", [
    "from backend.services.auth_service import verify_company_access",
    "",
    "def test_verify_company_access():",
    "    assert verify_company_access('allowed')",
  ].join("\n"));

  const { graph } = await indexRepository(repositoryPath);
  const candidates = findDeadCodeCandidates(graph);
  const candidate = candidates.find((value) =>
    value.file === "backend/services/auth_service.py" &&
    value.symbol === "verify_company_access"
  );

  assert.ok(candidate);
  assert.equal(candidate.reachabilityStatus, "test_only");
  assert.equal(candidate.verdict, "VALIDATION_REQUIRED");
  assert.equal(candidate.validation, null);
  assert.equal(
    candidates.some((value) => value.file.includes("/tests/")),
    false,
  );
});

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${content}\n`);
}
