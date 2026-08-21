import type { Broker } from "@/lib/composer/model";

/**
 * Node names become keys in the emitted .agent file and are referenced from
 * expressions as `@<kind>.<name>`, so they must be identifiers and unique
 * within that kind's namespace.
 */
export const NODE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

export function nodeNameValidationMessage(
  broker: Broker,
  nodeId: string,
  name: string
): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "Node id is required.";
  if (!NODE_NAME_PATTERN.test(trimmed)) {
    return "Start with a letter, then letters, digits, or underscores only (e.g. classifyIntent).";
  }
  const nodeKind = broker.nodes.find((node) => node.id === nodeId)?.kind;
  const clash = broker.nodes.some(
    (node) => node.id !== nodeId && node.kind === nodeKind && node.name === trimmed
  );
  if (clash) {
    return `Another ${nodeKind ?? "same-kind"} node is already named "${trimmed}".`;
  }
  return undefined;
}
