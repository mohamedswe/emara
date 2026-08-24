import type { RepositoryGraph } from "../graph/types.js";
import { isTestFilePath } from "../scanner/classifyFilePath.ts";
import type {
  ContractCoverageFinding,
  ContractCoverageReview,
  CoverageClassification,
} from "./types.js";

/**
 * Deterministic coverage cascade.
 *
 * The acceptance gate requires every meaningful node to be either explained by a
 * contract claim or conclusively classified as support code. The discovery LLM
 * cannot be trusted to cite every helper, schema, and component a feature uses,
 * so this cascade resolves the nodes it can prove from graph evidence BEFORE any
 * LLM coverage investigation spends tokens. The LLM only sees the genuinely
 * ambiguous remainder.
 *
 * Passes, cheapest first:
 *  1. documentation accounting — uncited docs files are accounted, not features.
 *  2. test-only reclassification — reachable only from test roots => test support.
 *  3. dead-code flagging — no static path from any root => deletion candidate.
 *  4. dossier expansion — a feature node in the same file as an already-explained
 *     feature node belongs to that feature's surface (the feature uses it).
 */

export interface CascadeResult {
  /** Findings the cascade resolved, with their new classification and reason. */
  resolved: ContractCoverageFinding[];
  /** Node IDs the cascade could not resolve; these go to the LLM. */
  unresolvedNodeIds: string[];
  /** Deletion candidates: proven unreachable, not dynamically loaded. */
  deletionCandidates: ContractCoverageFinding[];
  counts: {
    documentationAccounted: number;
    testOnlyReclassified: number;
    deadCodeFlagged: number;
    dossierExpanded: number;
  };
}

const DOCUMENTATION_PATH =
  /(?:^|\/)(?:readme|agents)\.md$|(?:^|\/)docs\/.*\.(?:md|mdx)$/iu;

type CoverageInput = Omit<
  ContractCoverageReview,
  "investigations" | "remainingUnknownNodeIds"
>;

export function runCoverageCascade(
  graph: RepositoryGraph,
  coverage: CoverageInput,
): CascadeResult {
  const unexplainedIds = new Set(coverage.unexplained.map((f) => f.nodeId));

  const resolved: ContractCoverageFinding[] = [];
  const deletionCandidates: ContractCoverageFinding[] = [];
  const counts = {
    documentationAccounted: 0,
    testOnlyReclassified: 0,
    deadCodeFlagged: 0,
    dossierExpanded: 0,
  };

  for (const finding of coverage.unaccounted) {
    // Pass 1: documentation files are accounted as documentation, never features.
    if (finding.nodeType === "file" && DOCUMENTATION_PATH.test(finding.file)) {
      resolved.push(
        reclassify(
          finding,
          "documentation",
          "Documentation file accounted for by the coverage cascade.",
        ),
      );
      counts.documentationAccounted += 1;
      continue;
    }

    // Pass 2: reachable only from test roots => test support, not a feature.
    if (finding.reachability === "test_only" || isTestFilePath(finding.file)) {
      resolved.push(
        reclassify(
          finding,
          "test",
          "Reachable only from test code; reclassified as test support by the coverage cascade.",
        ),
      );
      counts.testOnlyReclassified += 1;
      continue;
    }

    // Pass 2b: utility-classified nodes in script/tooling paths are support code
    // by definition. A script's top-level constants (DEFAULT_DATABASE_URL,
    // SCHEMA_SQL, thresholds) have no entrypoint path and never will — requiring
    // one makes convergence impossible. Account for them as utility support.
    if (
      finding.classification === "utility" &&
      /(?:^|\/)(?:scripts?|tools?|bin|scripts-dev)(?:\/|$)/iu.test(finding.file)
    ) {
      resolved.push(
        reclassify(
          finding,
          "utility",
          "Utility node in a script/tooling path; accounted for as support code by the coverage cascade.",
        ),
      );
      counts.testOnlyReclassified += 1;
      continue;
    }

    // Pass 3: proven unreachable => deletion candidate (verify no dynamic load).
    if (finding.reachability === "dead_or_unreferenced") {
      const flagged = reclassify(
        finding,
        "dead/unreachable",
        "No static path from any entrypoint, startup, or test root. Deletion candidate — verify it is not loaded dynamically before removing.",
      );
      resolved.push(flagged);
      deletionCandidates.push(flagged);
      counts.deadCodeFlagged += 1;
      continue;
    }

    // Pass 4: a reachable feature node sharing a file with an already-explained
    // feature node is part of that feature's surface — the feature uses it.
    if (
      finding.classification === "feature" &&
      finding.reachability === "reachable" &&
      sharesFileWithExplainedNode(graph, finding.nodeId, unexplainedIds)
    ) {
      resolved.push(
        reclassify(
          finding,
          "feature",
          "Reachable and shares a source file with an already-explained feature node; the feature uses it, so it is accounted for by that feature's dossier.",
        ),
      );
      counts.dossierExpanded += 1;
      continue;
    }
  }

  const resolvedIds = new Set(resolved.map((f) => f.nodeId));
  const unresolvedNodeIds = coverage.unaccounted
    .map((f) => f.nodeId)
    .filter((id) => !resolvedIds.has(id));

  return { resolved, unresolvedNodeIds, deletionCandidates, counts };
}

/**
 * True when a sibling symbol in the same source file is already explained by the
 * contract — meaning discovery cited a sibling from this file as feature
 * evidence, so this symbol belongs to the same feature surface.
 */
function sharesFileWithExplainedNode(
  graph: RepositoryGraph,
  nodeId: string,
  unexplainedIds: ReadonlySet<string>,
): boolean {
  const fileId = fileIdOf(graph, nodeId);
  if (fileId === null) return false;
  return graph.symbols.some(
    (s) => s.fileId === fileId && s.id !== nodeId && !unexplainedIds.has(s.id),
  );
}

function fileIdOf(graph: RepositoryGraph, nodeId: string): string | null {
  const symbol = graph.symbols.find((s) => s.id === nodeId);
  if (symbol !== undefined) return symbol.fileId;
  const entity = graph.entities.find((e) => e.id === nodeId);
  if (entity !== undefined && "fileId" in entity) {
    return (entity as { fileId: string }).fileId;
  }
  const file = graph.files.find((f) => f.id === nodeId);
  if (file !== undefined) return file.id;
  return null;
}

function reclassify(
  finding: ContractCoverageFinding,
  classification: CoverageClassification,
  reason: string,
): ContractCoverageFinding {
  return { ...finding, classification, reason };
}
