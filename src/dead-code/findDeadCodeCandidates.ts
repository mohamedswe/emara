import type {
  EvidenceGraphNode,
  RepositoryGraph,
  SymbolNode,
} from "../graph/types.js";
import {
  buildReachabilityLedger,
  type ReachabilityLedger,
} from "../retrieval/reachabilityLedger.ts";
import type { DeadCodeCandidate } from "../audit/types.js";
import { isTestFilePath } from "../scanner/classifyFilePath.ts";

type CandidateNode = SymbolNode | EvidenceGraphNode;

export interface FindDeadCodeOptions {
  reachabilityLedger?: ReachabilityLedger;
}

export { findUnusedImportCandidates } from "./findUnusedImportCandidates.ts";

/**
 * Produces reviewable candidates only. This function never returns a
 * VALIDATED_SAFE_TO_DELETE verdict; that requires isolated mutation validation.
 */
export function findDeadCodeCandidates(
  graph: RepositoryGraph,
  options: FindDeadCodeOptions = {},
): DeadCodeCandidate[] {
  const ledger = options.reachabilityLedger ?? buildReachabilityLedger(graph);
  const entryByNodeId = new Map(
    ledger.entries.map((entry) => [entry.nodeId, entry]),
  );
  const filesById = new Map(graph.files.map((file) => [file.id, file]));
  const candidates = [
    ...graph.entities.filter(
      (node) => node.type === "component" || node.type === "screen",
    ),
    // Top-level Python variables/classes frequently participate in framework
    // registration that is not represented as a direct call edge (router, app,
    // settings, declarative models). Keep them out of deletion-ready output
    // until a framework-specific rule proves their liveness or disconnection.
    ...graph.symbols.filter(
      (node) => node.type === "function" && node.exported,
    ),
  ].filter((node) => {
    const owner = filesById.get(node.fileId);
    if (owner !== undefined && isTestFilePath(owner.path)) return false;
    const status = entryByNodeId.get(node.id)?.status;
    return (
      status === "disconnected_candidate" ||
      status === "public_api_unproven" ||
      status === "dynamic_unknown" ||
      (
        "exported" in node &&
        node.type === "function" &&
        node.exported &&
        status === "test_only"
      )
    );
  });

  const grouped = new Map<string, CandidateNode[]>();
  for (const node of candidates) {
    const key = `${node.fileId}\u0000${node.name}`;
    const values = grouped.get(key) ?? [];
    values.push(node);
    grouped.set(key, values);
  }

  return [...grouped.values()]
    .map((nodes): DeadCodeCandidate => {
      const first = nodes[0];
      if (first === undefined) throw new Error("Dead-code group must not be empty");
      const file = filesById.get(first.fileId);
      if (file === undefined) {
        throw new Error(
          `Dead-code candidate ${JSON.stringify(first.id)} has no owning file`,
        );
      }
      const entries = nodes.flatMap((node) => {
        const value = entryByNodeId.get(node.id);
        return value === undefined ? [] : [value];
      });
      const strongest = entries.find(
        (entry) => entry.status === "disconnected_candidate",
      ) ?? entries.find((entry) => entry.status === "public_api_unproven") ??
        entries[0];
      if (strongest === undefined) {
        throw new Error(
          `Dead-code candidate ${JSON.stringify(first.id)} has no reachability entry`,
        );
      }
      const exported = nodes.some(
        (node) => "exported" in node && node.exported,
      );
      const isUiSurface = nodes.some(
        (node) => node.type === "component" || node.type === "screen",
      );
      const verdict = strongest.status === "disconnected_candidate" ||
          strongest.status === "test_only"
        ? exported || isUiSurface
          ? "VALIDATION_REQUIRED" as const
          : "CANDIDATE" as const
        : "UNKNOWN_DYNAMIC_USAGE" as const;
      return {
        id: `dead:${file.path}:${first.name}`,
        nodeIds: nodes.map((node) => node.id).sort(compareText),
        file: file.path,
        line: Math.min(...nodes.map((node) => node.lineRange.start)),
        symbol: first.name,
        reachabilityStatus: strongest.status,
        verdict,
        reason: strongest.reason,
        blockers: [...new Set(entries.flatMap((entry) => entry.blockers))]
          .sort(compareText),
        validation: null,
      };
    })
    .sort(
      (left, right) =>
        compareText(left.file, right.file) ||
        compareText(left.symbol, right.symbol),
    );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
