/**
 * Canonical graph model for the agent network canvas.
 * Shape matches React Flow (same as MuleSoft Agent Visualizer): no adapter layer.
 * Pass graph.nodes / graph.edges directly to React Flow when we use it.
 *
 * JSON Schema: ./canonical-graph.schema.json
 */

export type NodeType = "BROKER" | "AGENT" | "MCP" | "LLM";

/** Design mode: dependency from Exchange API or parsed YAML */
export interface CanonicalDependency {
  assetId: string;
  version: string;
  name: string;
  type: string;
}

/** Design mode: connection ref from agent-network YAML */
export interface CanonicalConnectionRef {
  kind: string;
  name: string;
}

/** Node position (required for React Flow). Producers use default { x: 0, y: 0 }; layout can update. */
export interface CanonicalPosition {
  x: number;
  y: number;
}

export interface CanonicalNode {
  id: string;
  label: string;
  version: string;
  type: NodeType;
  organizationId: string;
  /** Required. Default from producers; layout can update for display. */
  position: CanonicalPosition;
  /** Runtime only: instance IDs from Visualizer prod_instances_map */
  instanceIds?: string[];
  /** Framework/ADK type for display (e.g. "Google ADK", "Langchain", "MuleSoft", "Agentforce", "Other") */
  frameworkType?: string;
  /** Exchange icon path (e.g. /exchange/files/api/v1/organizations/.../icon). Fetched via /api/exchange/icon and rendered on canvas. */
  icon?: string;
  /** Optional: Exchange assetId for link to catalog (e.g. maf-unite-the-hyperscalers) */
  exchangeAssetId?: string;
  /** Design: from Exchange API dependencies[] */
  exchangeDependencies?: CanonicalDependency[];
  /** Design: from YAML brokers key (e.g. invoiceDisputeBroker) – correlates to runtime */
  brokerRuntimeId?: string;
  /** Design: from YAML spec.llm.ref.name */
  llmRef?: string;
  /** Design: from YAML links[].agent.ref.name */
  agentRefs?: string[];
  /** Design: from YAML links or connections where kind is mcp */
  mcpRefs?: string[];
  /** Design: from YAML connections[] (kind + ref.name) */
  connectionRefs?: CanonicalConnectionRef[];
  /** Design: full agent-network YAML for this asset (e.g. show in UI when selected) */
  rawYaml?: string;
}

export interface CanonicalEdge {
  id: string;
  source: string;
  target: string;
  type?: "designTime" | "runTime";
  /** Highlighted path (e.g. LLM Proxy last request trace). */
  active?: boolean;
}

export type CanvasMode = "design" | "runtime";

export interface CanonicalGraph {
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
  mode: CanvasMode;
}
