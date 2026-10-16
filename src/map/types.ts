import type {
  DeadCodeCandidate,
  DeadCodeVerdict,
  FeatureAuditKind,
  FeatureAuditStatus,
  FeatureSourceDisagreement,
} from "../audit/types.js";
import type { EntryPointKind } from "../graph/types.js";

export type BlockKind =
  | "feature"
  | "shared_subsystem"
  | "infrastructure"
  | "orphan";

export type PortKind =
  | EntryPointKind
  | "component"
  | "screen"
  | "schema"
  | "config"
  | "event"
  | "shared_module"
  | "dead_candidate";

export interface SourceEvidence {
  file: string;
  line: number;
}

export interface Port {
  id: string;
  kind: PortKind;
  label: string;
  nodeId: string | null;
  httpMethod?: string;
  route?: string;
  evidence: SourceEvidence;
}

export interface BlockSize {
  files: number;
  lines: number;
}

export interface RemovalImpact {
  /** Files whose active feature ownership drops to 0 when this block is removed. */
  freedFiles: string[];
  /** Total source lines across freedFiles. */
  freedLines: number;
  /** Exclusive graph node IDs that become unreachable when this block is removed. */
  freedNodeIds: string[];
  /** Shared subsystem or infrastructure block IDs whose remaining consumer count drops to 0. */
  orphanedBlockIds: string[];
  /** Shared subsystem block IDs whose remaining consumer count drops from 2 to 1. */
  degradedToSingleConsumerBlockIds: string[];
}

export interface Block {
  /** Stable deterministic block identity (reuses canonicalId for features). */
  id: string;
  /** Human/CLI readable alias (e.g. feature.id or subsystem slug). */
  slug: string;
  kind: BlockKind;
  title: string;
  featureKind?: FeatureAuditKind;
  status: FeatureAuditStatus | DeadCodeVerdict | "SHARED_ACTIVE" | "BASEPLATE_ACTIVE";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  studs: Port[];
  sockets: Port[];
  exclusiveNodeIds: string[];
  sharedNodeIds: string[];
  filePaths: string[];
  size: BlockSize;
  gaps: string[];
  documentationPromiseIds: string[];
  disagreementIds: string[];
  /** Underlying audit feature IDs consolidated into this capability block. */
  memberFeatureIds?: string[];
  deadCodeCandidates?: DeadCodeCandidate[];
  removalImpact: RemovalImpact | null;
}

export type ConnectionKind =
  | "rests_on"
  | "calls"
  | "http"
  | "event"
  | "shared_data";

export interface Connection {
  id: string;
  from: string;
  to: string;
  kind: ConnectionKind;
  confidence: "PROVEN" | "POSSIBLE";
  label: string;
  evidence: SourceEvidence[];
}

export interface FeatureMapSummary {
  totalBlocks: number;
  featureBlocks: number;
  sharedSubsystemBlocks: number;
  infrastructureBlocks: number;
  orphanBlocks: number;
  totalConnections: number;
  documentedNotImplementedBlocks: number;
}

export interface FeatureMap {
  schema: "feature-map/v1";
  repositoryCommit: string;
  summary: FeatureMapSummary;
  blocks: Block[];
  connections: Connection[];
  disagreements: FeatureSourceDisagreement[];
}
