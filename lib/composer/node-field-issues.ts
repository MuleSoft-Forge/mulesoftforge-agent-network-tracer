/**
 * Routes node-level validation issues down to the inspector field that causes
 * them, so problems appear where they are fixed rather than only in the header
 * validation dropdown.
 */

import type { ValidationIssue, ValidationResult } from "@/lib/composer/validate";

export type NodeField =
  | "llm"
  | "routes"
  | "otherwise"
  | "onExit"
  | "actions"
  | "instructions";

const FIELD_PATTERNS: Array<{ field: NodeField; pattern: RegExp }> = [
  { field: "otherwise", pattern: /needs an "otherwise" target/ },
  { field: "routes", pattern: /needs at least one route|route to an unknown node|route with an empty condition|multi-line condition/ },
  { field: "onExit", pattern: /transitions to an unknown node|must transition to an initial node|ignores on_exit/ },
  { field: "actions", pattern: /references unknown action/ },
  { field: "llm", pattern: /references unknown LLM binding|has no LLM and no broker default_llm/ },
];

function fieldForIssue(issue: ValidationIssue): NodeField | null {
  for (const { field, pattern } of FIELD_PATTERNS) {
    if (pattern.test(issue.message)) return field;
  }
  return null;
}

/** First message per field for one node. */
export function nodeFieldIssues(
  result: ValidationResult,
  nodeId: string
): Map<NodeField, string> {
  const byField = new Map<NodeField, string>();
  // Errors first so an error message wins over a warning on the same field.
  for (const issue of [...result.errors, ...result.warnings]) {
    if (issue.target?.kind !== "node" || issue.target.id !== nodeId) continue;
    const field = fieldForIssue(issue);
    if (field && !byField.has(field)) byField.set(field, issue.message);
  }
  return byField;
}
