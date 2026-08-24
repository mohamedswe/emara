import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import {
  buildContractDiscoveryBrief,
  isProductDocumentationSourcePath,
} from "./discoveryBrief.ts";
import { createContractDiscoveryTools } from "./discoveryTools.ts";

const temporaryRepositories = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    ),
  );
});

test("front-loads documented promises, endpoints, and disconnected exported candidates", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "contract-discovery-brief-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "README.md", [
    "# Delivery guarantees",
    "The service must retry failed notifications and encrypt stored tokens.",
    "",
    "Parse PDFs and other document formats.",
    "",
    "Redis/Celery-ready background job stack.",
  ].join("\n"));
  await writeFixture(repositoryPath, "src/app.ts", [
    "function health() { return { ok: true }; }",
    "router.get('/health', health);",
    "export function dormantNotifier() { return 'not wired'; }",
  ].join("\n"));

  const { graph } = await indexRepository(repositoryPath);
  const tools = createContractDiscoveryTools(graph, repositoryPath);
  const result = await buildContractDiscoveryBrief(graph, tools);

  assert.equal(result.toolCalls, 1);
  assert.equal(result.brief.entrypoints.total, 1);
  assert.ok(result.brief.entrypoints.items.some((item) => item.route === "/health"));
  assert.ok(
    result.brief.documentedPromiseExcerpts.some((item) =>
      item.evidenceNodeId === "file:README.md" &&
      /retry failed notifications/.test(item.text)
    ),
  );
  assert.ok(
    result.brief.documentedPromiseExcerpts.some((item) =>
      item.text === "Parse PDFs and other document formats."
    ),
  );
  assert.ok(
    result.brief.documentedPromiseExcerpts.some((item) =>
      /Redis\/Celery-ready background job stack/.test(item.text)
    ),
  );
  assert.equal(
    new Set(result.brief.documentedPromiseExcerpts.map((item) => item.id)).size,
    result.brief.documentedPromiseExcerpts.length,
  );
  assert.ok(
    result.brief.discoveryCandidates.items.some((item) =>
      item.nodeId === "function:src/app.ts:dormantNotifier" &&
      item.exported === true &&
      item.classification === "utility" &&
      item.reachability === "unknown"
    ),
  );
  assert.equal(result.brief.featureClusters.total, 1);
  assert.ok(
    result.brief.featureClusters.items[0].members.some((member) =>
      member.nodeId === "function:src/app.ts:health" &&
      member.role === "handler"
    ),
  );
  assert.ok(
    result.brief.featureClusters.documentationMappings.some((mapping) =>
      mapping.status === "unmatched"
    ),
  );
  assert.ok(
    result.brief.featureClusters.unassignedCode.items.some((item) =>
      item.nodeId === "function:src/app.ts:dormantNotifier"
    ),
  );
  assert.ok(tools.inspectedNodeIds().includes("file:README.md"));
});

test("whitelists product documentation sources and excludes agent and community files", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "contract-doc-sources-"));
  temporaryRepositories.push(repositoryPath);
  await Promise.all([
    writeFixture(
      repositoryPath,
      "README.md",
      "# Features\n- Multi Languages\n",
    ),
    writeFixture(
      repositoryPath,
      "docs/monitoring.md",
      "# Monitoring\nThe service must monitor HTTP endpoints.\n",
    ),
    writeFixture(
      repositoryPath,
      "FEATURES.md",
      "# Features\nThe product must provide status pages.\n",
    ),
    writeFixture(
      repositoryPath,
      "AGENTS.md",
      "# Rules\nYou will be BANNED immediately. They will lose their job.\n",
    ),
    writeFixture(
      repositoryPath,
      "CONTRIBUTING.md",
      "# Tests\n> [!TIP]\n> Writing great tests is hard.\n",
    ),
    writeFixture(
      repositoryPath,
      "test/backend-test/README.md",
      "# Test guidance\n> [!TIP]\n> Writing great tests is hard.\n",
    ),
    writeFixture(
      repositoryPath,
      "docs/SECURITY.md",
      "# Security\nReports must use the private channel.\n",
    ),
  ]);

  const { graph } = await indexRepository(repositoryPath);
  const tools = createContractDiscoveryTools(graph, repositoryPath);
  const result = await buildContractDiscoveryBrief(graph, tools);
  const claims = result.brief.documentedPromiseExcerpts;

  assert.deepEqual(
    claims.map((claim) => claim.path),
    ["FEATURES.md", "README.md", "docs/monitoring.md"],
  );
  assert.ok(claims.some((claim) => claim.text === "Multi Languages"));
  assert.ok(claims.every((claim) =>
    !/BANNED|lose their job|Writing great tests|private channel/iu.test(claim.text)
  ));
  assert.deepEqual(
    tools.inspectedNodeIds().filter((id) => /AGENTS|CONTRIBUTING|SECURITY/iu.test(id)),
    [],
  );
});

test("classifies product documentation paths with community exclusions taking precedence", () => {
  assert.equal(isProductDocumentationSourcePath("README.md"), true);
  assert.equal(isProductDocumentationSourcePath("packages/ui/README.en.md"), true);
  assert.equal(isProductDocumentationSourcePath("frontend/README.txt"), false);
  assert.equal(isProductDocumentationSourcePath("docs/features.md"), true);
  assert.equal(isProductDocumentationSourcePath("PRODUCT_CLAIMS.md"), true);
  assert.equal(isProductDocumentationSourcePath("AGENTS.md"), false);
  assert.equal(isProductDocumentationSourcePath("CONTRIBUTING.md"), false);
  assert.equal(isProductDocumentationSourcePath("docs/CODE_OF_CONDUCT.md"), false);
  assert.equal(isProductDocumentationSourcePath("docs/SECURITY.md"), false);
  assert.equal(isProductDocumentationSourcePath("SECURITY_SUMMARY.md"), false);
  assert.equal(isProductDocumentationSourcePath(".github/ISSUE_TEMPLATE/bug.md"), false);
  assert.equal(isProductDocumentationSourcePath("random-notes.md"), false);
});

test("extracts complete Markdown-free paragraph claims", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "contract-paragraphs-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "README.md", [
    "## Features",
    "- **Graph construction** builds a persistent [repository graph](docs/graph.md)",
    "  from symbols and calls.",
    "- `Contract discovery` validates documented behavior.",
    "",
    "The dead-code pass finds candidates. It never deletes them automatically.",
    "",
    "```ts",
    "audit.mustNotBecomeAClaim();",
    "```",
  ].join("\n"));

  const { graph } = await indexRepository(repositoryPath);
  const tools = createContractDiscoveryTools(graph, repositoryPath);
  const result = await buildContractDiscoveryBrief(graph, tools);
  const claims = result.brief.documentedPromiseExcerpts.map((claim) => claim.text);

  assert.deepEqual(claims, [
    "Graph construction builds a persistent repository graph from symbols and calls.",
    "Contract discovery validates documented behavior.",
    "The dead-code pass finds candidates. It never deletes them automatically.",
  ]);
  assert.ok(claims.every((claim) => !/[`*_\[\]]/u.test(claim)));
});

test("extracts structured claims from documentation fences but skips source fences", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "contract-fenced-claims-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "README.md", [
    "## Architecture",
    "```text",
    "External Services / Infrastructure",
    "  |-- Supabase",
    "  |-- Redis/Celery-ready background job stack",
    "```",
    "",
    "```ts",
    "audit.mustNotBecomeAClaim();",
    "```",
  ].join("\n"));

  const { graph } = await indexRepository(repositoryPath);
  const tools = createContractDiscoveryTools(graph, repositoryPath);
  const result = await buildContractDiscoveryBrief(graph, tools);
  const claims = result.brief.documentedPromiseExcerpts.map((claim) => claim.text);

  assert.ok(claims.includes("Redis/Celery-ready background job stack"));
  assert.ok(claims.every((claim) => !/mustNotBecomeAClaim/u.test(claim)));
});

test("skips Mermaid sequence diagrams as implementation notation", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "contract-mermaid-claims-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "README.md", [
    "## Features",
    "- Users can manage their profiles.",
    "",
    "```mermaid",
    "sequenceDiagram",
    "Note over C,API: Authentication flow",
    "C->>API: POST /auth/login",
    "```",
    "",
    "sequenceDiagram",
    "Note over C,API: Token refresh",
    "C->>API: POST /auth/refresh",
  ].join("\n"));

  const { graph } = await indexRepository(repositoryPath);
  const tools = createContractDiscoveryTools(graph, repositoryPath);
  const result = await buildContractDiscoveryBrief(graph, tools);
  const claims = result.brief.documentedPromiseExcerpts.map((claim) => claim.text);

  assert.deepEqual(claims, ["Users can manage their profiles."]);
});

test("extracts README stack lists and preserves the React Query product name", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "contract-stack-list-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "README.md", [
    "## Tech Stack",
    "### Frontend",
    "- TanStack Query",
    "- React Dropzone",
    "- React Markdown",
  ].join("\n"));

  const { graph } = await indexRepository(repositoryPath);
  const tools = createContractDiscoveryTools(graph, repositoryPath);
  const result = await buildContractDiscoveryBrief(graph, tools);
  const claims = result.brief.documentedPromiseExcerpts.map((claim) => claim.text);

  assert.deepEqual(claims, [
    "React Query (TanStack Query)",
    "React Dropzone",
    "React Markdown",
  ]);
});

test("keeps consecutive route changelog lines as independently attributable promises", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "contract-route-changelog-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "README.md", [
    "routes/auth:",
    "",
    "Added GET /auth/login and GET /auth/register pages.",
    "Cleaned up POST /auth/login and POST /auth/register responses.",
    "Made /auth/profile safely extract and decode the Bearer token.",
  ].join("\n"));

  const { graph } = await indexRepository(repositoryPath);
  const tools = createContractDiscoveryTools(graph, repositoryPath);
  const result = await buildContractDiscoveryBrief(graph, tools);
  const claims = result.brief.documentedPromiseExcerpts;

  assert.deepEqual(
    claims.map((claim) => ({ line: claim.line, text: claim.text })),
    [
      { line: 3, text: "Added GET /auth/login and GET /auth/register pages." },
      {
        line: 4,
        text: "Cleaned up POST /auth/login and POST /auth/register responses.",
      },
      {
        line: 5,
        text: "Made /auth/profile safely extract and decode the Bearer token.",
      },
    ],
  );
});

test("extracts bounded product copy and summary claims as documentation promises", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "contract-product-copy-"));
  temporaryRepositories.push(repositoryPath);
  await writeFixture(repositoryPath, "frontend/src/pages/FeaturesPage.jsx", [
    "export function FeaturesPage() {",
    "  const description = \"Manage rental fleets and schedule vehicle maintenance.\";",
    "  return <p>{description}</p>;",
    "}",
  ].join("\n"));
  await writeFixture(repositoryPath, "frontend/src/contexts/LanguageContext.jsx", [
    "export const messages = {",
    "  fleetManagementDesc: 'Track vehicle status and fleet availability in real time.',",
    "};",
  ].join("\n"));
  await writeFixture(repositoryPath, "backend/TESTING_SUMMARY.md", [
    "## Security Validation",
    "- A user cannot access another company's data.",
  ].join("\n"));

  const { graph } = await indexRepository(repositoryPath);
  const tools = createContractDiscoveryTools(graph, repositoryPath);
  const result = await buildContractDiscoveryBrief(graph, tools);
  const claims = result.brief.documentedPromiseExcerpts;

  assert.ok(claims.some((claim) =>
    claim.path === "frontend/src/pages/FeaturesPage.jsx" &&
    /Manage rental fleets/u.test(claim.text)
  ));
  assert.ok(claims.some((claim) =>
    claim.path === "frontend/src/contexts/LanguageContext.jsx" &&
    /Track vehicle status/u.test(claim.text)
  ));
  assert.ok(claims.some((claim) =>
    claim.path === "backend/TESTING_SUMMARY.md" &&
    /cannot access another company's data/u.test(claim.text)
  ));
});

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
