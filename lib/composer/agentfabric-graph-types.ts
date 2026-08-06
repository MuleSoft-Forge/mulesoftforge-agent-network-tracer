import type { Edge, Node } from "@xyflow/react";
import type { NodeSummaryChip } from "@/lib/composer/node-summary";

/** AgentFabric overview node kinds used by the official graph adapter. */
export type AgentFabricGraphNodeType = "af-trigger" | "af-router" | "af-node";

export interface AgentFabricGraphNodeData extends Record<string, unknown> {
  nodeType: AgentFabricGraphNodeType;
  label: string;
  subtitle?: string;
  blockType: string;
  kind?: string;
  /** Comma-separated router outputs (protocol bag). */
  outputs?: string;
  /** Set of handle IDs with connected edges (populated after layout). */
  connectedHandles?: ReadonlySet<string>;
  /** Terminal node — render inbound handles only (no outgoing transition exists). */
  terminal?: boolean;
  /** At-a-glance configuration chips (Builder canvas only). */
  summaryChips?: NodeSummaryChip[];
  /** One-line excerpt of the node's main instruction text. */
  preview?: string;
  /** Worst validation severity affecting this node. */
  issueSeverity?: NodeIssueSeverity;
  /** Tooltip listing the node's validation issues. */
  issueSummary?: string;
  /** Executor icon variant inferred from statements/actions. */
  executorIconKind?: "executor" | "mcp" | "a2a" | "setVariable";
  /** Per-handle drag-time compatibility hint when connecting wires. */
  handleCompatibility?: Partial<Record<string, ConnectionCompatibilityState>>;
}

export type NodeIssueSeverity = "error" | "warning";
export type ConnectionCompatibilityState = "compatible" | "incompatible";

export type AgentFabricGraphNode = Node<AgentFabricGraphNodeData>;

export interface AgentFabricGraphEdgeData extends Record<string, unknown> {
  output?: string;
  predicate?: string;
}

export type AgentFabricGraphEdge = Edge<AgentFabricGraphEdgeData>;
