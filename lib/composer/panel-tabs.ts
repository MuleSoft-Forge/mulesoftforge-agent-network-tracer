export type PanelTab =
  | "identity"
  | "registry"
  | "assets"
  | "variables"
  | "a2a-card"
  | "access"
  | "llms"
  | "actions"
  | "behavior"
  | "graph";

interface TabGroup {
  title: string;
  hint: string;
  tabs: Array<{ id: PanelTab; label: string }>;
}

export const PANEL_TAB_GROUPS: TabGroup[] = [
  {
    title: "Agent network",
    hint: "",
    tabs: [
      { id: "identity", label: "Project" },
      { id: "registry", label: "Legacy Registry" },
      { id: "assets", label: "Exchange Assets" },
      { id: "variables", label: "Variables" },
    ],
  },
  {
    title: "Broker",
    hint: "",
    tabs: [
      { id: "access", label: "A2A Interface" },
      { id: "a2a-card", label: "A2A card" },
      { id: "behavior", label: "AS Instructions" },
      { id: "llms", label: "AS LLM" },
      { id: "actions", label: "AS Actions" },
      { id: "graph", label: "AS Graph" },
    ],
  },
];

const BROKER_TABS: PanelTab[] = ["access", "a2a-card", "behavior", "llms", "actions", "graph"];

export function isBrokerPanelTab(tab: PanelTab): boolean {
  return BROKER_TABS.includes(tab);
}

export function isGraphPanelTab(tab: PanelTab): boolean {
  return tab === "graph";
}
