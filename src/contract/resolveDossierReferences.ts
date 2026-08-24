import type {
  EvidenceGraphNode,
  RepositoryGraph,
  RepositoryNode,
} from "../graph/types.js";
import type { ContractDraft, ContractDraftFeatureDossier } from "./types.js";

type DossierNodeSection = Exclude<
  keyof ContractDraftFeatureDossier,
  | "id"
  | "title"
  | "stateTransitions"
  | "evidenceNodeIds"
  | "unresolvedQuestions"
  | "reachability"
>;

const DOSSIER_SECTIONS: readonly DossierNodeSection[] = [
  "entrypoints",
  "ui",
  "handlers",
  "services",
  "schemas",
  "events",
  "tests",
  "config",
  "documentation",
];

export function resolveDossierReferences(
  graph: RepositoryGraph,
  draft: ContractDraft,
): ContractDraft {
  const graphNodeIds = new Set([
    ...graph.files.map((node) => node.id),
    ...graph.symbols.map((node) => node.id),
    ...graph.entrypoints.map((node) => node.id),
    ...graph.entities.map((node) => node.id),
  ]);
  const featureDossiers = draft.featureDossiers.map((dossier) => {
    const resolved = { ...dossier };
    const unresolvedQuestions = [...dossier.unresolvedQuestions];
    for (const section of DOSSIER_SECTIONS) {
      resolved[section] = [...new Set(dossier[section].flatMap((reference) => {
        if (graphNodeIds.has(reference)) return [reference];
        const candidates = sectionCandidates(graph, section).filter((node) =>
          nodeLabels(node).includes(reference)
        );
        if (candidates.length > 0) {
          return candidates.map((candidate) => candidate.id);
        }
        unresolvedQuestions.push(
          `No graph node resolved ${section} reference ${JSON.stringify(reference)}.`,
        );
        return [];
      }))];
    }
    resolved.unresolvedQuestions = [...new Set(unresolvedQuestions)];
    return resolved;
  });
  const entrypointIds = new Set(graph.entrypoints.map((node) => node.id));
  const capabilities = draft.capabilities.map((capability) => ({
    ...capability,
    evidenceNodeIds: resolveSourceReferences(
      graph,
      graphNodeIds,
      capability.evidenceNodeIds,
    ),
    entrypointNodeIds: [...new Set(capability.entrypointNodeIds.flatMap(
      (reference) => {
        if (entrypointIds.has(reference)) return [reference];
        const exactEntrypoints = graph.entrypoints.filter((node) =>
          node.name === reference
        );
        if (exactEntrypoints.length > 0) {
          return exactEntrypoints.map((node) => node.id);
        }
        return graphNodeIds.has(reference) ? [] : [reference];
      },
    ))],
  }));
  return {
    ...draft,
    featureDossiers: featureDossiers.map((dossier) => ({
      ...dossier,
      evidenceNodeIds: resolveSourceReferences(
        graph,
        graphNodeIds,
        dossier.evidenceNodeIds,
      ),
    })),
    capabilities,
    userFlows: draft.userFlows.map((flow) => ({
      ...flow,
      evidenceNodeIds: resolveSourceReferences(
        graph,
        graphNodeIds,
        flow.evidenceNodeIds,
      ),
      steps: flow.steps.map((step) => ({
        ...step,
        evidenceNodeIds: resolveSourceReferences(
          graph,
          graphNodeIds,
          step.evidenceNodeIds,
        ),
      })),
    })),
    requirements: draft.requirements.map((requirement) => ({
      ...requirement,
      evidenceNodeIds: resolveSourceReferences(
        graph,
        graphNodeIds,
        requirement.evidenceNodeIds,
      ),
    })),
    uncertainties: draft.uncertainties.map((uncertainty) => ({
      ...uncertainty,
      evidenceNodeIds: resolveSourceReferences(
        graph,
        graphNodeIds,
        uncertainty.evidenceNodeIds,
      ),
    })),
  };
}

function resolveSourceReferences(
  graph: RepositoryGraph,
  graphNodeIds: ReadonlySet<string>,
  references: readonly string[],
): string[] {
  const sourceNodes = [
    ...graph.files.filter((node) => node.lineRange !== undefined),
    ...graph.symbols,
    ...graph.entrypoints,
    ...graph.entities,
  ];
  return [...new Set(references.flatMap((reference) => {
    if (graphNodeIds.has(reference)) return [reference];
    const exactLabel = reference.includes(":")
      ? reference.slice(reference.lastIndexOf(":") + 1)
      : reference;
    const referenceType = reference.includes(":")
      ? reference.slice(0, reference.indexOf(":"))
      : "";
    const scopedCandidates = sourceNodes.filter((node) => {
      if (node.type === "file" || !nodeLabels(node).includes(exactLabel)) {
        return false;
      }
      const file = graph.files.find((candidate) => candidate.id === node.fileId);
      return (
        file !== undefined &&
        sourceReferenceTypeMatches(referenceType, node.type) &&
        reference.includes(`:${file.path}:`)
      );
    });
    if (scopedCandidates.length === 1) return [scopedCandidates[0]!.id];
    const candidates = sourceNodes.filter((node) =>
      nodeLabels(node).includes(exactLabel)
    );
    return candidates.length === 1 ? [candidates[0]!.id] : [reference];
  }))];
}

function sourceReferenceTypeMatches(
  referenceType: string,
  nodeType: RepositoryNode["type"],
): boolean {
  if (referenceType === nodeType) return true;
  return (
    (referenceType === "component" && nodeType === "screen") ||
    (referenceType === "screen" && nodeType === "component")
  );
}

function sectionCandidates(
  graph: RepositoryGraph,
  section: DossierNodeSection,
): RepositoryNode[] {
  switch (section) {
    case "entrypoints":
      return graph.entrypoints;
    case "ui":
      return graph.entities.filter(
        (node) => node.type === "component" || node.type === "screen",
      );
    case "schemas":
      return entityCandidates(graph, "schema");
    case "events":
      return entityCandidates(graph, "event");
    case "tests":
      return entityCandidates(graph, "test");
    case "config":
      return entityCandidates(graph, "config");
    case "documentation":
      return graph.files;
    case "handlers":
    case "services":
      return graph.symbols;
  }
}

function entityCandidates(
  graph: RepositoryGraph,
  type: EvidenceGraphNode["type"],
): EvidenceGraphNode[] {
  return graph.entities.filter((node) => node.type === type);
}

function nodeLabels(node: RepositoryNode): string[] {
  if (node.type === "file") return [node.path];
  if (node.type === "function" || node.type === "class" || node.type === "variable") {
    const unqualified = node.name.split(".").at(-1);
    return unqualified === undefined ? [node.name] : [node.name, unqualified];
  }
  return [node.name];
}
