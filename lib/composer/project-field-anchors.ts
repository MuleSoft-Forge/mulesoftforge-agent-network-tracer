/** DOM ids for Project (identity) panel fields — click-to-focus from completeness panel. */
export const PROJECT_ANCHOR = {
  name: "project-name",
  organizationId: "project-organization-id",
  assetId: "project-asset-id",
  version: "project-version",
  apiVersion: "project-api-version",
  descriptorVersion: "project-descriptor-version",
  description: "project-description",
  tags: "project-tags",
  yamlInfo: "project-yaml-info",
} as const;

export type ProjectFieldAnchor = (typeof PROJECT_ANCHOR)[keyof typeof PROJECT_ANCHOR];

/** Graph inspector anchors keyed from node field ids used by validation. */
export const GRAPH_ANCHOR = {
  name: "name",
  llm: "llm",
  prompt: "prompt",
  reasoning: "reasoning",
  message: "message",
  routes: "routes",
  otherwise: "otherwise",
  onExit: "onExit",
  actions: "actions",
  instructions: "instructions",
} as const;

export type GraphFieldAnchor = (typeof GRAPH_ANCHOR)[keyof typeof GRAPH_ANCHOR];

/** Sidebar tab + optional DOM anchor or entity id for click-to-focus. */
export type ProjectPanelTab =
  | "identity"
  | "registry"
  | "assets"
  | "variables"
  | "access"
  | "a2a-card"
  | "behavior"
  | "llms"
  | "actions"
  | "graph";

export interface ProjectFocusTarget {
  tab: ProjectPanelTab;
  anchor?: string;
  assetId?: string;
  nodeId?: string;
  registryKind?: "agents" | "mcps" | "llms";
  registryKey?: string;
}
