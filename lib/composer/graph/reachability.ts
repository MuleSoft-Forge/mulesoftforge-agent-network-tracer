import type { Broker, GraphNode } from "@/lib/composer/model";
import { isTerminalEchoNode } from "@/lib/composer/graph-transitions";

/** Transition targets from one graph node. */
export function transitionTargets(node: GraphNode): string[] {
  if (node.kind === "router") {
    return [
      ...(node.routes ?? []).map((route) => route.targetNodeId),
      ...(node.otherwiseTargetNodeId ? [node.otherwiseTargetNodeId] : []),
    ];
  }
  return node.onExitTarget ? [node.onExitTarget] : [];
}

/** Node ids reachable from the trigger via on_exit, routes, and otherwise. */
export function reachableNodeIds(broker: Broker): Set<string> {
  const trigger = broker.nodes.find((n) => n.kind === "trigger");
  const reached = new Set<string>();
  if (!trigger) return reached;
  const byId = new Map(broker.nodes.map((n) => [n.id, n]));
  const queue = [trigger.id];
  while (queue.length > 0) {
    const id = queue.pop() as string;
    if (reached.has(id)) continue;
    reached.add(id);
    const node = byId.get(id);
    if (!node) continue;
    for (const target of transitionTargets(node)) {
      if (byId.has(target) && !reached.has(target)) queue.push(target);
    }
  }
  return reached;
}

/** Every path from `startId` must terminate in a terminal status echo. */
export function everyPathReachesTerminalEcho(broker: Broker, startId: string): boolean {
  const byId = new Map(broker.nodes.map((node) => [node.id, node]));
  const memo = new Map<string, boolean>();
  function visit(id: string, visiting: Set<string>): boolean {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id);
    if (!node) return false;
    if (isTerminalEchoNode(node)) return true;
    if (visiting.has(id)) return false;
    const targets = transitionTargets(node);
    if (targets.length === 0) return false;
    const nextVisiting = new Set(visiting).add(id);
    const result = targets.every((target) => visit(target, nextVisiting));
    memo.set(id, result);
    return result;
  }
  return visit(startId, new Set());
}
