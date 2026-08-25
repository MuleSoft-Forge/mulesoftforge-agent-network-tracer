import type { NodeVisit } from "@/lib/task-timeline/build-v2-node-timeline";

/**
 * Execution overlay for the task graph view.
 *
 * The graph's *structure* comes from the network's published AgentScript source,
 * so the diagram matches what the designer shows rather than a shape inferred
 * from logs. This module supplies the other half: which of those nodes this
 * particular invocation actually entered, in what order, and which transitions
 * it took. Keeping the two separate means the picture is always the real graph,
 * and execution is a layer on top that can legitimately be empty.
 */

/** What execution did at one node. */
export interface NodeExecution {
  /** 1-based position at which execution first reached this node. */
  order: number;
  /** Visits to this node; >1 means the graph looped back through it. */
  visitCount: number;
  /** Total time across every visit to this node. */
  durationMs: number;
  /** First visit, so the detail pane can show reasoning, tools and state. */
  visit: NodeVisit;
  /** Execution stopped here — on a failed task this is what the user wants. */
  isFinal: boolean;
}

export interface ExecutionOverlay {
  /** Keyed by {@link canonicalNodeKey}. */
  byNode: Map<string, NodeExecution>;
  /** `"<from>-><to>"` in canonical keys → 1-based hop order. */
  traversedEdges: Map<string, number>;
  /** Number of hops in the observed path. */
  hops: number;
  /** Node names seen in logs, in execution order (for drift reporting). */
  observedNames: string[];
  hasExecution: boolean;
  /**
   * Nodes the Object Store proves ran but that logs did not describe, keyed by
   * {@link canonicalNodeKey}. These are reached with no order, timing or
   * transition, so the view can show they were entered without implying a path.
   */
  reachedWithoutDetail: Set<string>;
}

/**
 * Protocol graph ids are namespaced by node kind (`orchestrator.crossPlatformTriage`)
 * while the graph runtime logs the bare node name (`crossPlatformTriage`), so
 * identity is compared on the last segment, case-insensitively. Without this the
 * overlay would match nothing and every node would render as un-traversed.
 */
export function canonicalNodeKey(idOrName: string): string {
  const trimmed = idOrName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  const tail = lastDot >= 0 ? trimmed.slice(lastDot + 1) : trimmed;
  return tail.trim().toLowerCase();
}

/** `"<from>-><to>"` key for an observed or declared transition. */
export function edgeKey(source: string, target: string): string {
  return `${canonicalNodeKey(source)}->${canonicalNodeKey(target)}`;
}

/** The graph runtime's label for the entrypoint, whatever the graph calls it. */
const RUNTIME_TRIGGER_ALIAS = /^node\s*1$/i;

/** The published graph's trigger node, which may or may not be namespaced. */
function findTriggerNodeId(graphNodeIds: string[]): string | undefined {
  return graphNodeIds.find((id) => {
    const raw = id.trim().toLowerCase();
    return raw === "trigger" || raw.startsWith("trigger.") || canonicalNodeKey(id) === "trigger";
  });
}

/**
 * Maps a name logged by the graph runtime onto the key of the graph node it
 * refers to.
 *
 * The runtime labels the entrypoint "node 1" while the published graph names its
 * trigger explicitly, so on name alone the two never meet: the trigger draws as
 * un-traversed and execution appears to start at the second node with its first
 * hop dangling. Resolving the alias needs the graph, so pass its node ids; with
 * no trigger declared there is nothing to alias onto and names are used as-is.
 */
export function createNodeKeyResolver(graphNodeIds: string[] = []): (nodeName: string) => string {
  const triggerId = findTriggerNodeId(graphNodeIds);
  if (triggerId === undefined) return canonicalNodeKey;

  const triggerKey = canonicalNodeKey(triggerId);
  return (nodeName) =>
    RUNTIME_TRIGGER_ALIAS.test(nodeName.trim()) ? triggerKey : canonicalNodeKey(nodeName);
}

/**
 * The hops execution actually took. A visit's own `transitionTo` is authoritative
 * because the broker logged it; consecutive visits are the fallback for brokers
 * that do not log transitions, where adjacency in time is the only evidence.
 */
function observedHops(
  visits: NodeVisit[],
  resolveKey: (nodeName: string) => string
): Array<{ from: string; to: string }> {
  const hops: Array<{ from: string; to: string }> = [];

  for (let i = 0; i < visits.length; i += 1) {
    const from = resolveKey(visits[i].nodeName);
    if (from === "") continue;

    const declared = visits[i].transitionTo?.trim();
    const next = visits[i + 1]?.nodeName?.trim();
    const declaredKey = declared ? resolveKey(declared) : "";
    // Runtime logs can place "Transitioning to next node: X" inside the visit
    // for X itself, which looks like a self-transition. In that case, prefer
    // the next observed visit so router handoffs still draw correctly.
    const to = declaredKey !== "" && declaredKey !== from
      ? declaredKey
      : resolveKey(next ?? "");
    if (to === "" || to === from) continue;

    hops.push({ from, to });
  }

  return hops;
}

/** Adjacency over the graph's own declared edges, keyed by canonical node key. */
function buildAdjacency(edges: Array<{ from: string; to: string }>): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const from = canonicalNodeKey(edge.from);
    const to = canonicalNodeKey(edge.to);
    const targets = adjacency.get(from);
    if (targets) targets.push(to);
    else adjacency.set(from, [to]);
  }
  return adjacency;
}

/**
 * Shortest run of declared edges from `from` to `to`, returned as the
 * intermediate node keys only (both endpoints excluded). `null` when no such
 * path exists in the published graph, so a hop between two nodes that are not
 * actually connected is left alone rather than bridged with an invented route.
 */
function shortestIntermediatePath(
  adjacency: Map<string, string[]>,
  from: string,
  to: string
): string[] | null {
  if (from === to) return [];
  const queue: string[] = [from];
  const prev = new Map<string, string>();
  const visited = new Set([from]);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      prev.set(next, current);
      if (next === to) {
        const path: string[] = [];
        let node = to;
        while (node !== from) {
          path.unshift(node);
          node = prev.get(node) as string;
        }
        return path.slice(0, -1);
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * @param graphNodeIds Node ids of the published graph being drawn, so runtime
 *   aliases resolve onto it. Omit when no graph is loaded yet; the overlay is
 *   then keyed on logged names alone.
 * @param reachedFromState Nodes the Object Store records as executed. Used only
 *   for nodes the logs say nothing about, so logged detail always wins.
 * @param graphEdges The published graph's own declared edges. Some node kinds
 *   (routers, subagent dispatch) leave no log trace at all — not even a
 *   transition line — so an observed hop can skip straight from one logged
 *   node to a much later one. When that happens this walks the graph's own
 *   edges to find what must have run in between, so the diagram shows an
 *   honest (if undetailed) path instead of drawing real hops as "not taken."
 */
export function buildExecutionOverlay(
  visits: NodeVisit[],
  graphNodeIds: string[] = [],
  reachedFromState: string[] = [],
  graphEdges: Array<{ from: string; to: string }> = []
): ExecutionOverlay {
  const byNode = new Map<string, NodeExecution>();
  const observedNames: string[] = [];
  const resolveKey = createNodeKeyResolver(graphNodeIds);
  let finalKey: string | undefined;

  visits.forEach((visit, index) => {
    const key = resolveKey(visit.nodeName);
    if (key === "") return;

    const existing = byNode.get(key);
    if (existing === undefined) {
      byNode.set(key, {
        order: index + 1,
        visitCount: 1,
        durationMs: Math.max(0, visit.durationMs),
        visit,
        isFinal: false,
      });
      observedNames.push(visit.nodeName.trim());
    } else {
      existing.visitCount += 1;
      existing.durationMs += Math.max(0, visit.durationMs);
    }
    finalKey = key;
  });

  if (finalKey !== undefined) {
    const last = byNode.get(finalKey);
    if (last !== undefined) last.isFinal = true;
  }

  const reachedWithoutDetail = new Set<string>();
  for (const name of reachedFromState) {
    const key = resolveKey(name);
    if (key !== "" && !byNode.has(key)) reachedWithoutDetail.add(key);
  }

  const declaredEdgeKeys = new Set(graphEdges.map((edge) => edgeKey(edge.from, edge.to)));
  const adjacency = buildAdjacency(graphEdges);

  const traversedEdges = new Map<string, number>();
  const hops = observedHops(visits, resolveKey);
  hops.forEach((hop, index) => {
    const order = index + 1;
    const key = `${hop.from}->${hop.to}`;
    if (!traversedEdges.has(key)) traversedEdges.set(key, order);
    if (declaredEdgeKeys.has(key)) return;

    const intermediates = shortestIntermediatePath(adjacency, hop.from, hop.to);
    if (intermediates == null) return;
    let cursor = hop.from;
    for (const node of intermediates) {
      if (!byNode.has(node)) reachedWithoutDetail.add(node);
      const bridgeKey = `${cursor}->${node}`;
      if (!traversedEdges.has(bridgeKey)) traversedEdges.set(bridgeKey, order);
      cursor = node;
    }
    const lastBridgeKey = `${cursor}->${hop.to}`;
    if (!traversedEdges.has(lastBridgeKey)) traversedEdges.set(lastBridgeKey, order);
  });

  return {
    byNode,
    traversedEdges,
    hops: hops.length,
    observedNames,
    hasExecution: byNode.size > 0 || reachedWithoutDetail.size > 0,
    reachedWithoutDetail,
  };
}

/**
 * Node names the logs report that the published graph does not declare. A
 * non-empty result means the deployed definition has drifted from the Exchange
 * version being drawn, which is worth saying out loud rather than rendering a
 * path that silently omits steps the task really took.
 */
export function findDriftedNodes(overlay: ExecutionOverlay, graphNodeIds: string[]): string[] {
  const known = new Set(graphNodeIds.map(canonicalNodeKey));
  const resolveKey = createNodeKeyResolver(graphNodeIds);
  const drifted: string[] = [];
  for (const name of overlay.observedNames) {
    // Resolving first means a runtime alias for a node the graph does declare —
    // "node 1" for the trigger — is not mistaken for drift.
    if (!known.has(resolveKey(name))) drifted.push(name);
  }
  return drifted;
}
