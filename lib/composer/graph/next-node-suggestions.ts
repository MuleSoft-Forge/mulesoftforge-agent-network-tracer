import type { GraphNode, GraphNodeKind } from "@/lib/composer/model";
import { nodeUsesOnExitTransitionFor } from "@/lib/composer/graph-transitions";
import { REQUEST_MESSAGE_TEXT_EXPRESSION } from "@/lib/composer/agentfabric-expression-catalog";

export interface NextNodeSuggestion {
  kind: GraphNodeKind;
  reason: string;
  /** Follow-up guidance for the recommended step, shown under the reason. */
  detail?: string;
}

const SUGGESTIONS: NextNodeSuggestion[] = [
  { kind: "generator", reason: "Generate one response turn from the current context." },
  { kind: "orchestrator", reason: "Plan multiple steps and call several actions." },
  { kind: "subagent", reason: "Run a focused reasoning loop for one sub-problem." },
  { kind: "executor", reason: "Run deterministic actions or assign variables." },
  { kind: "router", reason: "Branch to different paths based on conditions." },
  { kind: "echo", reason: "Return a status or artifact update to the caller." },
];

/**
 * A trigger only carries the inbound request, so the first node has to read the
 * caller's message and turn it into something later nodes can branch on.
 */
const TRIGGER_SUGGESTIONS: NextNodeSuggestion[] = [
  {
    kind: "generator",
    reason: "Classify the caller's intent from the inbound message.",
    detail: `The prompt is seeded with ${REQUEST_MESSAGE_TEXT_EXPRESSION}. Declare structured outputs on it so a router can branch on a named field instead of parsing free text.`,
  },
  ...SUGGESTIONS.filter((item) => item.kind !== "generator" && item.kind !== "echo"),
];

export function nextNodeSuggestionsFor(node: GraphNode): NextNodeSuggestion[] {
  // Terminal echoes end their path; nodeUsesOnExitTransitionFor already returns
  // false for them, so no separate isTerminalEchoNode check is needed here.
  if (!nodeUsesOnExitTransitionFor(node)) return [];
  if (node.kind === "trigger") return TRIGGER_SUGGESTIONS;
  return SUGGESTIONS;
}
