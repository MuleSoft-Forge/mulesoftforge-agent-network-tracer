import type { Edge, Node } from "@xyflow/react";
import type { RouterCanvasOutput } from "@/lib/composer/agentfabric-graph";
import type { GraphAdviceTier } from "@/lib/composer/graph/graph-advice";
import type { GraphNodeKind } from "@/lib/composer/model";
import type { NodeSummaryChip } from "@/lib/composer/node-summary";

/** AgentFabric overview node kinds used by the official graph adapter. */
export type AgentFabricGraphNodeType = "af-trigger" | "af-router" | "af-node";

/** One coaching entry attached to a node, mirroring a {@link GraphAdvice} row. */
export interface NodeCoachItem {
  id: string;
  tier: GraphAdviceTier;
  title: string;
  why: string;
  nodeId?: string;
  anchor?: string;
}

/** A candidate successor offered by the coach, with the reasoning behind it. */
export interface NextStepSuggestion {
  kind: GraphNodeKind;
  reason: string;
  detail?: string;
}

/** Which coaching popup a node currently has open, if any. */
export type NodeCoachPanel = "node" | "next";

/**
 * Coaching state for one node card. Both popups stay closed until the user
 * presses a footer button, so the canvas is clear by default.
 */
export interface NodeCoachData {
  nodeName: string;
  /** Plain-language outcome for the node kind. */
  outcome: string;
  items: NodeCoachItem[];
  /** Empty when nothing can follow this node, which hides the next-step button. */
  nextSteps: NextStepSuggestion[];
  openPanel: NodeCoachPanel | null;
  /** Side the popup opens on, flipped when the node is near the canvas edge. */
  openSide: "left" | "right";
  onOpen: (panel: NodeCoachPanel) => void;
  onClose: () => void;
  onFocusItem: (item: NodeCoachItem) => void;
  onAddNext: (kind: GraphNodeKind) => void;
}

export interface AgentFabricGraphNodeData extends Record<string, unknown> {
  nodeType: AgentFabricGraphNodeType;
  label: string;
  subtitle?: string;
  blockType: string;
  kind?: string;
  /** Comma-separated router outputs (protocol bag, label-only). */
  outputs?: string;
  /** Router outputs with route-id handles — preferred over `outputs` when set. */
  routerOutputs?: RouterCanvasOutput[];
  /** Set of handle IDs with connected edges (populated after layout). */
  connectedHandles?: ReadonlySet<string>;
  /** Terminal node — render inbound handles only (no outgoing transition exists). */
  terminal?: boolean;
  /** At-a-glance configuration chips (Builder canvas only). */
  summaryChips?: NodeSummaryChip[];
  /** Optional click target for opening Graph Coach context. */
  onOpenCoach?: () => void;
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
  /** Coaching footer and popups for this card (builder canvas only). */
  coach?: NodeCoachData;
}

export type NodeIssueSeverity = "error" | "warning";
export type ConnectionCompatibilityState = "compatible" | "incompatible";

export type AgentFabricGraphNode = Node<AgentFabricGraphNodeData>;

export interface AgentFabricGraphEdgeData extends Record<string, unknown> {
  output?: string;
  predicate?: string;
}

export type AgentFabricGraphEdge = Edge<AgentFabricGraphEdgeData>;
