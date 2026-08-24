import type {
  EdgeType,
  EntryPointKind,
  RepositoryGraph,
  RepositoryNode,
  SymbolKind,
} from "../graph/types.js";
import { validateRepositoryGraph } from "../graph/validateRepositoryGraph.ts";
import { getSource } from "../retrieval/getSource.ts";
import type { SourceSlice } from "../retrieval/types.js";
import { searchGraph } from "../retrieval/searchGraph.ts";
import {
  findPathsFromEntrypoints,
  findPathsToExternalBehavior,
  isReachable,
} from "../retrieval/reachability.ts";
import {
  findCallees,
  findCallers,
  findConsumers,
  findDefinition,
  findImporters,
  findReferences,
} from "../retrieval/symbolNavigation.ts";

export interface ContractToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
}

export type ContractToolResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export interface ContractDiscoveryTools {
  definitions: readonly ContractToolDefinition[];
  execute(name: string, argumentsValue: unknown): Promise<ContractToolResult>;
  inspectedNodeIds(): string[];
}

const MAX_GRAPH_NODES = 50;
const MAX_GRAPH_EDGES = 100;
const MAX_LIST_ITEMS = 100;
const MAX_SYMBOL_RESULTS = 50;
const MAX_NEIGHBORS = 100;
// React Native screens commonly place a full feature's handlers, state, and
// render tree in one component. Keep source retrieval bounded, but do not make
// those legitimate graph nodes impossible to inspect. This matches the
// existing file-wide ceiling and still prevents unbounded context growth.
const MAX_SOURCE_LINES = 2_000;
const MAX_SOURCE_BYTES = 1_048_576;
// Some route modules are intentionally monolithic. Brock-App's largest
// relevant code file is 2,762 lines, so permit those while still rejecting
// lockfiles and other very large whole-file context.
const MAX_FILE_SOURCE_LINES = 3_000;
const MAX_FILE_SOURCE_BYTES = 1_048_576;
const MAX_BATCH_SOURCE_IDS = 25;

const NULLABLE_INTEGER = { type: ["integer", "null"] } as const;
const NULLABLE_STRING = { type: ["string", "null"] } as const;

export const CONTRACT_DISCOVERY_TOOL_DEFINITIONS: readonly ContractToolDefinition[] = [
  {
    type: "function",
    name: "search_graph",
    description:
      "Find lexically relevant seed nodes and return a bounded evidence-bearing graph neighborhood.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxSeeds: NULLABLE_INTEGER,
        maxDepth: NULLABLE_INTEGER,
        maxNodes: NULLABLE_INTEGER,
        maxEdges: NULLABLE_INTEGER,
      },
      required: ["query", "maxSeeds", "maxDepth", "maxNodes", "maxEdges"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_node",
    description: "Return one exact graph node and its owning file when applicable.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_neighbors",
    description:
      "Return bounded incoming, outgoing, or bidirectional evidence-bearing edges for one graph node.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        direction: {
          type: "string",
          enum: ["incoming", "outgoing", "both"],
        },
        edgeTypes: {
          type: ["array", "null"],
          items: {
            type: "string",
            enum: [
              "CONTAINS",
              "IMPORTS",
              "CALLS",
              "REFERENCES",
              "HANDLED_BY",
              "VALIDATED_BY",
              "TESTED_BY",
              "RENDERS",
              "PUBLISHES",
              "SUBSCRIBES_TO",
              "CONFIGURED_BY",
            ],
          },
        },
        limit: NULLABLE_INTEGER,
      },
      required: ["id", "direction", "edgeTypes", "limit"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_source",
    description:
      "Return exact hash-verified source lines for a file, symbol, entrypoint, or evidence entity. Successful calls make that node eligible as contract evidence.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        maxLines: NULLABLE_INTEGER,
        maxBytes: NULLABLE_INTEGER,
      },
      required: ["id", "maxLines", "maxBytes"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "get_sources",
    description:
      "Return exact hash-verified source for up to 25 graph nodes in one call. Prefer this when several known IDs must be inspected together. Every returned node becomes eligible as contract evidence.",
    parameters: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: MAX_BATCH_SOURCE_IDS,
          uniqueItems: true,
        },
        maxLines: NULLABLE_INTEGER,
        maxBytes: NULLABLE_INTEGER,
      },
      required: ["ids", "maxLines", "maxBytes"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_endpoints",
    description: "List deterministic runtime entrypoints with bounded pagination.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: ["string", "null"],
          enum: [
            "http",
            "websocket",
            "cli",
            "event",
            "scheduled",
            "graphql",
            "application",
            "startup",
            null,
          ],
        },
        offset: NULLABLE_INTEGER,
        limit: NULLABLE_INTEGER,
      },
      required: ["kind", "offset", "limit"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "search_symbols",
    description:
      "Search function, class, and variable symbols by name, ID, type, and owning path.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        kind: {
          type: ["string", "null"],
          enum: ["function", "class", "variable", null],
        },
        exported: { type: ["boolean", "null"] },
        limit: NULLABLE_INTEGER,
      },
      required: ["query", "kind", "exported", "limit"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_files",
    description:
      "List indexed files by optional path query and language with bounded pagination.",
    parameters: {
      type: "object",
      properties: {
        query: NULLABLE_STRING,
        language: NULLABLE_STRING,
        offset: NULLABLE_INTEGER,
        limit: NULLABLE_INTEGER,
      },
      required: ["query", "language", "offset", "limit"],
      additionalProperties: false,
    },
    strict: true,
  },
  ...symbolNavigationToolDefinitions(),
  ...reachabilityToolDefinitions(),
];

export function createContractDiscoveryTools(
  graph: RepositoryGraph,
  repositoryPath: string,
): ContractDiscoveryTools {
  validateRepositoryGraph(graph);
  if (repositoryPath.length === 0) {
    throw new Error("Repository path must not be empty");
  }

  const nodes = [
    ...graph.files,
    ...graph.symbols,
    ...graph.entrypoints,
    ...graph.entities,
  ].sort((left, right) => compareText(left.id, right.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const filesById = new Map(graph.files.map((file) => [file.id, file]));
  const inspected = new Set<string>();

  const loadSource = async (
    id: string,
    args: Record<string, unknown>,
  ): Promise<SourceSlice> => {
    const sourceNode = nodesById.get(id);
    const fileWide = sourceNode?.type === "file";
    const maxLines = boundedNullableInteger(
      args,
      "maxLines",
      fileWide ? MAX_FILE_SOURCE_LINES : MAX_SOURCE_LINES,
      fileWide ? MAX_FILE_SOURCE_LINES : MAX_SOURCE_LINES,
      1,
    );
    const maxBytes = boundedNullableInteger(
      args,
      "maxBytes",
      fileWide ? MAX_FILE_SOURCE_BYTES : MAX_SOURCE_BYTES,
      fileWide ? MAX_FILE_SOURCE_BYTES : MAX_SOURCE_BYTES,
      1,
    );
    const value = await getSource(graph, repositoryPath, id, {
      maxLines,
      maxBytes,
    });
    inspected.add(id);
    return value;
  };

  return {
    definitions: CONTRACT_DISCOVERY_TOOL_DEFINITIONS,
    async execute(name, argumentsValue) {
      try {
        const args = recordArguments(argumentsValue);
        switch (name) {
          case "search_graph":
            return {
              ok: true,
              value: searchGraph(graph, requiredString(args, "query"), {
                maxSeeds: boundedNullableInteger(args, "maxSeeds", 5, 10, 1),
                maxDepth: boundedNullableInteger(args, "maxDepth", 2, 4, 0),
                maxNodes: boundedNullableInteger(
                  args,
                  "maxNodes",
                  30,
                  MAX_GRAPH_NODES,
                  1,
                ),
                maxEdges: boundedNullableInteger(
                  args,
                  "maxEdges",
                  60,
                  MAX_GRAPH_EDGES,
                  0,
                ),
              }),
            };
          case "get_node":
            return {
              ok: true,
              value: getNode(requiredString(args, "id"), nodesById, filesById),
            };
          case "get_neighbors":
            return {
              ok: true,
              value: getNeighbors(graph, nodesById, args),
            };
          case "get_source": {
            const id = requiredString(args, "id");
            return { ok: true, value: await loadSource(id, args) };
          }
          case "get_sources": {
            const ids = requiredUniqueStringArray(
              args,
              "ids",
              MAX_BATCH_SOURCE_IDS,
            );
            const sources: SourceSlice[] = [];
            for (const id of ids) sources.push(await loadSource(id, args));
            return { ok: true, value: { sources } };
          }
          case "list_endpoints":
            return { ok: true, value: listEndpoints(graph, args) };
          case "search_symbols":
            return { ok: true, value: searchSymbols(graph, filesById, args) };
          case "list_files":
            return { ok: true, value: listFiles(graph, args) };
          case "find_definition":
            return {
              ok: true,
              value: findDefinition(graph, requiredString(args, "symbol")),
            };
          case "find_references":
            return {
              ok: true,
              value: findReferences(graph, requiredString(args, "symbol")),
            };
          case "find_callers":
            return {
              ok: true,
              value: findCallers(graph, requiredString(args, "symbol")),
            };
          case "find_callees":
            return {
              ok: true,
              value: findCallees(graph, requiredString(args, "symbol")),
            };
          case "find_importers":
            return {
              ok: true,
              value: findImporters(graph, requiredString(args, "symbol")),
            };
          case "find_consumers":
            return {
              ok: true,
              value: findConsumers(graph, requiredString(args, "symbol")),
            };
          case "is_reachable":
            return {
              ok: true,
              value: isReachable(
                graph,
                requiredString(args, "id"),
                reachabilityOptions(args),
              ),
            };
          case "find_paths_from_entrypoints":
            return {
              ok: true,
              value: findPathsFromEntrypoints(
                graph,
                requiredString(args, "id"),
                reachabilityOptions(args),
              ),
            };
          case "find_paths_to_external_behavior":
            return {
              ok: true,
              value: findPathsToExternalBehavior(
                graph,
                requiredString(args, "id"),
                reachabilityOptions(args),
              ),
            };
          default:
            return { ok: false, error: `Unknown contract discovery tool: ${name}` };
        }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    inspectedNodeIds() {
      return [...inspected].sort(compareText);
    },
  };
}

function getNode(
  id: string,
  nodesById: ReadonlyMap<string, RepositoryNode>,
  filesById: ReadonlyMap<string, RepositoryGraph["files"][number]>,
): unknown {
  const node = nodesById.get(id);
  if (node === undefined) {
    throw new Error(`Graph node not found: ${JSON.stringify(id)}`);
  }
  const ownerFile = node.type === "file" ? node : filesById.get(node.fileId);
  return { node, ownerFile: ownerFile ?? null };
}

function getNeighbors(
  graph: RepositoryGraph,
  nodesById: ReadonlyMap<string, RepositoryNode>,
  args: Record<string, unknown>,
): unknown {
  const id = requiredString(args, "id");
  if (!nodesById.has(id)) {
    throw new Error(`Graph node not found: ${JSON.stringify(id)}`);
  }
  const direction = requiredEnum(
    args,
    "direction",
    new Set(["incoming", "outgoing", "both"]),
  );
  const edgeTypes = nullableEdgeTypes(args.edgeTypes);
  const limit = boundedNullableInteger(
    args,
    "limit",
    30,
    MAX_NEIGHBORS,
    1,
  );
  const candidates = graph.edges
    .flatMap((edge) => {
      const items: Array<{
        direction: "incoming" | "outgoing";
        edge: typeof edge;
        node: RepositoryNode;
      }> = [];
      if (
        (direction === "outgoing" || direction === "both") &&
        edge.source === id &&
        (edgeTypes === null || edgeTypes.has(edge.type))
      ) {
        const node = nodesById.get(edge.target);
        if (node !== undefined) items.push({ direction: "outgoing", edge, node });
      }
      if (
        (direction === "incoming" || direction === "both") &&
        edge.target === id &&
        (edgeTypes === null || edgeTypes.has(edge.type))
      ) {
        const node = nodesById.get(edge.source);
        if (node !== undefined) items.push({ direction: "incoming", edge, node });
      }
      return items;
    })
    .sort(
      (left, right) =>
        compareText(left.edge.type, right.edge.type) ||
        compareText(left.direction, right.direction) ||
        compareText(left.node.id, right.node.id) ||
        compareText(left.edge.evidence.file, right.edge.evidence.file) ||
        (left.edge.evidence.line ?? 0) - (right.edge.evidence.line ?? 0),
    );

  return {
    nodeId: id,
    neighbors: candidates.slice(0, limit),
    total: candidates.length,
    truncated: candidates.length > limit,
  };
}

function listEndpoints(
  graph: RepositoryGraph,
  args: Record<string, unknown>,
): unknown {
  const rawKind = nullableString(args, "kind");
  const kind = rawKind as EntryPointKind | null;
  if (
    kind !== null &&
    !new Set<EntryPointKind>([
      "http",
      "websocket",
      "cli",
      "event",
      "scheduled",
      "graphql",
      "application",
      "startup",
    ]).has(kind)
  ) {
    throw new Error(`Invalid entrypoint kind: ${JSON.stringify(kind)}`);
  }
  const offset = boundedNullableInteger(args, "offset", 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = boundedNullableInteger(args, "limit", 50, MAX_LIST_ITEMS, 1);
  const matches = graph.entrypoints.filter(
    (entrypoint) => kind === null || entrypoint.kind === kind,
  );
  return page(matches, offset, limit);
}

function searchSymbols(
  graph: RepositoryGraph,
  filesById: ReadonlyMap<string, RepositoryGraph["files"][number]>,
  args: Record<string, unknown>,
): unknown {
  const query = normalizeSearchText(requiredString(args, "query"));
  if (query.length === 0) {
    throw new Error("Symbol query must contain searchable text");
  }
  const rawKind = nullableString(args, "kind");
  const kind = rawKind as SymbolKind | null;
  if (
    kind !== null &&
    kind !== "function" &&
    kind !== "class" &&
    kind !== "variable"
  ) {
    throw new Error(`Invalid symbol kind: ${JSON.stringify(kind)}`);
  }
  const exported = nullableBoolean(args, "exported");
  const limit = boundedNullableInteger(
    args,
    "limit",
    20,
    MAX_SYMBOL_RESULTS,
    1,
  );
  const matches = graph.symbols
    .filter(
      (symbol) =>
        (kind === null || symbol.type === kind) &&
        (exported === null || symbol.exported === exported),
    )
    .map((symbol) => {
      const file = filesById.get(symbol.fileId);
      const score = symbolScore(symbol, file?.path ?? "", query);
      return { symbol, ownerFile: file ?? null, score };
    })
    .filter((match) => match.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || compareText(left.symbol.id, right.symbol.id),
    );
  return {
    query: requiredString(args, "query").trim(),
    matches: matches.slice(0, limit),
    total: matches.length,
    truncated: matches.length > limit,
  };
}

function listFiles(graph: RepositoryGraph, args: Record<string, unknown>): unknown {
  const query = nullableString(args, "query");
  const language = nullableString(args, "language");
  const offset = boundedNullableInteger(args, "offset", 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = boundedNullableInteger(args, "limit", 50, MAX_LIST_ITEMS, 1);
  const normalizedQuery = query === null ? null : normalizeSearchText(query);
  const matches = graph.files.filter(
    (file) =>
      (normalizedQuery === null ||
        normalizeSearchText(file.path).includes(normalizedQuery)) &&
      (language === null || file.language === language),
  );
  return page(matches, offset, limit);
}

function page<T>(items: readonly T[], offset: number, limit: number): unknown {
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  return {
    items: pageItems,
    total: items.length,
    offset,
    limit,
    nextOffset: nextOffset < items.length ? nextOffset : null,
  };
}

function symbolScore(
  symbol: RepositoryGraph["symbols"][number],
  path: string,
  query: string,
): number {
  const name = normalizeSearchText(symbol.name);
  const id = normalizeSearchText(symbol.id);
  const normalizedPath = normalizeSearchText(path);
  const searchable = `${name} ${symbol.type} ${normalizedPath} ${id}`;
  const tokens = query.split(" ");
  if (!tokens.every((token) => searchable.includes(token))) return 0;
  if (name === query) return 1_000;
  if (name.includes(query)) return 800;
  if (normalizedPath.includes(query)) return 600;
  if (id.includes(query)) return 500;
  return 400;
}

function nullableEdgeTypes(value: unknown): ReadonlySet<EdgeType> | null {
  if (value === null) return null;
  if (!Array.isArray(value)) {
    throw new Error("edgeTypes must be an array or null");
  }
  const allowed = new Set<EdgeType>([
    "CONTAINS",
    "IMPORTS",
    "CALLS",
    "REFERENCES",
    "HANDLED_BY",
    "VALIDATED_BY",
    "TESTED_BY",
    "RENDERS",
    "PUBLISHES",
    "SUBSCRIBES_TO",
    "CONFIGURED_BY",
  ]);
  const result = new Set<EdgeType>();
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item as EdgeType)) {
      throw new Error(`Invalid edge type: ${JSON.stringify(item)}`);
    }
    result.add(item as EdgeType);
  }
  return result;
}

function recordArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Tool arguments must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requiredUniqueStringArray(
  record: Record<string, unknown>,
  field: string,
  maximum: number,
): string[] {
  const value = record[field];
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw new Error(
      `${field} must contain between 1 and ${maximum} unique non-empty strings`,
    );
  }
  if (value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${field} must contain only non-empty strings`);
  }
  const result = value as string[];
  if (new Set(result).size !== result.length) {
    throw new Error(`${field} must not contain duplicate strings`);
  }
  return result;
}

function nullableString(
  record: Record<string, unknown>,
  field: string,
): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string or null`);
  }
  return value;
}

function nullableBoolean(
  record: Record<string, unknown>,
  field: string,
): boolean | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean or null`);
  }
  return value;
}

function requiredEnum(
  record: Record<string, unknown>,
  field: string,
  allowed: ReadonlySet<string>,
): string {
  const value = requiredString(record, field);
  if (!allowed.has(value)) {
    throw new Error(`Invalid ${field}: ${JSON.stringify(value)}`);
  }
  return value;
}

function boundedNullableInteger(
  record: Record<string, unknown>,
  field: string,
  fallback: number,
  maximum: number,
  minimum: number,
): number {
  const value = record[field];
  if (value === null) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${field} must be an integer greater than or equal to ${minimum}, or null`);
  }
  return Math.min(value as number, maximum);
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function symbolNavigationToolDefinitions(): ContractToolDefinition[] {
  const descriptions: Readonly<Record<string, string>> = {
    find_definition: "Find exact symbol definitions; return all candidates instead of guessing when ambiguous.",
    find_references: "Find deterministic call, import, and entrypoint references to a symbol.",
    find_callers: "Find resolved callers of a function or method.",
    find_callees: "Find resolved callees of a function or method.",
    find_importers: "Find files with an exact resolved import of a symbol.",
    find_consumers: "Find deterministic import, call, and entrypoint consumers of a symbol.",
  };

  return Object.entries(descriptions).map(([name, description]) => ({
    type: "function",
    name,
    description,
    parameters: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
      additionalProperties: false,
    },
    strict: true,
  }));
}

function reachabilityToolDefinitions(): ContractToolDefinition[] {
  const descriptions: Readonly<Record<string, string>> = {
    is_reachable: "Classify one graph node as externally reachable, internally reachable, test-only, dead or unreferenced, or unknown, with evidence paths.",
    find_paths_from_entrypoints: "Find bounded directed evidence paths from external endpoints to one graph node.",
    find_paths_to_external_behavior: "Find bounded directed paths from one graph node to an endpoint or published event.",
  };
  return Object.entries(descriptions).map(([name, description]) => ({
    type: "function",
    name,
    description,
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        maxDepth: NULLABLE_INTEGER,
        maxPaths: NULLABLE_INTEGER,
      },
      required: ["id", "maxDepth", "maxPaths"],
      additionalProperties: false,
    },
    strict: true,
  }));
}

function reachabilityOptions(args: Record<string, unknown>): {
  maxDepth: number;
  maxPaths: number;
} {
  return {
    maxDepth: boundedNullableInteger(args, "maxDepth", 20, 50, 1),
    maxPaths: boundedNullableInteger(args, "maxPaths", 20, 100, 1),
  };
}
