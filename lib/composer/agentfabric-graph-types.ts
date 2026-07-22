import type { Edge, Node } from "@xyflow/react";

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
}

export type AgentFabricGraphNode = Node<AgentFabricGraphNodeData>;

export interface AgentFabricGraphEdgeData extends Record<string, unknown> {
  output?: string;
  predicate?: string;
}

export type AgentFabricGraphEdge = Edge<AgentFabricGraphEdgeData>;
