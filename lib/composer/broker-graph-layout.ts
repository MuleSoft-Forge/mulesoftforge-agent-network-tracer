import type { Broker } from "@/lib/composer/model";

/**
 * Fingerprint of node ids, kinds, and edges — excludes positions so manual drags
 * do not trigger a re-layout; connect/add/remove still does.
 */
export function brokerTopologyKey(broker: Broker): string {
  return broker.nodes
    .map((n) => {
      const targets: string[] = [];
      if (n.kind === "router") {
        for (const r of n.routes ?? []) targets.push(r.targetNodeId);
        if (n.otherwiseTargetNodeId) targets.push(n.otherwiseTargetNodeId);
      } else if (n.onExitTarget) {
        targets.push(n.onExitTarget);
      }
      targets.sort();
      return `${n.id}\0${n.kind}\0${targets.join(",")}`;
    })
    .sort()
    .join("\n");
}
