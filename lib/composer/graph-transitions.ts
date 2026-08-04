import type { GraphNode, GraphNodeKind } from "@/lib/composer/model";

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
      return true;
    case "router":
    case "echo":
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
    case "generator":
    case "orchestrator":
    case "subagent":
      return "Next node when this step finishes (on_exit in the .agent file).";
    case "router":
    case "echo":
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
