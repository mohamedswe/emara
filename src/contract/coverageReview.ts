import type {
  EntryPointNode,
  EvidenceGraphNode,
  FileNode,
  RepositoryGraph,
  SymbolNode,
} from "../graph/types.js";
import { validateRepositoryGraph } from "../graph/validateRepositoryGraph.ts";
import { isReachable } from "../retrieval/reachability.ts";
import { isTestFilePath } from "../scanner/classifyFilePath.ts";
import { runCoverageCascade } from "./coverageCascade.ts";
import type {
  ContractCoverageFinding,
  ContractCoverageInvestigation,
  ContractCoverageReview,
  ContractDraft,
  CoverageClassification,
  FeatureReachability,
} from "./types.js";

type SourceBearingFileNode = FileNode & {
  lineRange: { start: number; end: number };
};
type MeaningfulNode =
  | EntryPointNode
  | EvidenceGraphNode
  | SymbolNode
  | SourceBearingFileNode;

const GENERATED_PATH = /(?:^|\/)(?:dist|build|coverage|vendor|generated|__generated__)(?:\/|$)|\.(?:generated|gen)\.[^/]+$/iu;
const CONFIG_PATH = /(?:^|\/)(?:config|configuration)(?:\/|$)|(?:^|\/)[^.\/]+\.config\.[^/]+$/iu;
const DOCUMENTATION_PATH = /(?:^|\/)(?:readme|agents)\.md$|(?:^|\/)docs\/.*\.(?:md|mdx)$/iu;
const CONTRACT_DATA_PATH = /(?:^|\/)data\/.*\.(?:json|ya?ml)$/iu;
const CONTRACT_MANIFEST_PATH = /(?:^|\/)(?:package\.json|pyproject\.toml|docker-compose\.ya?ml|dockerfile|tsconfig\.json)$/iu;

export function reviewCoverage(
  graph: RepositoryGraph,
  draft: ContractDraft,
): Omit<ContractCoverageReview, "investigations" | "remainingUnknownNodeIds"> {
  validateRepositoryGraph(graph);
  const filesById = new Map(graph.files.map((file) => [file.id, file]));
  const contractItemsByNode = contractCoverage(graph, draft);
  const candidates = selectMeaningfulNodes(graph);
  const findings = candidates.map((node) => {
    const file = node.type === "file" ? node : filesById.get(node.fileId);
    if (file === undefined) {
      throw new Error(`Coverage node ${JSON.stringify(node.id)} has no owning file`);
    }
    const equivalentIds = equivalentNodeIds(graph, node);
    const explainedByContractIds = [...new Set(
      [...equivalentIds].flatMap((nodeId) => contractItemsByNode.get(nodeId) ?? []),
    )].sort(compareText);
    const reachable = isReachable(graph, node.id);
    const classification = classifyNode(graph, node, file.path, reachable.status);
    return {
      nodeId: node.id,
      nodeType: node.type,
      exported:
        node.type === "function" ||
        node.type === "class" ||
        node.type === "variable"
          ? node.exported
          : null,
      file: file.path,
      lineRange: { ...node.lineRange },
      classification,
      reachability: reachable.status,
      reason: coverageReason(node, classification, reachable.status, explainedByContractIds.length > 0),
      explainedByContractIds,
    } satisfies ContractCoverageFinding;
  }).sort((left, right) => compareText(left.nodeId, right.nodeId));

  const unexplained = findings.filter((finding) => finding.explainedByContractIds.length === 0);
  const rawUnaccounted = unexplained.filter(
    (finding) => !isSupportAccountedFinding(finding, false),
  );

  // Deterministic coverage cascade: resolve the nodes provable from graph
  // evidence (test-only, documentation, dead code, feature-surface siblings)
  // before any LLM coverage investigation spends tokens on them.
  const cascade = runCoverageCascade(graph, {
    meaningfulNodes: findings.length,
    explainedMeaningfulNodes: 0,
    supportAccountedMeaningfulNodes: 0,
    accountedMeaningfulNodes: 0,
    unexplainedMeaningfulNodes: unexplained.length,
    unaccountedMeaningfulNodes: rawUnaccounted.length,
    coveragePercent: 0,
    classificationCounts: emptyClassificationCounts(),
    unexplained,
    unaccounted: rawUnaccounted,
    suspiciousUnknowns: [],
  });
  const cascadeByNodeId = new Map(
    cascade.resolved.map((finding) => [finding.nodeId, finding]),
  );
  const cascadedUnexplained = unexplained.map(
    (finding) => cascadeByNodeId.get(finding.nodeId) ?? finding,
  );
  const unaccounted = rawUnaccounted.filter(
    (finding) => !cascadeByNodeId.has(finding.nodeId),
  );
  const suspiciousUnknowns = unaccounted.filter(
    (finding) =>
      finding.classification === "unknown" || finding.reachability === "unknown",
  );
  const classificationCounts = emptyClassificationCounts();
  for (const finding of cascadedUnexplained) classificationCounts[finding.classification] += 1;
  const meaningfulNodeTotal = findings.length;
  const explainedMeaningfulNodes = meaningfulNodeTotal - unexplained.length;
  const supportAccountedMeaningfulNodes = unexplained.length - unaccounted.length;
  const accountedMeaningfulNodes =
    explainedMeaningfulNodes + supportAccountedMeaningfulNodes;

  return {
    meaningfulNodes: meaningfulNodeTotal,
    explainedMeaningfulNodes,
    supportAccountedMeaningfulNodes,
    accountedMeaningfulNodes,
    unexplainedMeaningfulNodes: unexplained.length,
    unaccountedMeaningfulNodes: unaccounted.length,
    coveragePercent:
      meaningfulNodeTotal === 0
        ? 100
        : Math.round((accountedMeaningfulNodes / meaningfulNodeTotal) * 10_000) / 100,
    classificationCounts,
    unexplained: cascadedUnexplained,
    unaccounted,
    suspiciousUnknowns,
  };
}

export function applyCoverageInvestigations(
  coverage: Omit<ContractCoverageReview, "investigations" | "remainingUnknownNodeIds">,
  investigations: readonly ContractCoverageInvestigation[],
): ContractCoverageReview {
  const classificationByNodeId = new Map(
    investigations.map((investigation) => [
      investigation.nodeId,
      investigation.classification,
    ]),
  );
  const investigatedNodeIds = new Set(investigations.map((item) => item.nodeId));
  const unexplained = coverage.unexplained.map((finding) => {
    const classification = classificationByNodeId.get(finding.nodeId);
    return classification === undefined || classification === finding.classification
      ? finding
      : {
          ...finding,
          classification,
          reason: `${finding.reason} Coverage investigation reclassified it as ${classification}.`,
        };
  });
  // Start from the cascade-filtered unaccounted set, NOT the full unexplained
  // list. The deterministic cascade already accounted for documentation files and
  // feature-surface helpers; rebuilding from `unexplained` would resurrect them
  // and make convergence impossible. Investigations can only shrink this set
  // further by accounting for additional nodes.
  const cascadeUnaccountedIds = new Set(coverage.unaccounted.map((f) => f.nodeId));
  const unaccounted = unexplained.filter(
    (finding) =>
      cascadeUnaccountedIds.has(finding.nodeId) &&
      !(
        investigatedNodeIds.has(finding.nodeId) &&
        isSupportAccountedFinding(finding, true)
      ),
  );
  const suspiciousUnknowns = unaccounted.filter(
    (finding) =>
      finding.classification === "unknown" || finding.reachability === "unknown",
  );
  const classificationCounts = emptyClassificationCounts();
  for (const finding of unexplained) classificationCounts[finding.classification] += 1;
  const supportAccountedMeaningfulNodes = unexplained.length - unaccounted.length;
  const accountedMeaningfulNodes =
    coverage.explainedMeaningfulNodes + supportAccountedMeaningfulNodes;
  return {
    ...coverage,
    supportAccountedMeaningfulNodes,
    accountedMeaningfulNodes,
    unaccountedMeaningfulNodes: unaccounted.length,
    coveragePercent:
      coverage.meaningfulNodes === 0
        ? 100
        : Math.round((accountedMeaningfulNodes / coverage.meaningfulNodes) * 10_000) / 100,
    classificationCounts,
    unexplained,
    unaccounted,
    suspiciousUnknowns,
    investigations: [...investigations],
    remainingUnknownNodeIds: investigations
      .filter((investigation) => investigation.classification === "unknown")
      .map((investigation) => investigation.nodeId),
  };
}

function selectMeaningfulNodes(graph: RepositoryGraph): MeaningfulNode[] {
  const representedSymbols = new Set(
    graph.entities.flatMap((entity) => "symbolId" in entity ? [entity.symbolId] : []),
  );
  const representedEntrypoints = new Set(
    graph.entities.flatMap((entity) => entity.type === "endpoint" ? [entity.entrypointId] : []),
  );
  const handlerSymbols = new Set(
    graph.entrypoints.flatMap((entrypoint) =>
      entrypoint.handlerSymbolId === undefined ? [] : [entrypoint.handlerSymbolId]
    ),
  );
  const meaningfulDegree = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.type === "CONTAINS" || edge.type === "IMPORTS") continue;
    meaningfulDegree.set(edge.source, (meaningfulDegree.get(edge.source) ?? 0) + 1);
    meaningfulDegree.set(edge.target, (meaningfulDegree.get(edge.target) ?? 0) + 1);
  }

  return [
    ...graph.files.filter(
      (node): node is SourceBearingFileNode =>
        node.lineRange !== undefined && isContractBearingFile(node.path),
    ),
    ...graph.entities,
    ...graph.entrypoints.filter((node) => !representedEntrypoints.has(node.id)),
    ...graph.symbols.filter(
      (node) =>
        !representedSymbols.has(node.id) &&
        (node.exported ||
          node.type === "class" ||
          handlerSymbols.has(node.id) ||
          (meaningfulDegree.get(node.id) ?? 0) >= 3),
    ),
  ].sort((left, right) => compareText(left.id, right.id));
}

function contractCoverage(
  graph: RepositoryGraph,
  draft: ContractDraft,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const add = (contractId: string, nodeIds: Iterable<string>): void => {
    for (const nodeId of expandContainedNodeIds(graph, nodeIds)) {
      const values = result.get(nodeId) ?? [];
      values.push(contractId);
      result.set(nodeId, values);
    }
  };
  for (const dossier of draft.featureDossiers) {
    add(`feature_dossier:${dossier.id}`, new Set([
      ...dossier.entrypoints,
      ...dossier.ui,
      ...dossier.handlers,
      ...dossier.services,
      ...dossier.schemas,
      ...dossier.stateTransitions,
      ...dossier.events,
      ...dossier.tests,
      ...dossier.config,
      ...dossier.documentation,
      ...dossier.evidenceNodeIds,
    ]));
  }
  for (const capability of draft.capabilities) {
    add(`capability:${capability.id}`, [
      ...capability.entrypointNodeIds,
      ...capability.evidenceNodeIds,
    ]);
  }
  for (const flow of draft.userFlows) {
    add(`user_flow:${flow.id}`, [
      ...flow.evidenceNodeIds,
      ...flow.steps.flatMap((step) => step.evidenceNodeIds),
    ]);
  }
  for (const requirement of draft.requirements) {
    add(`requirement:${requirement.id}`, requirement.evidenceNodeIds);
  }
  for (const uncertainty of draft.uncertainties) {
    add(`uncertainty:${uncertainty.id}`, uncertainty.evidenceNodeIds);
  }
  return result;
}

function expandContainedNodeIds(
  graph: RepositoryGraph,
  nodeIds: Iterable<string>,
): Set<string> {
  const result = new Set(nodeIds);
  const queue = [...result];
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index];
    if (source === undefined) continue;
    for (const edge of graph.edges) {
      if (edge.type !== "CONTAINS" || edge.source !== source || result.has(edge.target)) {
        continue;
      }
      result.add(edge.target);
      queue.push(edge.target);
    }
  }
  return result;
}

function equivalentNodeIds(graph: RepositoryGraph, node: MeaningfulNode): Set<string> {
  const result = new Set([node.id]);
  if (node.type === "endpoint") result.add(node.entrypointId);
  if ("symbolId" in node) result.add(node.symbolId);
  if (node.type === "entrypoint") {
    for (const entity of graph.entities) {
      if (entity.type === "endpoint" && entity.entrypointId === node.id) result.add(entity.id);
    }
    if (node.handlerSymbolId !== undefined) result.add(node.handlerSymbolId);
  }
  if (node.type === "function" || node.type === "class" || node.type === "variable") {
    for (const entity of graph.entities) {
      if ("symbolId" in entity && entity.symbolId === node.id) result.add(entity.id);
    }
    for (const containingSymbol of graph.symbols) {
      if (
        containingSymbol.id === node.id ||
        containingSymbol.fileId !== node.fileId ||
        !strictlyContains(containingSymbol.lineRange, node.lineRange)
      ) {
        continue;
      }
      result.add(containingSymbol.id);
      for (const entity of graph.entities) {
        if ("symbolId" in entity && entity.symbolId === containingSymbol.id) {
          result.add(entity.id);
        }
      }
    }
  }
  return result;
}

function strictlyContains(
  outer: { start: number; end: number },
  inner: { start: number; end: number },
): boolean {
  return (
    outer.start <= inner.start &&
    outer.end >= inner.end &&
    (outer.start < inner.start || outer.end > inner.end)
  );
}

function classifyNode(
  graph: RepositoryGraph,
  node: MeaningfulNode,
  filePath: string,
  reachability: FeatureReachability,
): CoverageClassification {
  if (GENERATED_PATH.test(filePath)) return "generated/vendor";
  if (node.type === "file" && DOCUMENTATION_PATH.test(filePath)) {
    return "documentation";
  }
  if (node.type === "file") return "configuration";
  if (node.type === "test" || isTestFilePath(filePath)) return "test";
  if (node.type === "config" || CONFIG_PATH.test(filePath)) return "configuration";
  if (reachability === "dead_or_unreferenced") return "unknown";
  if (node.type === "entrypoint") {
    return node.exposure === "startup" ? "infrastructure" : "feature";
  }
  if (
    node.type === "endpoint" ||
    node.type === "component" ||
    node.type === "screen" ||
    node.type === "schema" ||
    node.type === "event"
  ) {
    return "feature";
  }
  if (node.type === "class") return "feature";
  if (reachability === "reachable") return "feature";
  if (reachability === "internally_reachable") return "infrastructure";
  if (node.type === "function" || node.type === "variable") return "utility";
  return "unknown";
}

function coverageReason(
  node: MeaningfulNode,
  classification: CoverageClassification,
  reachability: FeatureReachability,
  explained: boolean,
): string {
  if (explained) return "A contract item references this node, a containing file, or a graph-equivalent source node.";
  return `Meaningful ${node.type} node is not referenced by any contract item; classified as ${classification} with ${reachability} reachability.`;
}

function isContractBearingFile(filePath: string): boolean {
  return (
    DOCUMENTATION_PATH.test(filePath) ||
    CONTRACT_DATA_PATH.test(filePath) ||
    CONTRACT_MANIFEST_PATH.test(filePath) ||
    CONFIG_PATH.test(filePath)
  );
}

function emptyClassificationCounts(): Record<CoverageClassification, number> {
  return {
    feature: 0,
    infrastructure: 0,
    utility: 0,
    test: 0,
    configuration: 0,
    documentation: 0,
    "dead/unreachable": 0,
    "generated/vendor": 0,
    unknown: 0,
  };
}

function isSupportAccountedFinding(
  finding: Pick<ContractCoverageFinding, "classification" | "reachability">,
  investigated: boolean,
): boolean {
  const { classification, reachability } = finding;
  if (investigated) {
    return (
      classification === "infrastructure" ||
      classification === "utility" ||
      classification === "test" ||
      classification === "configuration" ||
      classification === "dead/unreachable" ||
      classification === "generated/vendor"
    );
  }
  return (
    classification === "test" ||
    classification === "configuration" ||
    classification === "generated/vendor" ||
    ((classification === "infrastructure" || classification === "utility") &&
      reachability !== "unknown")
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
