import { readFile } from "node:fs/promises";

import type {
  FeatureAuditStatus,
  FunctionalityAudit,
} from "./types.js";
import { validateFunctionalityAudit } from "./validateFunctionalityAudit.ts";

const STATUS_ORDER: readonly FeatureAuditStatus[] = [
  "IMPLEMENTED_DOCUMENTED",
  "IMPLEMENTED_UNDOCUMENTED",
  "PARTIALLY_IMPLEMENTED",
  "DOCUMENTED_NOT_IMPLEMENTED",
  "AMBIGUOUS",
];

const STATUS_LABELS: Readonly<Record<FeatureAuditStatus, string>> = {
  IMPLEMENTED_DOCUMENTED: "Implemented and documented",
  IMPLEMENTED_UNDOCUMENTED: "Implemented but undocumented",
  PARTIALLY_IMPLEMENTED: "Partially implemented",
  DOCUMENTED_NOT_IMPLEMENTED: "Documented but not implemented",
  AMBIGUOUS: "Ambiguous",
};

export async function renderAuditReportFromJson(
  auditPath: string,
): Promise<string> {
  const audit = JSON.parse(
    await readFile(auditPath, "utf8"),
  ) as FunctionalityAudit;
  validateFunctionalityAudit(audit);
  return renderAuditReport(audit);
}

export function renderAuditReport(audit: FunctionalityAudit): string {
  validateFunctionalityAudit(audit);
  const readyCandidates = audit.deadCodeCandidates
    .filter((candidate) => candidate.verdict === "VALIDATION_REQUIRED")
    .sort(
      (left, right) =>
        compareText(left.file, right.file) ||
        left.line - right.line ||
        compareText(left.symbol, right.symbol),
    )
    .slice(0, 5);
  const lines: string[] = [
    "# Functionality Audit Report",
    "",
    `Repository commit: \`${inlineCode(audit.repositoryCommit)}\``,
    "",
    "## Takeover Summary",
    "",
    `The audit records ${counted(audit.summary.implemented_documented, "implemented and documented feature")}, ${counted(audit.summary.implemented_undocumented, "implemented but undocumented feature")}, ${counted(audit.summary.partially_implemented, "partially implemented feature")}, and ${counted(audit.summary.documented_not_implemented, "documented but not implemented feature")}. It also identifies ${counted(audit.summary.dead_code_candidates, "dead-code candidate")}, with ${audit.summary.ready_for_delete_validation} ready for delete validation.`,
    "",
    "### Dead code ready to validate",
    "",
    ...(readyCandidates.length === 0
      ? ["None."]
      : readyCandidates.map(
        (candidate) =>
          `- \`${inlineCode(candidate.file)}:${candidate.line}\` — \`${inlineCode(candidate.symbol)}\``,
      )),
    "",
    "Use this evidence for codebase takeover, fixed-price quoting, billed dead-code cleanup, and a handoff deliverable.",
    "",
    "## Summary",
    "",
    "| Result | Count |",
    "| --- | ---: |",
    `| Total features | ${audit.features.length} |`,
    `| Implemented and documented | ${audit.summary.implemented_documented} |`,
    `| Implemented but undocumented | ${audit.summary.implemented_undocumented} |`,
    `| Partially implemented | ${audit.summary.partially_implemented} |`,
    `| Documented but not implemented | ${audit.summary.documented_not_implemented} |`,
    `| Ambiguous | ${audit.summary.ambiguous} |`,
    `| Dead-code candidates | ${audit.summary.dead_code_candidates} |`,
    `| Ready for delete validation | ${audit.summary.ready_for_delete_validation} |`,
    `| Validated safe to delete | ${audit.summary.validated_safe_to_delete} |`,
    "",
    "## Features",
    "",
  ];

  for (const status of STATUS_ORDER) {
    const features = audit.features
      .filter((feature) => feature.status === status)
      .sort((left, right) =>
        compareText(left.title, right.title) || compareText(left.id, right.id)
      );
    lines.push(`### ${STATUS_LABELS[status]} (${features.length})`, "");
    if (features.length === 0) {
      lines.push("None.", "");
      continue;
    }
    for (const feature of features) {
      lines.push(
        `- ${feature.title} (\`${inlineCode(feature.id)}\`, ${feature.kind}, ${feature.confidence.toLowerCase()} confidence)`,
        `  - Entrypoints: ${renderNodeIds(feature.entrypointNodeIds)}`,
      );
      if (feature.gaps.length > 0) {
        lines.push(`  - Gaps: ${feature.gaps.map(plainText).join("; ")}`);
      }
    }
    lines.push("");
  }

  lines.push("## Dead-Code Candidates", "");
  if (audit.deadCodeCandidates.length === 0) {
    lines.push("None.", "");
  } else {
    for (const candidate of [...audit.deadCodeCandidates].sort((left, right) =>
      compareText(left.file, right.file) || compareText(left.symbol, right.symbol)
    )) {
      lines.push(
        `- \`${inlineCode(candidate.file)}::${inlineCode(candidate.symbol)}\` — ${plainText(candidate.reason)} (${candidate.verdict})`,
      );
    }
    lines.push("");
  }

  lines.push("## Limitations", "");
  if (audit.limitations.length === 0) {
    lines.push("None.", "");
  } else {
    lines.push(...audit.limitations.map((limitation) => `- ${plainText(limitation)}`), "");
  }

  lines.push(
    "## Metrics",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Wall-clock time | ${audit.metrics.wallClockMs} ms |`,
    `| Deterministic time | ${audit.metrics.deterministicWallClockMs} ms |`,
    `| Model requests | ${audit.metrics.modelRequests} |`,
    `| Prompt tokens | ${audit.metrics.promptTokens} |`,
    `| Completion tokens | ${audit.metrics.completionTokens} |`,
    `| Total tokens | ${audit.metrics.totalTokens} |`,
    `| Cache | ${audit.metrics.cache} |`,
    "",
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderNodeIds(nodeIds: readonly string[]): string {
  if (nodeIds.length === 0) return "None";
  return nodeIds.map((nodeId) => `\`${inlineCode(nodeId)}\``).join(", ");
}

function inlineCode(value: string): string {
  return value.replaceAll("`", "'");
}

function plainText(value: string): string {
  return value.replaceAll("\r", " ").replaceAll("\n", " ").trim();
}

function counted(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? "" : "s"}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
