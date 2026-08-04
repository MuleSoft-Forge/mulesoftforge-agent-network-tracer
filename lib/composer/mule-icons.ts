import type { AssetKind, GraphNodeKind } from "@/lib/composer/model";

/** Builder sidebar panel tab ids (mirrors {@link PanelTab} in ProjectPanels). */
export type BuilderPanelTab =
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

/** Static SVGs from MuleSoft ACB `mule-dx-api-component` / `mule-dx-mule-dev-component` media. */
export const MULE_ICON_BASE = "/icons/mule";

/** Named MuleSoft icons (file stems under {@link MULE_ICON_BASE}). */
export const MULE_ICONS = {
  trigger: "trigger-a-icon.svg",
  generator: "send-response-icon.svg",
  echo: "send-response-icon.svg",
  orchestrator: "agent-icon.svg",
  subagent: "agent-icon.svg",
  executor: "mcp-icon.svg",
  router: "switch-icon.svg",
  agent: "agent-icon.svg",
  mcp: "mcp-icon.svg",
  llm: "llm-icon.svg",
  a2a: "a2a-icon.svg",
  a2aDark: "a2a-icon-dark.svg",
  setVariable: "set-variable-icon.svg",
  exchange: "exchange-light.svg",
  exchangeDark: "exchange-dark.svg",
  genai: "genai_icon_light.svg",
  genaiDark: "genai_icon_dark.svg",
  graph: "graph_view_icon_light.svg",
  graphDark: "graph_view_icon_dark.svg",
  organize: "organize-nodes.svg",
  agentForce: "agent-force-light.svg",
  agentForceDark: "agent-force-dark.svg",
  agentNetwork: "agent-network-empty-canvas-light.svg",
  emptyCanvas: "empty_canvas_icon_dark.svg",
  mule: "mule.svg",
  sourceCode: "source-code-icon.svg",
  implement: "implement-icon-light.svg",
} as const;

export type MuleIconKey = keyof typeof MULE_ICONS;

const GRAPH_NODE_ICON: Record<GraphNodeKind, MuleIconKey> = {
  trigger: "trigger",
  generator: "generator",
  echo: "echo",
  orchestrator: "orchestrator",
  subagent: "subagent",
  executor: "executor",
  router: "router",
};

const ASSET_KIND_ICON: Record<AssetKind, MuleIconKey> = {
  agent: "agent",
  mcp: "mcp",
  llm: "llm",
};

const PANEL_TAB_ICON: Partial<Record<BuilderPanelTab, MuleIconKey>> = {
  identity: "mule",
  registry: "agentNetwork",
  assets: "exchange",
  variables: "setVariable",
  access: "a2a",
  "a2a-card": "a2a",
  behavior: "genai",
  llms: "llm",
  actions: "mcp",
  graph: "graph",
};

/** Exchange metadata / connection kind labels → icon. */
const CONNECTION_KIND_ICON: Record<string, MuleIconKey> = {
  agent: "agent",
  a2a: "a2a",
  mcp: "mcp",
  llm: "llm",
  broker: "agentNetwork",
};

export function muleIconPath(key: MuleIconKey): string {
  return `${MULE_ICON_BASE}/${MULE_ICONS[key]}`;
}

/** Icons that ship light + dark SVG variants in the MuleSoft media set. */
const DARK_ICON_ALTERNATES: Partial<Record<MuleIconKey, MuleIconKey>> = {
  exchange: "exchangeDark",
  graph: "graphDark",
  a2a: "a2aDark",
  genai: "genaiDark",
  agentForce: "agentForceDark",
};

export function muleIconPathWithTone(key: MuleIconKey, tone: "light" | "dark" = "light"): string {
  if (tone === "dark") {
    const darkKey = DARK_ICON_ALTERNATES[key];
    if (darkKey) return muleIconPath(darkKey);
  }
  return muleIconPath(key);
}

export function muleIconForGraphNodeKind(kind?: string): string | undefined {
  if (kind && kind in GRAPH_NODE_ICON) {
    return muleIconPath(GRAPH_NODE_ICON[kind as GraphNodeKind]);
  }
  return undefined;
}

export function muleIconForAssetKind(kind: AssetKind): string {
  return muleIconPath(ASSET_KIND_ICON[kind]);
}

export function muleIconForPanelTab(tab: BuilderPanelTab): string | undefined {
  const key = PANEL_TAB_ICON[tab];
  return key ? muleIconPath(key) : undefined;
}

export function muleIconForConnectionKind(kind: string): string {
  const key = CONNECTION_KIND_ICON[kind.toLowerCase()] ?? "mcp";
  return muleIconPath(key);
}

/** @deprecated Use {@link muleIconForGraphNodeKind} — kept for graph node imports. */
export function iconForKind(kind?: string): string | undefined {
  return muleIconForGraphNodeKind(kind);
}

/** @deprecated Use {@link muleIconPath} with {@link MULE_ICONS} keys. */
export const KIND_ICON = Object.fromEntries(
  (Object.keys(GRAPH_NODE_ICON) as GraphNodeKind[]).map((k) => [k, muleIconForGraphNodeKind(k)])
) as Record<GraphNodeKind, string>;

/** @deprecated Use {@link muleIconPath}. */
export const MULE_ASSET_ICONS = {
  a2a: muleIconPath("a2a"),
  agent: muleIconPath("agent"),
  llm: muleIconPath("llm"),
  mcp: muleIconPath("mcp"),
  setVariable: muleIconPath("setVariable"),
} as const;
