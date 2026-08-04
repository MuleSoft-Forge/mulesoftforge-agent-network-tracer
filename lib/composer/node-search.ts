import type { Broker, GraphNode } from "@/lib/composer/model";

/**
 * Canvas search over node id, label, and kind. Returns ids in graph order so
 * cycling with Enter walks the graph predictably.
 */
export function matchNodeIds(broker: Broker | undefined, query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!broker || !q) return [];
  return broker.nodes.filter((n) => nodeHaystack(n).includes(q)).map((n) => n.id);
}

function nodeHaystack(node: GraphNode): string {
  return `${node.name} ${node.label ?? ""} ${node.kind}`.toLowerCase();
}
