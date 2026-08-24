import type {
  Edge,
  RepositoryGraph,
  RepositoryNode,
} from "../graph/types.js";
import { validateRepositoryGraph } from "../graph/validateRepositoryGraph.ts";
import type {
  GraphSearchLimits,
  GraphSearchMatchField,
  GraphSearchResult,
  GraphSearchSeed,
  SearchGraphOptions,
} from "./types.js";

const DEFAULT_LIMITS: GraphSearchLimits = {
  maxSeeds: 5,
  maxDepth: 2,
  maxNodes: 50,
  maxEdges: 100,
};

const MATCH_FIELD_ORDER: readonly GraphSearchMatchField[] = [
  "name",
  "path",
  "kind",
  "language",
  "id",
];

interface SearchField {
  field: GraphSearchMatchField;
  normalizedValue: string;
  priority: number;
}

interface RankedMatch extends GraphSearchSeed {
  node: RepositoryNode;
}

export function searchGraph(
  graph: RepositoryGraph,
  query: string,
  options: SearchGraphOptions = {},
): GraphSearchResult {
  if (typeof query !== "string" || normalizeSearchText(query).length === 0) {
    throw new Error("Graph search query must contain searchable text");
  }

  const limits = resolveLimits(options);
  validateRepositoryGraph(graph);

  const normalizedQuery = normalizeSearchText(query);
  const normalizedQueryTokens = normalizedQuery.split(" ");
  const nodes = allNodes(graph).sort(compareNodes);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const filePathsById = new Map(
    graph.files.map((file) => [file.id, file.path]),
  );
  const rankedMatches = nodes
    .map((node) =>
      rankNode(node, filePathsById, normalizedQuery, normalizedQueryTokens),
    )
    .filter((match): match is RankedMatch => match !== undefined)
    .sort(compareMatches);
  const seedCount = Math.min(
    rankedMatches.length,
    limits.maxSeeds,
    limits.maxNodes,
  );
  const selectedMatches = rankedMatches.slice(0, seedCount);
  const seeds = selectedMatches.map(({ node: _node, ...seed }) => seed);
  const adjacency = buildAdjacency(graph);
  const selectedDepths = new Map<string, number>();
  const queue: Array<{ nodeId: string; depth: number }> = [];

  for (const match of selectedMatches) {
    if (!selectedDepths.has(match.nodeId)) {
      selectedDepths.set(match.nodeId, 0);
      queue.push({ nodeId: match.nodeId, depth: 0 });
    }
  }

  let nodesTruncated = false;
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const current = queue[queueIndex];
    if (current === undefined) {
      continue;
    }

    const neighbors = adjacency.get(current.nodeId) ?? [];
    if (current.depth >= limits.maxDepth) {
      if (neighbors.some((neighborId) => !selectedDepths.has(neighborId))) {
        nodesTruncated = true;
      }
      continue;
    }

    for (const neighborId of neighbors) {
      if (selectedDepths.has(neighborId)) {
        continue;
      }

      if (selectedDepths.size >= limits.maxNodes) {
        nodesTruncated = true;
        continue;
      }

      selectedDepths.set(neighborId, current.depth + 1);
      queue.push({ nodeId: neighborId, depth: current.depth + 1 });
    }
  }

  const selectedNodes = [...selectedDepths.keys()].map((nodeId) => {
    const node = nodesById.get(nodeId);
    if (node === undefined) {
      throw new Error(`Graph traversal reached missing node ${JSON.stringify(nodeId)}`);
    }
    return node;
  });
  const inducedEdges = graph.edges
    .filter(
      (edge) =>
        selectedDepths.has(edge.source) && selectedDepths.has(edge.target),
    )
    .sort((left, right) => compareEdges(left, right, selectedDepths));
  const selectedEdges = inducedEdges.slice(0, limits.maxEdges);

  return {
    query: query.trim(),
    limits,
    seeds,
    nodes: selectedNodes,
    edges: selectedEdges,
    truncated: {
      seeds: rankedMatches.length > seedCount,
      nodes: nodesTruncated,
      edges: inducedEdges.length > selectedEdges.length,
    },
  };
}

function allNodes(graph: RepositoryGraph): RepositoryNode[] {
  return [
    ...graph.files,
    ...graph.symbols,
    ...graph.entrypoints,
    ...graph.entities,
  ];
}

function rankNode(
  node: RepositoryNode,
  filePathsById: ReadonlyMap<string, string>,
  normalizedQuery: string,
  queryTokens: readonly string[],
): RankedMatch | undefined {
  const fields = searchableFields(node, filePathsById);
  const matchedFields = MATCH_FIELD_ORDER.filter((field) =>
    fields.some(
      (candidate) =>
        candidate.field === field &&
        queryTokens.some((token) => candidate.normalizedValue.includes(token)),
    ),
  );
  let score = 0;

  for (const field of fields) {
    const fieldScore = scoreField(
      field,
      normalizedQuery,
      queryTokens,
    );
    score = Math.max(score, fieldScore);
  }

  if (
    score === 0 &&
    queryTokens.every((token) =>
      fields.some((field) => field.normalizedValue.includes(token)),
    )
  ) {
    score =
      500 +
      fields
        .filter((field) =>
          queryTokens.some((token) => field.normalizedValue.includes(token)),
        )
        .reduce((highest, field) => Math.max(highest, field.priority), 0);
  }

  if (score === 0) {
    return undefined;
  }

  return {
    node,
    nodeId: node.id,
    score,
    matchedFields,
  };
}

function searchableFields(
  node: RepositoryNode,
  filePathsById: ReadonlyMap<string, string>,
): SearchField[] {
  const fields: SearchField[] = [
    searchField("id", node.id, 5),
    searchField("kind", node.type, 10),
  ];

  if (node.type === "file") {
    fields.push(searchField("path", node.path, 50));
    fields.push(searchField("language", node.language, 15));
    return fields;
  }

  fields.push(searchField("name", node.name, 50));
  const filePath = filePathsById.get(node.fileId);
  if (filePath !== undefined) {
    fields.push(searchField("path", filePath, 20));
  }

  if (node.type === "entrypoint" || node.type === "endpoint") {
    fields.push(searchField("kind", node.kind, 25));
  }

  return fields;
}

function searchField(
  field: GraphSearchMatchField,
  value: string,
  priority: number,
): SearchField {
  return { field, normalizedValue: normalizeSearchText(value), priority };
}

function scoreField(
  field: SearchField,
  normalizedQuery: string,
  queryTokens: readonly string[],
): number {
  const value = field.normalizedValue;
  if (value === normalizedQuery) {
    return 1_000 + field.priority;
  }
  if (value.startsWith(`${normalizedQuery} `)) {
    return 850 + field.priority;
  }
  if (value.includes(normalizedQuery)) {
    return 750 + field.priority;
  }

  const valueTokens = value.split(" ");
  if (
    queryTokens.every((queryToken) =>
      valueTokens.some((valueToken) => valueToken.includes(queryToken)),
    )
  ) {
    return 650 + field.priority;
  }

  return 0;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildAdjacency(graph: RepositoryGraph): Map<string, string[]> {
  const adjacency = new Map<string, Map<string, number>>();

  for (const edge of graph.edges) {
    const priority = edgePriority(edge);
    addNeighbor(adjacency, edge.source, edge.target, priority);
    addNeighbor(adjacency, edge.target, edge.source, priority);
  }

  for (const entrypoint of graph.entrypoints) {
    if (entrypoint.handlerSymbolId !== undefined) {
      addNeighbor(adjacency, entrypoint.id, entrypoint.handlerSymbolId, 0);
      addNeighbor(adjacency, entrypoint.handlerSymbolId, entrypoint.id, 0);
    }
  }

  return new Map(
    [...adjacency.entries()].map(([nodeId, neighbors]) => [
      nodeId,
      [...neighbors.entries()]
        .sort(
          ([leftId, leftPriority], [rightId, rightPriority]) =>
            leftPriority - rightPriority || compareText(leftId, rightId),
        )
        .map(([neighborId]) => neighborId),
    ]),
  );
}

function addNeighbor(
  adjacency: Map<string, Map<string, number>>,
  source: string,
  target: string,
  priority: number,
): void {
  let neighbors = adjacency.get(source);
  if (neighbors === undefined) {
    neighbors = new Map<string, number>();
    adjacency.set(source, neighbors);
  }

  const existingPriority = neighbors.get(target);
  if (existingPriority === undefined || priority < existingPriority) {
    neighbors.set(target, priority);
  }
}

function edgePriority(edge: Edge): number {
  if (edge.type === "CALLS") {
    return 1;
  }
  if (edge.type === "IMPORTS") {
    return 2;
  }
  return 3;
}

function compareMatches(left: RankedMatch, right: RankedMatch): number {
  return right.score - left.score || compareText(left.nodeId, right.nodeId);
}

function compareNodes(left: RepositoryNode, right: RepositoryNode): number {
  return compareText(left.id, right.id);
}

function compareEdges(
  left: Edge,
  right: Edge,
  selectedDepths: ReadonlyMap<string, number>,
): number {
  const leftDepth = Math.max(
    selectedDepths.get(left.source) ?? Number.MAX_SAFE_INTEGER,
    selectedDepths.get(left.target) ?? Number.MAX_SAFE_INTEGER,
  );
  const rightDepth = Math.max(
    selectedDepths.get(right.source) ?? Number.MAX_SAFE_INTEGER,
    selectedDepths.get(right.target) ?? Number.MAX_SAFE_INTEGER,
  );

  return (
    leftDepth - rightDepth ||
    edgePriority(left) - edgePriority(right) ||
    compareText(left.source, right.source) ||
    compareText(left.target, right.target) ||
    compareText(left.type, right.type) ||
    compareText(left.evidence.file, right.evidence.file) ||
    (left.evidence.line ?? 0) - (right.evidence.line ?? 0) ||
    compareText(left.evidence.extractor, right.evidence.extractor)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function resolveLimits(options: SearchGraphOptions): GraphSearchLimits {
  return {
    maxSeeds: positiveIntegerOption(
      options.maxSeeds,
      DEFAULT_LIMITS.maxSeeds,
      "maxSeeds",
    ),
    maxDepth: nonNegativeIntegerOption(
      options.maxDepth,
      DEFAULT_LIMITS.maxDepth,
      "maxDepth",
    ),
    maxNodes: positiveIntegerOption(
      options.maxNodes,
      DEFAULT_LIMITS.maxNodes,
      "maxNodes",
    ),
    maxEdges: nonNegativeIntegerOption(
      options.maxEdges,
      DEFAULT_LIMITS.maxEdges,
      "maxEdges",
    ),
  };
}

function positiveIntegerOption(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return resolved;
}

function nonNegativeIntegerOption(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return resolved;
}
