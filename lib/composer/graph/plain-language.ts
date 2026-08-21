import type { GraphNodeKind } from "@/lib/composer/model";

export function outcomeLabelForKind(kind: GraphNodeKind): string {
  switch (kind) {
    case "trigger":
      return "Receive an incoming A2A message";
    case "generator":
      return "Generate one model response";
    case "orchestrator":
      return "Coordinate a multi-step reasoning flow";
    case "subagent":
      return "Run focused reasoning for one sub-task";
    case "executor":
      return "Execute deterministic actions";
    case "router":
      return "Branch by condition";
    case "echo":
      return "Return updates or final response";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

