import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { indexRepository } from "../graph/indexRepository.ts";
import { clusterRepositoryFeatures } from "../features/clusterRepositoryFeatures.ts";
import { isDocumentationBoilerplateClaim } from "../contract/discoveryBrief.ts";
import {
  applyDeterministicClaimEvidence,
  applyUnresolvedExternalContracts,
  assignCanonicalFeatureIdentities,
  buildFunctionalityAudit,
  filterIrrelevantDocumentationMappings,
  enforceExplicitAccessControlDocumentation,
  recoverRelevantDocumentationMappings,
  selectPreferredSemanticDraft,
  splitUnsupportedPromises,
} from "./buildFunctionalityAudit.ts";

test("deterministically marks mixed enumerations partial and promotes provable absence", () => {
  const graph = {
    version: 4,
    analysis: {
      sourceFileCount: 1,
      parsedSourceFileCount: 1,
      unparsedSourceFiles: [],
      diagnostics: [],
    },
    files: [
      {
        id: "file:src/pdf_processor.ts",
        type: "file",
        path: "src/pdf_processor.ts",
        language: "typescript",
        contentHash: "pdf",
      },
      {
        id: "file:requirements-celery.txt",
        type: "file",
        path: "requirements-celery.txt",
        language: "unknown",
        contentHash: "manifest",
      },
    ],
    symbols: [{
      id: "function:src/pdf_processor.ts:processPdf",
      type: "function",
      name: "processPdf",
      fileId: "file:src/pdf_processor.ts",
      lineRange: { start: 1, end: 1 },
      exported: true,
    }],
    entrypoints: [],
    entities: [],
    edges: [],
  };
  const features = applyDeterministicClaimEvidence(
    [{
      ...featureFixture(),
      id: "document-ingestion",
      title: "Document ingestion",
      entrypointNodeIds: [],
      implementationNodeIds: ["function:src/pdf_processor.ts:processPdf"],
      documentationPromiseIds: ["doc:formats"],
    }],
    [
      { id: "doc:formats", text: "Parse PDFs and other document formats." },
      { id: "doc:workers", text: "Redis/Celery-ready background job stack." },
      { id: "doc:wrapper", text: "API client wrapper." },
    ],
    graph,
  );

  const ingestion = features.find((feature) => feature.id === "document-ingestion");
  assert.equal(ingestion?.status, "IMPLEMENTED_UNDOCUMENTED");
  assert.deepEqual(ingestion?.documentationPromiseIds, []);
  const formatParsing = features.find((feature) =>
    feature.documentationPromiseIds.includes("doc:formats")
  );
  assert.equal(formatParsing?.status, "PARTIALLY_IMPLEMENTED");
  assert.ok(
    formatParsing?.implementationNodeIds.includes(
      "function:src/pdf_processor.ts:processPdf",
    ),
  );
  assert.match(formatParsing?.gaps.at(-1) ?? "", /other document formats/iu);

  const workerStack = features.find((feature) =>
    feature.documentationPromiseIds.includes("doc:workers")
  );
  assert.equal(workerStack?.status, "DOCUMENTED_NOT_IMPLEMENTED");
  assert.deepEqual(workerStack?.implementationNodeIds, []);
  assert.match(workerStack?.gaps[0] ?? "", /dependency manifests are not implementation evidence/iu);
  assert.equal(
    features.some((feature) => feature.documentationPromiseIds.includes("doc:wrapper")),
    false,
  );
});

test("downgrades a feature whose external RPC contract is absent", () => {
  const [feature] = applyUnresolvedExternalContracts(
    [featureFixture()],
    [{
      kind: "rpc",
      name: "match_chunks",
      sourceNodeId: "function:search",
      repositoryDefinitionFound: false,
    }],
  );
  assert.equal(feature?.status, "AMBIGUOUS");
  assert.match(feature?.gaps[0] ?? "", /match_chunks/u);
});

test("does not let broad auth documentation overclaim ownership controls", () => {
  const [feature] = enforceExplicitAccessControlDocumentation(
    [{
      ...featureFixture(),
      id: "authorization-ownership",
      title: "Authorization and ownership checks",
      documentationPromiseIds: ["doc:auth"],
    }],
    [{ id: "doc:auth", text: "Auth and subject organization." }],
  );
  assert.equal(feature?.status, "IMPLEMENTED_UNDOCUMENTED");
  assert.deepEqual(feature?.documentationPromiseIds, []);
});

test("splits a specifically unsupported atomic promise from a broad partial feature", () => {
  const features = splitUnsupportedPromises(
    [{
      id: "document-processing",
      title: "Document processing",
      kind: "functional",
      status: "PARTIALLY_IMPLEMENTED",
      entrypointNodeIds: ["entry:upload"],
      implementationNodeIds: ["function:pdf"],
      documentationPromiseIds: ["doc:pdf", "doc:other"],
      gaps: ["Other document formats are accepted but not processed; only PDF is implemented."],
      confidence: "HIGH",
    }],
    [
      { id: "doc:pdf", text: "Parse PDFs." },
      { id: "doc:other", text: "Parse other document formats." },
    ],
  );

  assert.equal(features[0]?.status, "IMPLEMENTED_DOCUMENTED");
  assert.deepEqual(features[0]?.documentationPromiseIds, ["doc:pdf"]);
  assert.equal(features[1]?.status, "DOCUMENTED_NOT_IMPLEMENTED");
  assert.deepEqual(features[1]?.documentationPromiseIds, ["doc:other"]);
});

test("recovers an omitted atomic promise when a partial feature gap names it", () => {
  const features = splitUnsupportedPromises(
    [{
      ...featureFixture(),
      id: "pdf-processing",
      title: "PDF processing",
      status: "PARTIALLY_IMPLEMENTED",
      documentationPromiseIds: ["doc:pdf"],
      gaps: ["Other document formats are accepted but no processing implementation exists; only PDF processing is implemented."],
    }],
    [
      { id: "doc:pdf", text: "Parse PDFs." },
      { id: "doc:other", text: "Parse other document formats." },
      {
        id: "doc:overview",
        text: "The project includes a document processing pipeline.",
      },
    ],
  );

  assert.equal(features[0]?.status, "IMPLEMENTED_DOCUMENTED");
  assert.equal(features[1]?.status, "DOCUMENTED_NOT_IMPLEMENTED");
  assert.deepEqual(features[1]?.documentationPromiseIds, ["doc:other"]);
});

test("splits a missing worker stack out of contradictory implemented documentation", () => {
  const features = splitUnsupportedPromises(
    [{
      id: "background-processing",
      title: "Background processing for PDFs",
      kind: "infrastructure",
      status: "IMPLEMENTED_DOCUMENTED",
      entrypointNodeIds: ["entry:upload"],
      implementationNodeIds: ["function:background-task"],
      documentationPromiseIds: ["doc:redis"],
      gaps: [
        "Documentation promises Redis/Celery workers, but no Redis or Celery worker is implemented.",
      ],
      confidence: "HIGH",
    }],
    [{ id: "doc:redis", text: "Redis/Celery-ready background job stack." }],
  );

  assert.equal(features[0]?.status, "IMPLEMENTED_UNDOCUMENTED");
  assert.deepEqual(features[0]?.documentationPromiseIds, []);
  assert.equal(features[1]?.status, "DOCUMENTED_NOT_IMPLEMENTED");
  assert.deepEqual(features[1]?.documentationPromiseIds, ["doc:redis"]);
});

test("reuses an existing missing feature instead of inventing a second gap", () => {
  const features = splitUnsupportedPromises(
    [
      {
        ...featureFixture(),
        id: "redis-celery-stack",
        title: "Redis Celery worker stack",
        status: "DOCUMENTED_NOT_IMPLEMENTED",
        entrypointNodeIds: [],
        implementationNodeIds: [],
        documentationPromiseIds: ["doc:redis"],
        gaps: ["No Redis or Celery worker is present."],
      },
      {
        ...featureFixture(),
        id: "background-processing",
        title: "Background PDF processing",
        status: "PARTIALLY_IMPLEMENTED",
        documentationPromiseIds: ["doc:redis"],
        gaps: [
          "Uses FastAPI BackgroundTasks for PDF processing; no Redis or Celery worker is present.",
        ],
      },
    ],
    [
      { id: "doc:redis", text: "Redis Celery background worker stack." },
      { id: "doc:pdf", text: "PDF processing." },
    ],
  );

  assert.equal(features.length, 2);
  assert.equal(features[0]?.status, "DOCUMENTED_NOT_IMPLEMENTED");
  assert.equal(features[1]?.status, "IMPLEMENTED_UNDOCUMENTED");
  assert.deepEqual(features[1]?.documentationPromiseIds, []);
  assert.deepEqual(features[1]?.gaps, []);
});

test("removes structural inventory text from unrelated implemented features", () => {
  const features = filterIrrelevantDocumentationMappings(
    [
      {
        ...featureFixture(),
        id: "frontend-layout",
        title: "Frontend root layout",
        entrypointNodeIds: ["entrypoint:PAGE /layout"],
        documentationPromiseIds: ["doc:wrapper"],
      },
      {
        ...featureFixture(),
        id: "root-endpoint",
        title: "Backend root endpoint",
        entrypointNodeIds: ["entrypoint:GET /"],
        documentationPromiseIds: ["doc:directory"],
      },
      {
        ...featureFixture(),
        id: "health-check",
        title: "Health check endpoint",
        entrypointNodeIds: ["entrypoint:GET /health"],
        documentationPromiseIds: ["doc:health"],
      },
    ],
    [
      { id: "doc:wrapper", text: "API client wrapper." },
      { id: "doc:directory", text: "Root directory: backend." },
      { id: "doc:health", text: "Expose a health check endpoint." },
    ],
  );

  assert.equal(features[0]?.status, "IMPLEMENTED_UNDOCUMENTED");
  assert.deepEqual(features[0]?.documentationPromiseIds, []);
  assert.equal(features[1]?.status, "IMPLEMENTED_UNDOCUMENTED");
  assert.deepEqual(features[1]?.documentationPromiseIds, []);
  assert.equal(features[2]?.status, "IMPLEMENTED_DOCUMENTED");
  assert.deepEqual(features[2]?.documentationPromiseIds, ["doc:health"]);
});

test("limits route-specific promises to features owning the documented route", () => {
  const promises = [
    {
      id: "doc:auth-pages",
      text: "Added GET /auth/login and GET /auth/register pages that redirect logged-in users.",
    },
    {
      id: "doc:profile",
      text: "Made /auth/profile safely extract and decode the Bearer token.",
    },
    {
      id: "doc:users-flow",
      text: "Frontend (POST /users) to routes/users.py and back to the frontend.",
    },
  ];
  const feature = (id, title, entrypoint) => ({
    ...featureFixture(),
    id,
    title,
    entrypointNodeIds: [entrypoint],
    documentationPromiseIds: promises.map((promise) => promise.id),
  });
  const features = recoverRelevantDocumentationMappings(
    filterIrrelevantDocumentationMappings(
      [
        feature(
          "post-login",
          "Login",
          "entrypoint:http:backend/routes/auth.py:66:POST /login",
        ),
        feature(
          "post-register",
          "Register User",
          "entrypoint:http:backend/routes/auth.py:114:POST /register",
        ),
        feature(
          "get-profile",
          "Get Profile",
          "entrypoint:http:backend/routes/auth.py:133:GET /profile",
        ),
        feature(
          "post-refresh",
          "Refresh Token",
          "entrypoint:http:backend/routes/auth.py:155:POST /refresh",
        ),
        feature(
          "post-users",
          "Create User",
          "entrypoint:http:backend/routes/users.py:11:POST /users",
        ),
        feature(
          "get-users",
          "List Users",
          "entrypoint:http:backend/routes/users.py:16:GET /users",
        ),
        feature(
          "get-car-car-id",
          "Get Car Analytics",
          "entrypoint:http:backend/routes/analytics.py:14:GET /car/{car_id}",
        ),
      ],
      promises,
    ),
    promises,
  );
  const documentationByFeature = new Map(
    features.map((value) => [value.id, value.documentationPromiseIds]),
  );

  assert.deepEqual(documentationByFeature.get("post-login"), ["doc:auth-pages"]);
  assert.deepEqual(documentationByFeature.get("post-register"), ["doc:auth-pages"]);
  assert.deepEqual(documentationByFeature.get("get-profile"), ["doc:profile"]);
  assert.deepEqual(documentationByFeature.get("post-users"), ["doc:users-flow"]);
  assert.deepEqual(documentationByFeature.get("get-users"), ["doc:users-flow"]);
  assert.deepEqual(documentationByFeature.get("post-refresh"), []);
  assert.deepEqual(documentationByFeature.get("get-car-car-id"), []);
  assert.equal(features.find((value) => value.id === "post-refresh")?.status, "IMPLEMENTED_UNDOCUMENTED");
});

test("requires route ownership for status-page and monitor-type promises", () => {
  const promises = [
    {
      id: "doc:monitor-types",
      text: "Monitoring uptime for HTTP(s) / TCP / Keyword / Json / Webhook / DNS / Push / Steam.",
    },
    { id: "doc:status-pages", text: "Multiple status pages." },
    { id: "doc:status-domains", text: "Map status pages to specific domains." },
  ];
  const feature = (id, title, entrypoint, documentationPromiseIds) => ({
    ...featureFixture(),
    id,
    title,
    entrypointNodeIds: [entrypoint],
    documentationPromiseIds,
  });
  const features = recoverRelevantDocumentationMappings(
    filterIrrelevantDocumentationMappings(
      [
        feature(
          "get-api-badge-id-status",
          "GET /api/badge/:id/status",
          "entrypoint:http:server/routers/api-router.js:148:GET /api/badge/:id/status",
          ["doc:status-pages", "doc:status-domains"],
        ),
        feature(
          "get-status",
          "GET /status",
          "entrypoint:http:server/routers/status-page-router.js:28:GET /status",
          promises.map((promise) => promise.id),
        ),
        feature(
          "all-api-push-pushtoken",
          "ALL /api/push/:pushToken",
          "entrypoint:http:server/routers/api-router.js:47:ALL /api/push/:pushToken",
          [],
        ),
        feature(
          "get-status-page",
          "GET /status-page",
          "entrypoint:http:server/routers/status-page-router.js:33:GET /status-page",
          ["doc:status-pages", "doc:status-domains"],
        ),
      ],
      promises,
    ),
    promises,
  );
  const byId = new Map(features.map((value) => [value.id, value]));

  assert.deepEqual(byId.get("get-api-badge-id-status")?.documentationPromiseIds, []);
  assert.equal(byId.get("get-api-badge-id-status")?.status, "IMPLEMENTED_UNDOCUMENTED");
  assert.deepEqual(byId.get("get-status")?.documentationPromiseIds, []);
  assert.equal(byId.get("get-status")?.status, "IMPLEMENTED_UNDOCUMENTED");
  assert.deepEqual(byId.get("all-api-push-pushtoken")?.documentationPromiseIds, [
    "doc:monitor-types",
  ]);
  assert.equal(byId.get("all-api-push-pushtoken")?.status, "IMPLEMENTED_DOCUMENTED");
  assert.deepEqual(byId.get("get-status-page")?.documentationPromiseIds, [
    "doc:status-pages",
    "doc:status-domains",
  ]);
});

test("keeps product and access-control claims on their specific resource", () => {
  const promises = [
    {
      id: "doc:customers",
      text: "Maintain detailed customer profiles and rental history.",
      path: "frontend/src/contexts/LanguageContext.jsx",
    },
    {
      id: "doc:isolation",
      text: "Company data isolation prevents unauthorized cross-company access.",
    },
  ];
  const feature = (id, title, entrypoint) => ({
    ...featureFixture(),
    id,
    title,
    entrypointNodeIds: [entrypoint],
    documentationPromiseIds: promises.map((promise) => promise.id),
  });
  const features = filterIrrelevantDocumentationMappings(
    [
      feature(
        "post-clients",
        "Create Client",
        "entrypoint:http:backend/routes/clients.py:10:POST /",
      ),
      feature(
        "post-client-documents",
        "Upload Client Document",
        "entrypoint:http:backend/routes/client_documents.py:26:POST /clients/documents/",
      ),
      feature(
        "post-companies",
        "Create Company",
        "entrypoint:http:backend/routes/companies.py:47:POST /",
      ),
      feature(
        "company-isolation",
        "Company isolation authorization",
        "entrypoint:http:backend/routes/analytics.py:29:GET /fleet",
      ),
      feature(
        "get-active-rentals",
        "Get Active Rentals",
        "entrypoint:http:backend/routes/rentals.py:138:GET /active",
      ),
    ],
    promises,
  );
  const documentationByFeature = new Map(
    features.map((value) => [value.id, value.documentationPromiseIds]),
  );

  assert.deepEqual(documentationByFeature.get("post-clients"), ["doc:customers"]);
  assert.deepEqual(documentationByFeature.get("post-client-documents"), []);
  assert.deepEqual(documentationByFeature.get("post-companies"), []);
  assert.deepEqual(documentationByFeature.get("company-isolation"), ["doc:isolation"]);
  assert.deepEqual(documentationByFeature.get("get-active-rentals"), ["doc:customers"]);
});

test("does not treat action route suffixes as nested resource ownership", () => {
  const features = filterIrrelevantDocumentationMappings(
    [
      {
        ...featureFixture(),
        id: "post-api-auth-signup",
        title: "Sign Up API",
        entrypointNodeIds: [
          "entrypoint:http:app/api/auth/signup/route.ts:12:POST /api/auth/signup",
        ],
        documentationPromiseIds: ["doc:auth"],
      },
      {
        ...featureFixture(),
        id: "post-documents-upload",
        title: "Upload Document API",
        entrypointNodeIds: [
          "entrypoint:http:app/api/documents/upload/route.ts:20:POST /documents/upload",
        ],
        implementationNodeIds: ["function:services/pdf-processor.ts:parsePdf"],
        documentationPromiseIds: ["doc:formats"],
      },
      {
        ...featureFixture(),
        id: "get-api-auth-me",
        title: "Current Authenticated User API",
        entrypointNodeIds: [
          "entrypoint:http:backend/app/api/auth.py:21:GET /api/auth/me",
        ],
        documentationPromiseIds: ["doc:auth"],
      },
    ],
    [
      { id: "doc:auth", text: "Auth and subject organization." },
      { id: "doc:formats", text: "Parse PDFs and other document formats." },
    ],
  );

  assert.deepEqual(features[0]?.documentationPromiseIds, ["doc:auth"]);
  assert.deepEqual(features[1]?.documentationPromiseIds, ["doc:formats"]);
  assert.deepEqual(features[2]?.documentationPromiseIds, ["doc:auth"]);
});

test("recovers an omitted behavioral promise only within its documented layer", () => {
  const [feature] = recoverRelevantDocumentationMappings(
    [{
      ...featureFixture(),
      id: "auth-signup",
      title: "User signup",
      status: "IMPLEMENTED_UNDOCUMENTED",
      entrypointNodeIds: ["entrypoint:http:backend/app/api/auth.py:POST /signup"],
      documentationPromiseIds: [],
    }],
    [
      {
        id: "doc:backend-auth",
        text: "Auth and subject organization.",
        heading: "Backend highlights",
      },
      {
        id: "doc:callback",
        text: "Auth callback flow.",
        heading: "Frontend highlights",
      },
    ],
  );

  assert.equal(feature?.status, "IMPLEMENTED_DOCUMENTED");
  assert.deepEqual(feature?.documentationPromiseIds, ["doc:backend-auth"]);
});

test("keeps the initial draft when a critique introduces a material contradiction", () => {
  const initial = {
    features: [featureFixture()],
    unclassifiedEntrypointIds: [],
    unclassifiedDocumentationPromiseIds: [],
    limitations: [],
  };
  const critique = {
    ...initial,
    features: [{
      ...featureFixture(),
      id: "background-processing",
      title: "Background processing",
      documentationPromiseIds: ["doc:redis"],
      gaps: ["No Redis or Celery worker is implemented."],
    }],
  };
  const selection = selectPreferredSemanticDraft(
    initial,
    critique,
    [
      { id: "doc:search", text: "Semantic retrieval." },
      { id: "doc:redis", text: "Redis Celery worker stack." },
    ],
  );

  assert.equal(selection.selected, "initial");
  assert.ok(selection.initialQuality.score > selection.critiqueQuality.score);
});

test("derives canonical identity from evidence instead of the model alias", () => {
  const [first] = assignCanonicalFeatureIdentities([{
    ...featureFixture(),
    id: "authorization-ownership",
    title: "Authorization and ownership checks",
  }]);
  const [renamed] = assignCanonicalFeatureIdentities([{
    ...featureFixture(),
    id: "auth-ownership",
    title: "Ownership authorization",
    kind: "infrastructure",
    status: "AMBIGUOUS",
    documentationPromiseIds: ["doc:other"],
    gaps: ["Different model wording and verdict decoration."],
    confidence: "LOW",
  }]);

  assert.match(first?.canonicalId ?? "", /^feature-[a-f0-9]{20}$/u);
  assert.equal(first?.canonicalId, renamed?.canonicalId);
});

test("builds a machine-validated audit with one bounded semantic critique", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const model = new FactsAwareModel();
  const semanticPasses = [];

  const audit = await buildFunctionalityAudit(
    graph,
    repositoryPath,
    model,
    {
      repositoryCommit: "fixture-commit",
      onSemanticPasses: (passes) => semanticPasses.push(...passes),
    },
  );

  assert.equal(model.requests, 2);
  assert.equal(audit.schema, "functionality-audit/v2");
  assert.equal(audit.summary.implemented_documented, 1);
  assert.equal(audit.coverage.recognizedEntrypointIds.length, 1);
  assert.equal(audit.coverage.unclassifiedEntrypointIds.length, 0);
  assert.equal(audit.coverage.unclassifiedDocumentationPromiseIds.length, 0);
  assert.equal(audit.metrics.modelRequests, 2);
  assert.equal(audit.metrics.totalTokens, 30);
  assert.match(audit.features[0]?.canonicalId ?? "", /^feature-[a-f0-9]{20}$/u);
  assert.equal(model.requestFacts.some((facts) => "sourcePackets" in facts), false);
  assert.equal(
    model.requestFacts[0].features.every((feature) =>
      Object.keys(feature).join(",") === "featureId,fallbackTitle"
    ),
    true,
  );
  assert.deepEqual(
    Object.keys(model.requestsSeen[0].text.format.schema.properties),
    ["decorations", "promiseMappings"],
  );
  assert.equal(semanticPasses.length, 2);
  assert.equal(semanticPasses.filter((pass) => pass.selected).length, 1);
});

test("chunks oversized decoration inventories across exactly two bounded requests", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "functionality-audit-large-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await Promise.all(
    Array.from({ length: 181 }, (_, index) =>
      writeFixture(
        repositoryPath,
        `app/screen-${index}/page.tsx`,
        `export default function Screen${index}() { return <main>${index}</main>; }`,
      )
    ),
  );
  const { graph } = await indexRepository(repositoryPath);
  const model = new SizeLimitedDecorationModel(100);
  const semanticPasses = [];

  const audit = await buildFunctionalityAudit(
    graph,
    repositoryPath,
    model,
    {
      repositoryCommit: "fixture-commit",
      onSemanticPasses: (passes) => semanticPasses.push(...passes),
    },
  );

  assert.equal(audit.features.length, 181);
  assert.equal(model.requests, 2);
  assert.equal(audit.metrics.modelRequests, 2);
  assert.deepEqual(
    model.requestFacts.map((facts) => facts.features.length),
    [91, 90],
  );
  assert.equal(semanticPasses.length, 2);
  assert.equal(semanticPasses.every((pass) => pass.selected), true);
  assert.equal(
    audit.limitations.some((limitation) =>
      /Unterminated string|decoration chunk .* failed/iu.test(limitation)
    ),
    false,
  );
  assert.equal(
    audit.features.every((feature) => feature.title.startsWith("Decorated ")),
    true,
  );
});

test("allows one bounded repair request after deterministic validation rejects output", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const model = new FactsAwareModel(true);

  const audit = await buildFunctionalityAudit(
    graph,
    repositoryPath,
    model,
    { repositoryCommit: "fixture-commit" },
  );

  assert.equal(model.requests, 2);
  assert.equal(audit.features[0]?.id, "get-health");
  assert.equal(audit.features[0]?.title, "Health check");
  assert.equal(audit.metrics.modelRequests, 2);
});

test("keeps graph membership, statuses, and canonical IDs independent of decoration", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const first = await buildFunctionalityAudit(
    graph,
    repositoryPath,
    new FactsAwareModel(false, "First model title", false),
    { repositoryCommit: "fixture-commit" },
  );
  const second = await buildFunctionalityAudit(
    graph,
    repositoryPath,
    new FactsAwareModel(false, "Second model title", true),
    { repositoryCommit: "fixture-commit" },
  );
  const cluster = clusterRepositoryFeatures(graph).clusters[0];
  const expectedImplementation = cluster.members
    .map((member) => member.nodeId)
    .filter((nodeId) => !cluster.seedEntrypointIds.includes(nodeId))
    .sort();

  assert.notEqual(first.features[0]?.title, second.features[0]?.title);
  assert.deepEqual(
    deterministicFeatureProjection(first.features),
    deterministicFeatureProjection(second.features),
  );
  assert.deepEqual(first.features[0]?.implementationNodeIds, expectedImplementation);
});

test("rejects model promise mappings that deterministic relevance does not support", async (context) => {
  const repositoryPath = await twoFeatureRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const baseline = await buildFunctionalityAudit(
    graph,
    repositoryPath,
    new FactsAwareModel(),
    { repositoryCommit: "fixture-commit" },
  );
  const semanticPasses = [];
  const misrouted = await buildFunctionalityAudit(
    graph,
    repositoryPath,
    new MisroutingModel(),
    {
      repositoryCommit: "fixture-commit",
      onSemanticPasses: (passes) => semanticPasses.push(...passes),
    },
  );

  assert.deepEqual(
    deterministicFeatureProjection(misrouted.features),
    deterministicFeatureProjection(baseline.features),
  );
  assert.ok(
    semanticPasses.some(
      (pass) => (pass.quality?.irrelevantDocumentationMappings ?? 0) > 0,
    ),
  );
});

test("produces deterministic verdicts when both model requests fail", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const model = new AlwaysFailModel();
  const semanticPasses = [];

  const audit = await buildFunctionalityAudit(
    graph,
    repositoryPath,
    model,
    {
      repositoryCommit: "fixture-commit",
      onSemanticPasses: (passes) => semanticPasses.push(...passes),
    },
  );

  assert.equal(model.requests, 2);
  assert.equal(audit.metrics.modelRequests, 2);
  assert.equal(audit.summary.implemented_documented, 1);
  assert.match(audit.features[0]?.title ?? "", /^GET \/health/u);
  assert.match(audit.features[0]?.canonicalId ?? "", /^feature-[a-f0-9]{20}$/u);
  assert.equal(semanticPasses.length, 2);
  assert.equal(semanticPasses.some((pass) => pass.selected), false);
  assert.match(audit.limitations[0] ?? "", /deterministic feature labels/u);
});

test("skips decoration cleanly in deterministic mode", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  const { graph } = await indexRepository(repositoryPath);
  const semanticPasses = [];

  const first = await buildFunctionalityAudit(
    graph,
    repositoryPath,
    undefined,
    {
      repositoryCommit: "fixture-commit",
      deterministic: true,
      onSemanticPasses: (passes) => semanticPasses.push(...passes),
    },
  );
  const second = await buildFunctionalityAudit(
    graph,
    repositoryPath,
    undefined,
    { repositoryCommit: "fixture-commit", deterministic: true },
  );

  assert.equal(first.metrics.modelRequests, 0);
  assert.equal(first.metrics.totalTokens, 0);
  assert.equal(first.metrics.wallClockMs, 0);
  assert.equal(first.metrics.deterministicWallClockMs, 0);
  assert.deepEqual(first.limitations, []);
  assert.deepEqual(semanticPasses, []);
  assert.deepEqual(first, second);
});

test("audits CLI and library modules when no external entrypoint exists", async (context) => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "functionality-library-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await Promise.all([
    writeFixture(
      repositoryPath,
      "src/graph/build.ts",
      "export function buildGraph() { return { nodes: [] }; }",
    ),
    writeFixture(
      repositoryPath,
      "src/contract/build.ts",
      "export function buildContract() { return { requirements: [] }; }",
    ),
    writeFixture(
      repositoryPath,
      "src/dead-code/find.ts",
      "export function findDeadCode() { return []; }",
    ),
  ]);
  const { graph } = await indexRepository(repositoryPath);
  assert.equal(graph.entrypoints.length, 0);

  const audit = await buildFunctionalityAudit(
    graph,
    repositoryPath,
    new AlwaysFailModel(),
    { repositoryCommit: "fixture-commit" },
  );

  assert.equal(audit.features.length, 3);
  assert.equal(audit.summary.implemented_undocumented, 3);
  assert.equal(audit.summary.documented_not_implemented, 0);
  assert.deepEqual(
    audit.features.map((feature) => feature.title).sort(),
    ["Contract", "Dead Code", "Graph"],
  );
  assert.ok(
    audit.features.every((feature) => feature.implementationNodeIds.length > 0),
  );
});

test("quarantines unmatched documentation claims instead of promoting fake features", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  await writeFixture(
    repositoryPath,
    "README.md",
    "# Feature\n- API client wrapper.\n- The service must expose a health check.\n",
  );
  const { graph } = await indexRepository(repositoryPath);
  const model = new FactsAwareModel();

  const audit = await buildFunctionalityAudit(
    graph,
    repositoryPath,
    model,
    { repositoryCommit: "fixture-commit" },
  );

  const claim = audit.declaredClaims.find((value) => /API client wrapper/iu.test(value.text));
  assert.ok(claim);
  assert.equal(audit.features.length, 1);
  assert.equal(audit.summary.documented_not_implemented, 0);
  assert.equal(
    audit.features.some((feature) => /API client wrapper/iu.test(feature.title)),
    false,
  );
  assert.ok(
    audit.coverage.unclassifiedDocumentationPromiseIds.includes(
      claim.documentationPromiseId,
    ),
  );
  assert.equal(
    model.requestFacts[0].documentationPromises.some(
      (promise) => promise.id === claim.documentationPromiseId,
    ),
    false,
  );
});

test("keeps documentation boilerplate out of promises, declared claims, and features", async (context) => {
  const repositoryPath = await fixtureRepository(context);
  await writeFixture(
    repositoryPath,
    "README.md",
    [
      "# Features",
      "- The service must expose a health check.",
      "- When you run npm run build, Create React App substitutes %PUBLICURL%.",
      "- Webpack finds relative module references inside src/App.css.",
      "- You do not have to ever use eject or inspect node_modules.",
    ].join("\n"),
  );
  const { graph } = await indexRepository(repositoryPath);

  const audit = await buildFunctionalityAudit(
    graph,
    repositoryPath,
    undefined,
    { repositoryCommit: "fixture-commit", deterministic: true },
  );

  assert.ok(
    audit.documentationPromises.some((promise) => /health check/iu.test(promise.text)),
  );
  assert.ok(
    audit.documentationPromises.every((promise) =>
      !isDocumentationBoilerplateClaim(promise.text)
    ),
  );
  assert.ok(
    audit.declaredClaims.every((claim) =>
      !isDocumentationBoilerplateClaim(claim.text)
    ),
  );
  assert.ok(
    audit.features.every((feature) =>
      !isDocumentationBoilerplateClaim(feature.title)
    ),
  );
});

class FactsAwareModel {
  provider = "fake";
  requests = 0;
  failFirst;
  title;
  omitSuggestions;
  requestFacts = [];
  requestsSeen = [];

  constructor(failFirst = false, title = "Health check", omitSuggestions = false) {
    this.failFirst = failFirst;
    this.title = title;
    this.omitSuggestions = omitSuggestions;
  }

  async createResponse(request) {
    this.requests += 1;
    const facts = JSON.parse(request.input[0].content);
    this.requestFacts.push(facts);
    this.requestsSeen.push(request);
    const value = this.failFirst && this.requests === 1
      ? {
          decorations: [{
            featureId: "not-a-locked-feature",
            title: "Broken",
          }],
          promiseMappings: [],
        }
      : {
          decorations: facts.features.map((feature) => ({
            featureId: feature.featureId,
            title: this.title,
          })),
          promiseMappings: this.omitSuggestions
            ? []
            : facts.documentationPromises.map((promise) => ({
                documentationPromiseId: promise.id,
                suggestedFeatureIds: promise.candidateFeatureIds,
              })),
        };
    return {
      id: `response-${this.requests}`,
      status: "stop",
      output: [],
      outputText: JSON.stringify(value),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
  }
}

class AlwaysFailModel {
  provider = "fake";
  requests = 0;

  async createResponse() {
    this.requests += 1;
    throw new Error("model unavailable");
  }
}

class SizeLimitedDecorationModel {
  provider = "fake";
  requests = 0;
  limit;
  requestFacts = [];

  constructor(limit) {
    this.limit = limit;
  }

  async createResponse(request) {
    this.requests += 1;
    const facts = JSON.parse(request.input[0].content);
    this.requestFacts.push(facts);
    if (facts.features.length > this.limit) {
      throw new Error("simulated output truncation");
    }
    return {
      id: `response-${this.requests}`,
      status: "stop",
      output: [],
      outputText: JSON.stringify({
        decorations: facts.features.map((feature) => ({
          featureId: feature.featureId,
          title: `Decorated ${feature.fallbackTitle}`,
        })),
        promiseMappings: [],
      }),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
  }
}

class MisroutingModel {
  provider = "fake";
  requests = 0;

  async createResponse(request) {
    this.requests += 1;
    const facts = JSON.parse(request.input[0].content);
    return {
      id: `response-${this.requests}`,
      status: "stop",
      output: [],
      outputText: JSON.stringify({
        decorations: facts.features.map((feature) => ({
          featureId: feature.featureId,
          title: feature.fallbackTitle,
        })),
        promiseMappings: facts.documentationPromises.map((promise) => ({
          documentationPromiseId: promise.id,
          suggestedFeatureIds: [
            facts.features.find(
              (feature) => !promise.candidateFeatureIds.includes(feature.featureId),
            )?.featureId ?? promise.candidateFeatureIds[0],
          ],
        })),
      }),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
  }
}

function deterministicFeatureProjection(features) {
  return features.map((feature) => ({
    id: feature.id,
    canonicalId: feature.canonicalId,
    kind: feature.kind,
    status: feature.status,
    entrypointNodeIds: feature.entrypointNodeIds,
    implementationNodeIds: feature.implementationNodeIds,
    documentationPromiseIds: feature.documentationPromiseIds,
    gaps: feature.gaps,
    confidence: feature.confidence,
  }));
}

async function fixtureRepository(context) {
  const repositoryPath = await mkdtemp(join(tmpdir(), "functionality-audit-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(
    repositoryPath,
    "README.md",
    "# Features\n- The service must expose a health check.\n",
  );
  await writeFixture(
    repositoryPath,
    "src/app.ts",
    [
      "function health() { return { ok: true }; }",
      "router.get('/health', health);",
    ].join("\n"),
  );
  return repositoryPath;
}

async function twoFeatureRepository(context) {
  const repositoryPath = await mkdtemp(join(tmpdir(), "functionality-audit-"));
  context.after(() => rm(repositoryPath, { recursive: true, force: true }));
  await writeFixture(
    repositoryPath,
    "README.md",
    [
      "# Feature",
      "- The service must expose a health check.",
      "- The service must accept chat messages.",
    ].join("\n"),
  );
  await writeFixture(
    repositoryPath,
    "src/app.ts",
    [
      "function health() { return { ok: true }; }",
      "function sendMessage() { return { sent: true }; }",
      "router.get('/health', health);",
      "router.post('/messages', sendMessage);",
    ].join("\n"),
  );
  return repositoryPath;
}

function featureFixture() {
  return {
    id: "semantic-retrieval",
    title: "Semantic retrieval",
    kind: "functional",
    status: "IMPLEMENTED_DOCUMENTED",
    entrypointNodeIds: ["entry:chat"],
    implementationNodeIds: ["function:search"],
    documentationPromiseIds: ["doc:search"],
    gaps: [],
    confidence: "HIGH",
  };
}

async function writeFixture(repositoryPath, relativePath, content) {
  const filePath = join(repositoryPath, ...relativePath.split("/"));
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}
