/**
 * At-a-glance detail for graph node cards, so a canvas of eight generators is
 * readable without opening the inspector on each one.
 */

import type { Broker, GraphNode } from "@/lib/composer/model";

export interface NodeSummaryChip {
  /** Short text shown on the card. */
  label: string;
  /** Longer text for the native tooltip. */
  title: string;
}

const PREVIEW_MAX = 78;

function firstLine(text: string | undefined): string | undefined {
  const line = text
    ?.split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return undefined;
  return line.length > PREVIEW_MAX ? `${line.slice(0, PREVIEW_MAX - 1)}…` : line;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function llmChip(node: GraphNode, broker: Broker): NodeSummaryChip {
  const explicit = node.llmBindingName?.trim();
  if (explicit) return { label: explicit, title: `LLM binding: ${explicit}` };
  const fallback = broker.defaultLlmBindingName?.trim();
  if (fallback) return { label: `${fallback} (default)`, title: `Uses the broker default LLM: ${fallback}` };
  return { label: "no LLM", title: "No LLM binding and no broker default_llm" };
}

function actionCount(node: GraphNode): number {
  if (node.actionBindings?.length) return node.actionBindings.length;
  return node.actionRefs?.length ?? 0;
}

const ECHO_LABELS: Record<string, string> = {
  "a2a:status_update_event": "status",
  "a2a:artifact_update_event": "artifact",
  "a2a:response": "response",
};

export function nodeSummaryChips(node: GraphNode, broker: Broker): NodeSummaryChip[] {
  const chips: NodeSummaryChip[] = [];

  switch (node.kind) {
    case "trigger": {
      const iface = node.interfaceName || broker.interfaceName;
      if (iface) chips.push({ label: iface, title: `Inbound interface: ${iface}` });
      break;
    }
    case "generator": {
      chips.push(llmChip(node, broker));
      if (node.outputs?.length) {
        chips.push({
          label: plural(node.outputs.length, "output"),
          title: `Structured outputs: ${node.outputs.map((o) => o.name).join(", ")}`,
        });
      }
      break;
    }
    case "orchestrator":
    case "subagent": {
      chips.push(llmChip(node, broker));
      const actions = actionCount(node);
      if (actions > 0) {
        chips.push({ label: plural(actions, "action"), title: `${actions} bound action(s)` });
      } else {
        chips.push({ label: "no actions", title: "This agent has no bound actions" });
      }
      if (node.outputs?.length) {
        chips.push({
          label: plural(node.outputs.length, "output"),
          title: `Structured outputs: ${node.outputs.map((o) => o.name).join(", ")}`,
        });
      }
      if (node.maxNumberOfLoops !== undefined) {
        chips.push({
          label: `${node.maxNumberOfLoops} loops`,
          title: `max_number_of_loops: ${node.maxNumberOfLoops}`,
        });
      }
      break;
    }
    case "executor": {
      const steps = node.executorStatements?.length ?? 0;
      chips.push({ label: plural(steps, "step"), title: `${steps} statement(s) in the do: block` });
      break;
    }
    case "router": {
      const routes = node.routes?.length ?? 0;
      chips.push({ label: plural(routes, "route"), title: `${routes} conditional branch(es)` });
      chips.push(
        node.otherwiseTargetNodeId
          ? { label: "otherwise", title: "Has a fallback branch" }
          : { label: "no fallback", title: "No otherwise target — unmatched messages have nowhere to go" }
      );
      break;
    }
    case "echo": {
      const echoKind = node.echoKind ?? "a2a:status_update_event";
      chips.push({ label: ECHO_LABELS[echoKind] ?? echoKind, title: `Emits ${echoKind}` });
      if (echoKind === "a2a:status_update_event" && node.state) {
        chips.push({ label: node.state, title: `A2A task state: ${node.state}` });
      }
      break;
    }
    default: {
      const _exhaustive: never = node.kind;
      return _exhaustive;
    }
  }

  return chips;
}

/** One-line excerpt of the node's main instruction text. */
export function nodePreviewText(node: GraphNode): string | undefined {
  switch (node.kind) {
    case "generator":
      return firstLine(node.prompt);
    case "orchestrator":
    case "subagent":
      return firstLine(node.reasoningInstructions);
    case "echo":
      return firstLine(node.message ?? node.artifactExpr ?? node.taskExpr);
    case "executor":
      return firstLine(
        node.executorStatements?.map((s) => (s.kind === "run" ? s.actionName : s.variable)).join(", ")
      );
    case "router":
      return firstLine(node.routes?.[0]?.when);
    case "trigger":
      return firstLine(node.triggerTarget);
    default: {
      const _exhaustive: never = node.kind;
      return _exhaustive;
    }
  }
}
