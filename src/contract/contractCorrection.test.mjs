import assert from "node:assert/strict";
import { test } from "node:test";

import {
  correctionIsNeeded,
  selectCorrectionTargets,
} from "./contractCorrection.ts";

test("prioritizes unexplained external features and excludes ordinary utilities", () => {
  const findings = [
    finding("function:helper", "function", "utility", "dead_or_unreferenced"),
    finding("class:service", "class", "feature", "reachable"),
    finding("endpoint:refund", "endpoint", "feature", "reachable"),
    finding("screen:settings", "screen", "feature", "unknown"),
    finding("function:dormant", "function", "dead/unreachable", "dead_or_unreferenced", true),
  ];

  assert.deepEqual(
    selectCorrectionTargets(findings, [], 2).map((item) => item.nodeId),
    ["endpoint:refund", "screen:settings"],
  );
  assert.equal(correctionIsNeeded([], []), false);
  assert.equal(correctionIsNeeded([], selectCorrectionTargets(findings)), true);
  assert.ok(
    !selectCorrectionTargets(findings).some((item) => item.nodeId === "function:dormant"),
  );
  assert.deepEqual(
    selectCorrectionTargets(
      [finding("class:resolved", "class", "unknown", "unknown")],
      [
        {
          nodeId: "class:resolved",
          classification: "utility",
          conclusion: "A low-level helper.",
          evidenceNodeIds: ["class:resolved"],
        },
      ],
    ),
    [],
  );
  assert.equal(
    correctionIsNeeded([
      {
        targetKind: "requirement",
        targetId: "claim",
        hypothesis: "claim",
        status: "REFUTED",
        conclusion: "not supported",
        evidenceNodeIds: [],
      },
    ], []),
    true,
  );
});

function finding(nodeId, nodeType, classification, reachability, exported = null) {
  return {
    nodeId,
    nodeType,
    exported,
    file: "src/app.ts",
    lineRange: { start: 1, end: 1 },
    classification,
    reachability,
    reason: "Not explained by a feature dossier.",
    explainedByContractIds: [],
  };
}
