import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import {
  filterInFileUsedMjsExportCandidates,
  findMechanicalDeadCodeCandidates,
} from "./findMechanicalDeadCodeCandidates.ts";

const temporaryRepositories = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    ),
  );
});

test("finds unused helpers, assignments, type aliases, and exported API methods", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "mechanical-dead-code-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "frontend/app/dashboard/page.tsx", [
    "export default function Dashboard() {",
    "  const formatFileSize = (bytes: number) => `${bytes} bytes`;",
    "  return <main />;",
    "}",
  ].join("\n"));
  await writeFixture(repositoryPath, "backend/app/services/document_service.py", [
    "class DocumentService:",
    "    def upload(self):",
    "        upload_result = self.client.upload()",
    "        return True",
  ].join("\n"));
  await writeFixture(repositoryPath, "backend/app/models/documents.py", [
    "from typing import Literal",
    "FileType = Literal['pdf', 'docx']",
  ].join("\n"));
  await writeFixture(repositoryPath, "frontend/lib/api.ts", [
    "const api = { get: async (_path: string) => ({ data: null }) };",
    "export const subjectsAPI = {",
    "  getAll: async () => api.get('/subjects'),",
    "  getById: async (id: string) => api.get(`/subjects/${id}`),",
    "  update: async (id: string) => api.get(`/subjects/${id}`),",
    "};",
    "export const documentsAPI = {",
    "  getAll: async () => api.get('/documents'),",
    "};",
  ].join("\n"));
  await writeFixture(repositoryPath, "frontend/app/consumer.ts", [
    "import { subjectsAPI } from '../lib/api';",
    "void subjectsAPI.getAll();",
  ].join("\n"));

  const { graph, sourceFiles } = await indexRepository(repositoryPath);
  const uncachedCandidates = await findMechanicalDeadCodeCandidates(
    graph,
    repositoryPath,
  );
  const candidates = await findMechanicalDeadCodeCandidates(
    graph,
    repositoryPath,
    sourceFiles,
  );

  assert.deepEqual(candidates, uncachedCandidates);
  const bySymbol = new Map(candidates.map((candidate) => [candidate.symbol, candidate]));

  for (const symbol of [
    "formatFileSize",
    "upload_result",
    "FileType",
    "subjectsAPI.getById",
    "subjectsAPI.update",
    "documentsAPI.getAll",
  ]) {
    assert.equal(bySymbol.get(symbol)?.verdict, "VALIDATION_REQUIRED", symbol);
    assert.equal(bySymbol.get(symbol)?.validation, null, symbol);
  }
  assert.equal(bySymbol.has("subjectsAPI.getAll"), false);
});

test("protects keyword arguments, attribute targets, and serialized class fields", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "mechanical-usage-evidence-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "backend/app/main.py", [
    "def create_app():",
    "    protected_name = build_value()",
    "    app = FastAPI(",
    "        title='Example',",
    "        description='API',",
    "    )",
    "    configure(protected_name=True)",
    "    return app",
  ].join("\n"));
  await writeFixture(repositoryPath, "backend/app/config.py", [
    "def prepare():",
    "    app_env = load_environment()",
    "    return True",
    "",
    "class Settings(BaseSettings):",
    "    token_type: str = 'bearer'",
    "    conversation_history: list = []",
  ].join("\n"));
  await writeFixture(repositoryPath, "backend/app/consumer.py", [
    "def consume(settings):",
    "    return settings.app_env",
  ].join("\n"));

  const { graph } = await indexRepository(repositoryPath);
  const candidates = await findMechanicalDeadCodeCandidates(graph, repositoryPath);
  const symbols = new Set(candidates.map((candidate) => candidate.symbol));

  for (const protectedSymbol of [
    "title",
    "description",
    "protected_name",
    "app_env",
    "token_type",
    "conversation_history",
  ]) {
    assert.equal(symbols.has(protectedSymbol), false, protectedSymbol);
  }
});

test("finds explicit unused JavaScript module values without applying the rule to Python", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "mechanical-module-exports-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "frontend/src/utils/api.js", [
    "const api = {};",
    "export default api;",
  ].join("\n"));
  await writeFixture(repositoryPath, "frontend/src/utils/config.ts", [
    "export const unusedConfig = { timeout: 30 };",
    "export const liveConfig = { timeout: 60 };",
    "export const locallyUsedConfig = { timeout: 90 };",
    "export function localTimeout() { return locallyUsedConfig.timeout; }",
  ].join("\n"));
  await writeFixture(repositoryPath, "frontend/src/app.ts", [
    "import { liveConfig } from './utils/config';",
  ].join("\n"));
  await writeFixture(repositoryPath, "backend/config.py", [
    "EXPORTED_BY_PYTHON_CONVENTION = 'not-a-js-export'",
  ].join("\n"));

  const { graph } = await indexRepository(repositoryPath);
  const candidates = await findMechanicalDeadCodeCandidates(graph, repositoryPath);
  const bySymbol = new Map(candidates.map((candidate) => [candidate.symbol, candidate]));

  for (const symbol of ["api", "unusedConfig"]) {
    assert.equal(bySymbol.get(symbol)?.verdict, "VALIDATION_REQUIRED", symbol);
    assert.equal(
      bySymbol.get(symbol)?.reachabilityStatus,
      "disconnected_candidate",
      symbol,
    );
  }
  assert.equal(bySymbol.has("liveConfig"), false);
  assert.equal(bySymbol.has("locallyUsedConfig"), false);
  assert.equal(bySymbol.has("EXPORTED_BY_PYTHON_CONVENTION"), false);
});

test("withholds same-file-used mjs exports from deletion candidacy", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "mechanical-mjs-exports-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "extra/release/lib.mjs", [
    'import * as childProcess from "node:child_process";',
    'export const dryRun = process.env.DRY_RUN === "true";',
    'if (dryRun) console.log("dry run");',
    'export function execSync(command) { childProcess.execSync(command); }',
    'export function build() { childProcess.execSync("npm run build"); }',
    'export function unusedExport() {}',
  ].join("\n"));

  const { graph, indexedSourceFiles } = await indexRepository(repositoryPath);
  const syntheticCandidates = ["dryRun", "execSync", "unusedExport"].map(
    (symbol) => ({
      id: `dead:extra/release/lib.mjs:${symbol}`,
      nodeIds: graph.symbols
        .filter((node) => node.name === symbol)
        .map((node) => node.id),
      file: "extra/release/lib.mjs",
      symbol,
      reachabilityStatus: "disconnected_candidate",
      verdict: "VALIDATION_REQUIRED",
      reason: "fixture",
      blockers: [],
      validation: null,
    }),
  );

  const filtered = await filterInFileUsedMjsExportCandidates(
    syntheticCandidates,
    graph,
    repositoryPath,
    indexedSourceFiles,
  );

  assert.deepEqual(filtered.map((candidate) => candidate.symbol), ["unusedExport"]);
});

test("withholds path-scoped Next.js lifecycle exports from deletion candidacy", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "mechanical-next-exports-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "middleware.ts", [
    "export function middleware() { return null; }",
    "export const config = { matcher: ['/account'] };",
  ].join("\n"));
  await writeFixture(repositoryPath, "next.config.ts", [
    "const nextConfig = { reactStrictMode: true };",
    "export default nextConfig;",
  ].join("\n"));
  await writeFixture(repositoryPath, "eslint.config.mjs", [
    "const eslintConfig = [{ rules: {} }];",
    "export default eslintConfig;",
  ].join("\n"));
  await writeFixture(repositoryPath, "app/account/page.tsx", [
    "export const metadata = { title: 'Account' };",
    "export const dynamic = 'force-dynamic';",
    "export const revalidate = 60;",
    "export default function Page() { return null; }",
  ].join("\n"));
  await writeFixture(
    repositoryPath,
    "src/config.ts",
    "export const config = { ordinary: true };",
  );

  const { graph } = await indexRepository(repositoryPath);
  const candidates = await findMechanicalDeadCodeCandidates(graph, repositoryPath);
  const symbols = new Set(candidates.map((candidate) => candidate.symbol));

  for (const frameworkExport of [
    "dynamic",
    "eslintConfig",
    "metadata",
    "nextConfig",
    "revalidate",
  ]) {
    assert.equal(symbols.has(frameworkExport), false, frameworkExport);
  }
  assert.equal(
    candidates.some((candidate) =>
      candidate.file === "middleware.ts" && candidate.symbol === "config"
    ),
    false,
  );
  assert.equal(
    candidates.some((candidate) =>
      candidate.file === "src/config.ts" && candidate.symbol === "config"
    ),
    true,
  );
});

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
