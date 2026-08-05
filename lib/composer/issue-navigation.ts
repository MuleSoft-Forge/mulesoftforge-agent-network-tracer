/**
 * Navigation helpers: turn a ValidationIssue's structured location into a
 * clickable target (tab + focus). All routing now reads issue.location — there
 * is no message-text matching here anymore.
 */

import type {
  IssueTab,
  RegistryYamlFocus,
  ValidationIssue,
} from "@/lib/composer/validation/issue";
import { yamlPathToLocation } from "@/lib/composer/validation/schema-location";
import { issuesByTab, type TabIssueCounts } from "@/lib/composer/validation/selectors";

/** Composer sidebar tab ids — alias of the shared IssueTab. */
export type IssuePanelTab = IssueTab;
export type { RegistryYamlFocus, TabIssueCounts };
export { issuesByTab as countIssuesByTab };

export interface IssueNavigation {
  tab: IssuePanelTab;
  focusId?: string;
  anchor?: string;
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

export function tabLabel(tab: IssuePanelTab): string {
  return TAB_LABELS[tab];
}

export function resolveIssueNavigation(issue: ValidationIssue): IssueNavigation {
  const loc = issue.location;
  const focusId = loc.nodeId ?? loc.assetId ?? loc.actionId ?? loc.registry?.key;
  return {
    tab: loc.tab,
    focusId,
    anchor: loc.fieldAnchor,
    tabLabel: TAB_LABELS[loc.tab],
    registry: loc.registry,
  };
}

/** Compatibility wrapper — schema-path routing now lives in schema-location. */
export function panelTabFromYamlPath(path: string): IssuePanelTab {
  return yamlPathToLocation(path, "").tab;
}
