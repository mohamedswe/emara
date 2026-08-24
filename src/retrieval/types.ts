import type { Edge, RepositoryNode } from "../graph/types.js";

export interface SearchGraphOptions {
  maxSeeds?: number;
  maxDepth?: number;
  maxNodes?: number;
  maxEdges?: number;
}

export interface GraphSearchLimits {
  maxSeeds: number;
  maxDepth: number;
  maxNodes: number;
  maxEdges: number;
}

export type GraphSearchMatchField =
  | "name"
  | "path"
  | "kind"
  | "language"
  | "id";

export interface GraphSearchSeed {
  nodeId: string;
  score: number;
  matchedFields: GraphSearchMatchField[];
}

export interface GraphSearchTruncation {
  seeds: boolean;
  nodes: boolean;
  edges: boolean;
}

export interface GraphSearchResult {
  query: string;
  limits: GraphSearchLimits;
  seeds: GraphSearchSeed[];
  nodes: RepositoryNode[];
  edges: Edge[];
  truncated: GraphSearchTruncation;
}

export interface GetSourceOptions {
  maxLines?: number;
  maxBytes?: number;
}

export interface SourceSliceLimits {
  maxLines: number;
  maxBytes: number;
}

export interface SourceSlice {
  nodeId: string;
  fileId: string;
  path: string;
  language: string;
  lineRange: {
    start: number;
    end: number;
  };
  content: string;
  lineCount: number;
  byteLength: number;
  contentHash: string;
  integrity: "verified";
  limits: SourceSliceLimits;
}
