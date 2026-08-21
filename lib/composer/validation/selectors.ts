/**
 * Derived views over a ValidationResult. Because every issue carries an explicit
 * location, these selectors let each surface (tabs, strip, field rings, graph
 * dots) read the same set of issues without any message parsing — and their
 * counts reconcile by construction.
 */

import type {
  IssueSeverity,
  IssueTab,
  ValidationIssue,
  ValidationResult,
} from "@/lib/composer/validation/issue";
import { worstSeverity } from "@/lib/composer/validation/severity";

export interface TabIssueCounts {
  errors: number;
  warnings: number;
  info: number;
}

export function issuesByTab(result: ValidationResult): Map<IssueTab, TabIssueCounts> {
  const counts = new Map<IssueTab, TabIssueCounts>();
  const bump = (issue: ValidationIssue) => {
    const tab = issue.location.tab;
    const entry = counts.get(tab) ?? { errors: 0, warnings: 0, info: 0 };
    if (issue.severity === "error") entry.errors += 1;
    else if (issue.severity === "warning") entry.warnings += 1;
    else entry.info += 1;
    counts.set(tab, entry);
  };
  for (const issue of result.issues) bump(issue);
  return counts;
}

/** Backwards-compatible alias for the tab count selector. */
export const countIssuesByTab = issuesByTab;

export function worstSeverityByTab(result: ValidationResult): Map<IssueTab, IssueSeverity> {
  const byTab = new Map<IssueTab, IssueSeverity[]>();
  for (const issue of result.issues) {
    const list = byTab.get(issue.location.tab) ?? [];
    list.push(issue.severity);
    byTab.set(issue.location.tab, list);
  }
  const out = new Map<IssueTab, IssueSeverity>();
  for (const [tab, severities] of byTab) {
    const worst = worstSeverity(severities);
    if (worst) out.set(tab, worst);
  }
  return out;
}

/** Issues grouped by the field anchor they point at — drives rings + rail rows. */
export function issuesByAnchor(result: ValidationResult): Map<string, ValidationIssue[]> {
  const map = new Map<string, ValidationIssue[]>();
  for (const issue of result.issues) {
    const anchor = issue.location.fieldAnchor;
    if (!anchor) continue;
    const list = map.get(anchor) ?? [];
    list.push(issue);
    map.set(anchor, list);
  }
  return map;
}

export interface NodeIssueSummary {
  severity: IssueSeverity;
  messages: string[];
}

/** Worst-severity summary per graph node — drives canvas node dots. */
export function issuesByNode(result: ValidationResult): Map<string, NodeIssueSummary> {
  const byNode = new Map<string, NodeIssueSummary>();
  for (const issue of result.issues) {
    const nodeId = issue.location.nodeId;
    if (!nodeId) continue;
    if (issue.severity === "info") continue;
    const existing = byNode.get(nodeId);
    if (!existing) {
      byNode.set(nodeId, { severity: issue.severity, messages: [issue.message] });
      continue;
    }
    existing.messages.push(issue.message);
    if (issue.severity === "error") existing.severity = "error";
  }
  return byNode;
}

export function rollup(result: ValidationResult): TabIssueCounts {
  return {
    errors: result.errors.length,
    warnings: result.warnings.length,
    info: result.info.length,
  };
}
