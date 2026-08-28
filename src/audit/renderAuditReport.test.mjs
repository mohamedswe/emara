import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  renderAuditReport,
  renderAuditReportFromJson,
} from "./renderAuditReport.ts";
import { deriveFunctionalityAuditSummary } from "./validateFunctionalityAudit.ts";

test("renders a readable report with every required section", async (context) => {
  const audit = validAudit();
  const report = renderAuditReport(audit);

  assert.match(report, /\| Total features \| 2 \|/u);
  assert.match(
    report,
    /^# Functionality Audit Report[\s\S]*?## Takeover Summary\n\nThe audit records 1 implemented and documented feature, 1 implemented but undocumented feature, 0 partially implemented features, and 0 documented but not implemented features\. It also identifies 1 dead-code candidate, with 1 ready for delete validation\./u,
  );
  assert.match(report, /### Dead code ready to validate\n\n- `src\/unused\.ts:7` — `unused`/u);
  assert.match(
    report,
    /codebase takeover, fixed-price quoting, billed dead-code cleanup, and a handoff deliverable\./u,
  );
  assert.ok(report.indexOf("## Takeover Summary") < report.indexOf("## Summary"));
  assert.match(report, /### Implemented and documented \(1\)/u);
  assert.match(report, /### Implemented but undocumented \(1\)/u);
  assert.match(report, /Entrypoints: `entrypoint:login`/u);
  assert.match(report, /`src\/unused\.ts::unused` — No production path\./u);
  assert.match(report, /## Limitations\n\nNone\./u);
  assert.match(report, /\| Model requests \| 0 \|/u);

  const directory = await mkdtemp(join(tmpdir(), "audit-report-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const auditPath = join(directory, "functionality-audit.json");
  await writeFile(auditPath, `${JSON.stringify(audit)}\n`, "utf8");
  assert.equal(await renderAuditReportFromJson(auditPath), report);
});

test("shows only the deterministic top five deletion-validation candidates", () => {
  const audit = validAudit();
  const template = audit.deadCodeCandidates[0];
  audit.deadCodeCandidates = [
    template,
    candidate(template, "dead:alpha", "src/alpha.ts", 9, "alpha"),
    candidate(template, "dead:beta", "src/alpha.ts", 3, "beta"),
    candidate(template, "dead:gamma", "src/gamma.ts", 2, "gamma"),
    candidate(template, "dead:omega", "src/omega.ts", 1, "omega"),
    candidate(template, "dead:zeta", "src/zeta.ts", 1, "zeta"),
  ];
  audit.summary = deriveFunctionalityAuditSummary(audit);

  const report = renderAuditReport(audit);
  const readySection = report.slice(
    report.indexOf("### Dead code ready to validate"),
    report.indexOf("Use this evidence for codebase takeover"),
  );

  assert.deepEqual(
    readySection.match(/`src\/[^`]+:\d+`/gu),
    [
      "`src/alpha.ts:3`",
      "`src/alpha.ts:9`",
      "`src/gamma.ts:2`",
      "`src/omega.ts:1`",
      "`src/unused.ts:7`",
    ],
  );
  assert.doesNotMatch(readySection, /src\/zeta\.ts/u);
});

function candidate(template, id, file, line, symbol) {
  return { ...template, id, file, line, symbol, nodeIds: [] };
}

function validAudit() {
  const audit = {
    schema: "functionality-audit/v2",
    repositoryCommit: "abc123",
    summary: {},
    features: [
      {
        canonicalId: "feature-0123456789abcdefabcd",
        id: "auth",
        title: "Authentication",
        kind: "functional",
        status: "IMPLEMENTED_DOCUMENTED",
        entrypointNodeIds: ["entrypoint:login"],
        implementationNodeIds: ["function:login"],
        documentationPromiseIds: ["promise:auth"],
        gaps: [],
        confidence: "HIGH",
      },
      {
        canonicalId: "feature-123456789abcdefabcde",
        id: "jobs",
        title: "Background jobs",
        kind: "infrastructure",
        status: "IMPLEMENTED_UNDOCUMENTED",
        entrypointNodeIds: [],
        implementationNodeIds: ["function:jobs"],
        documentationPromiseIds: [],
        gaps: [],
        confidence: "MEDIUM",
      },
    ],
    documentationPromises: [{
      id: "promise:auth",
      text: "Users can sign in.",
      evidenceNodeId: "file:README.md",
      featureIds: ["auth"],
    }],
    declaredClaims: [],
    featureSourceDisagreements: [],
    deadCodeCandidates: [{
      id: "dead:unused",
      nodeIds: ["function:unused"],
      file: "src/unused.ts",
      line: 7,
      symbol: "unused",
      reachabilityStatus: "disconnected_candidate",
      verdict: "VALIDATION_REQUIRED",
      reason: "No production path.",
      blockers: ["Run tests."],
      validation: null,
    }],
    coverage: {
      recognizedEntrypointIds: ["entrypoint:login"],
      entrypointFeatureMap: { "entrypoint:login": ["auth"] },
      unclassifiedEntrypointIds: [],
      documentationPromiseIds: ["promise:auth"],
      documentationFeatureMap: { "promise:auth": ["auth"] },
      unclassifiedDocumentationPromiseIds: [],
      productionReachabilityCounts: {
        product_reachable: 2,
        startup_reachable: 0,
        test_only: 0,
        public_api_unproven: 0,
        dynamic_unknown: 0,
        disconnected_candidate: 1,
      },
    },
    metrics: {
      wallClockMs: 10,
      deterministicWallClockMs: 10,
      modelRequests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cache: "cold",
    },
    limitations: [],
  };
  audit.summary = deriveFunctionalityAuditSummary(audit);
  return audit;
}
