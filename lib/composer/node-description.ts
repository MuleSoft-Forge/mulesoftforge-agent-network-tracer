import type { GraphNode, GraphNodeKind } from "@/lib/composer/model";

/** Node kinds that require `description:` in Agent Script (dialect lint). */
export function nodeKindRequiresDescription(kind: GraphNodeKind): boolean {
  switch (kind) {
    case "generator":
    case "orchestrator":
    case "subagent":
    case "executor":
    case "router":
    case "echo":
      return true;
    case "trigger":
      return false;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function defaultNodeDescription(kind: GraphNodeKind, name: string): string {
  switch (kind) {
    case "generator":
    case "orchestrator":
    case "subagent":
    case "executor":
    case "router":
    case "echo":
      return `${kind} ${name}`;
    case "trigger":
      return "";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** Value emitted as `description:` — explicit field, then label, then default. */
export function resolvedNodeDescription(node: GraphNode): string {
  const trimmed = node.description?.trim();
  if (trimmed) return trimmed;
  const label = node.label?.trim();
  if (label) return label;
  return defaultNodeDescription(node.kind, node.name);
}
