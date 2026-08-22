import type { GraphNode, GraphNodeKind } from "@/lib/composer/model";

const TERMINAL_A2A_STATES = new Set([
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
]);

export function isTerminalEchoNode(node: GraphNode): boolean {
  return (
    node.kind === "echo" &&
    (node.echoKind ?? "a2a:status_update_event") === "a2a:status_update_event" &&
    TERMINAL_A2A_STATES.has(node.state ?? "TASK_STATE_COMPLETED")
  );
}

/** The trigger is the graph entry point — no node may transition back into it. */
export function isAllowedTransitionTarget(node: GraphNode | undefined): boolean {
  return node !== undefined && node.kind !== "trigger";
}

/** Node kinds that use a single on_exit (or on_message) transition in Agent Script. */
export function nodeUsesOnExitTransition(kind: GraphNodeKind): boolean {
  switch (kind) {
    case "trigger":
    case "generator":
    case "orchestrator":
    case "subagent":
    case "executor":
    case "echo":
      return true;
    case "router":
      return false;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Node-aware transition check. A terminal status echo (COMPLETED/FAILED/
 * CANCELED/REJECTED) ends its path and has no on_exit — so the editor and
 * next-node suggestions must hide the transition for it. Artifact echoes and
 * non-terminal status echoes are NOT terminal: the A2A linter requires them to
 * transition onward, so they keep the on_exit transition.
 */
export function nodeUsesOnExitTransitionFor(node: GraphNode): boolean {
  if (node.kind === "echo" && isTerminalEchoNode(node)) return false;
  return nodeUsesOnExitTransition(node.kind);
}

export function onExitTargetFieldLabel(kind: GraphNodeKind): string {
  switch (kind) {
    case "trigger":
      return "Initial node";
    case "generator":
    case "orchestrator":
    case "subagent":
    case "executor":
      return "On exit →";
    case "router":
    case "echo":
      return "On exit →";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function onExitTargetFieldHint(kind: GraphNodeKind): string {
  switch (kind) {
    case "trigger":
      return "First node after the A2A trigger (on_message transition). Required.";
    case "executor":
      return "Optional next node after the action completes.";
    case "echo":
      // This field only renders for artifact and non-terminal status echoes;
      // a terminal status echo ends its path and shows no transition at all.
      return "Required — artifact and non-terminal status events must transition to the next node.";
    case "generator":
    case "orchestrator":
    case "subagent":
      return "Next node when this step finishes (on_exit in the .agent file).";
    case "router":
      return "";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** Whether the transition dropdown should include a (none) option. */
export function onExitTargetOptional(kind: GraphNodeKind): boolean {
  return kind !== "trigger";
}
