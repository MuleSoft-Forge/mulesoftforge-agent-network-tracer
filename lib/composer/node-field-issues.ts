/**
 * Node-level field anchors + the lookup that routes node issues down to the
 * inspector field that causes them. Both the producer (validate.ts) and the
 * inspector reference NODE_FIELD, so routing is by structured anchor, never by
 * matching message text.
 */

import type { ValidationResult } from "@/lib/composer/validation/issue";

export const NODE_FIELD = {
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

export type NodeField = (typeof NODE_FIELD)[keyof typeof NODE_FIELD];

const NODE_FIELD_VALUES = new Set<string>(Object.values(NODE_FIELD));

/** First message per field for one node (errors win over warnings). */
export function nodeFieldIssues(result: ValidationResult, nodeId: string): Map<NodeField, string> {
  const byField = new Map<NodeField, string>();
  for (const issue of [...result.errors, ...result.warnings, ...result.info]) {
    if (issue.location.nodeId !== nodeId) continue;
    const anchor = issue.location.fieldAnchor;
    if (anchor && NODE_FIELD_VALUES.has(anchor) && !byField.has(anchor as NodeField)) {
      byField.set(anchor as NodeField, issue.message);
    }
  }
  return byField;
}
