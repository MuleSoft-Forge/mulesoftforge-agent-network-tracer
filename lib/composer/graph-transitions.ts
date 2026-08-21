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
      return "Required for artifact and non-terminal status events; optional after a terminal status event.";
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
