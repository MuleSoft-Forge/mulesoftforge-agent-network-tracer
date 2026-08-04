import type { ValidationIssue, ValidationResult } from "@/lib/composer/validate";

/** Composer sidebar tab ids — kept in sync with ProjectPanels PanelTab. */
export type IssuePanelTab =
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

export interface RegistryYamlFocus {
  kind: "agents" | "mcps" | "llms";
  key: string;
  anchor?: string;
}

export interface IssueNavigation {
  tab: IssuePanelTab;
  focusId?: string;
  tabLabel: string;
  registry?: RegistryYamlFocus;
}

const TAB_LABELS: Record<IssuePanelTab, string> = {
  identity: "Project",
  registry: "Registry",
  assets: "Assets",
  variables: "Variables",
  access: "A2A Interface",
  "a2a-card": "A2A card",
  behavior: "AS Instructions",
  llms: "AS LLM",
  actions: "AS Actions",
  graph: "AS Graph",
};

/** Parse registry entity key (and optional card field) from agent-network.yaml schema paths. */
export function parseRegistryYamlPath(path: string): RegistryYamlFocus | null {
  const match = path.match(/^registry\.(agents|mcps|llms)\.([^.]+)/);
  if (!match) return null;

  const kind = match[1] as RegistryYamlFocus["kind"];
  const key = match[2];
  let anchor: string | undefined;

  if (path.includes(".protocolVersion") || path.endsWith(".protocolVersion")) {
    anchor = "registry-agent-card-protocol-version";
  } else if (path.includes(".card.url") || path.endsWith(".url")) {
    anchor = "registry-agent-card-url";
  } else if (path.includes(".interfaces.")) {
    anchor = "registry-agent-card";
  }

  return { kind, key, anchor };
}

export function panelTabFromYamlPath(path: string): IssuePanelTab {
  const normalized = path.replace(/^\//, "").replace(/\//g, ".");
  if (normalized.startsWith("registry.")) return "registry";
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
  let registry: RegistryYamlFocus | undefined;

  const yamlMatch = issue.message.match(/Schema \(agent-network\.yaml\) at ([^:]+):/);
  if (yamlMatch) {
    const yamlPath = yamlMatch[1];
    tab = panelTabFromYamlPath(yamlPath);
    const registryFocus = parseRegistryYamlPath(yamlPath);
    if (registryFocus) {
      if (issue.message.includes('"protocolVersion"')) {
        registryFocus.anchor = "registry-agent-card-protocol-version";
      } else if (issue.message.includes('"url"')) {
        registryFocus.anchor = "registry-agent-card-url";
      }
      registry = registryFocus;
      focusId = registryFocus.key;
    }
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
  } else if (/^Broker key "/.test(issue.message)) {
    tab = "a2a-card";
  } else if (target?.kind === "broker") {
    tab = "graph";
  } else if (target?.kind === "project") {
    tab = "identity";
  }

  return { tab, focusId, tabLabel: TAB_LABELS[tab], registry };
}

export interface TabIssueCounts {
  errors: number;
  warnings: number;
}

/**
 * Issue totals per sidebar tab, so a user can see which of the ten tabs need
 * attention without opening the validation dropdown and reading every entry.
 */
export function countIssuesByTab(result: ValidationResult): Map<IssuePanelTab, TabIssueCounts> {
  const counts = new Map<IssuePanelTab, TabIssueCounts>();
  const bump = (issue: ValidationIssue, key: keyof TabIssueCounts) => {
    const { tab } = resolveIssueNavigation(issue);
    const entry = counts.get(tab) ?? { errors: 0, warnings: 0 };
    entry[key] += 1;
    counts.set(tab, entry);
  };
  for (const issue of result.errors) bump(issue, "errors");
  for (const issue of result.warnings) bump(issue, "warnings");
  return counts;
}
