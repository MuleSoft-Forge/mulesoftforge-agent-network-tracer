import type { ValidationIssue } from "@/lib/composer/validate";

/** Composer sidebar tab ids — kept in sync with ProjectPanels PanelTab. */
export type IssuePanelTab =
  | "identity"
  | "assets"
  | "variables"
  | "access"
  | "a2a-card"
  | "behavior"
  | "llms"
  | "actions"
  | "graph";

export interface IssueNavigation {
  tab: IssuePanelTab;
  focusId?: string;
  tabLabel: string;
}

const TAB_LABELS: Record<IssuePanelTab, string> = {
  identity: "Project",
  assets: "Assets",
  variables: "Variables",
  access: "Access",
  "a2a-card": "A2A card",
  behavior: "AS Instructions",
  llms: "AS LLM",
  actions: "AS Actions",
  graph: "AS Graph",
};

export function panelTabFromYamlPath(path: string): IssuePanelTab {
  const normalized = path.replace(/^\//, "").replace(/\//g, ".");
  if (normalized.includes("interfaces.a2a.policies")) return "access";
  if (normalized.includes("interfaces.a2a.card")) return "a2a-card";
  if (normalized.startsWith("context.connections") || normalized.includes(".connections.")) return "assets";
  if (normalized.startsWith("info")) return "identity";
  if (normalized.startsWith("brokers")) return "a2a-card";
  return "identity";
}

export function resolveIssueNavigation(issue: ValidationIssue): IssueNavigation {
  const target = issue.target;
  let tab: IssuePanelTab = "identity";
  let focusId = target?.id;

  const yamlMatch = issue.message.match(/Schema \(agent-network\.yaml\) at ([^:]+):/);
  if (yamlMatch) {
    tab = panelTabFromYamlPath(yamlMatch[1]);
  } else if (issue.message.startsWith("Schema (A2A card)")) {
    tab = "a2a-card";
  } else if (/references unknown LLM binding/.test(issue.message) || issue.message.includes("no broker default_llm")) {
    tab = issue.message.includes("no broker default_llm") ? "graph" : "llms";
    if (tab === "graph") focusId = target?.id;
  } else if (/references unknown action/.test(issue.message)) {
    tab = "actions";
  } else if (/^LLM binding "/.test(issue.message) || issue.message.includes("default_llm")) {
    tab = "llms";
  } else if (/^Action "/.test(issue.message) || /^MCP action "/.test(issue.message)) {
    tab = "actions";
  } else if (target?.kind === "asset") {
    tab = "assets";
  } else if (target?.kind === "action") {
    tab = "actions";
  } else if (target?.kind === "node") {
    tab = "graph";
  } else if (target?.kind === "broker") {
    tab = "graph";
  } else if (target?.kind === "project") {
    tab = "identity";
  }

  return { tab, focusId, tabLabel: TAB_LABELS[tab] };
}
