import type { Graph, ProtocolEdge, ProtocolNode } from "@sf-agentscript/agentfabric-dialect";

/**
 * Build a drawable graph from the broker's own compiled spec.
 *
 * The primary source for the Graph view is the `.agent` file published to
 * Exchange, because that is what the Composer renders and keeps the two
 * diagrams in agreement. It is not always reachable, though: the asset may not
 * be published under any name the task knows, and the version the runtime was
 * actually using has to be guessed from when the task ran.
 *
 * The broker sidesteps both problems by persisting its compiled
 * `session_unified_spec` in graph state, so this is the fallback: the definition
 * that certainly ran, with no Exchange lookup and no version matching.
 *
 * The trade-off is node kinds. AgentScript's source-level distinctions
 * (orchestrator, echo, and so on) compile down to a single `agent` node type, so
 * a spec-drawn diagram carries less kind detail than an Exchange-drawn one. The
 * protocol treats `kind` as an open set, so this degrades rather than breaks —
 * but it is why the spec is the fallback and not the default.
 */

/** Lifecycle hooks that can carry a handoff, in the runtime's execution order. */
const HOOK_FIELDS = [
  "on_init",
  "before_reasoning",
  "before_reasoning_iteration",
  "after_all_tool_calls",
  "after_reasoning",
  "on_exit",
] as const;

/**
 * The runtime's models are kebab-cased for serialization but persist under their
 * Python field names, so both spellings are accepted rather than betting on one.
 */
function readField(source: Record<string, unknown>, snakeCase: string): unknown {
  const direct = source[snakeCase];
  if (direct !== undefined) return direct;
  return source[snakeCase.replace(/_/g, "-")];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Handoff targets declared across a node's lifecycle hooks. */
function handoffTargets(node: Record<string, unknown>): string[] {
  const targets: string[] = [];
  for (const hook of HOOK_FIELDS) {
    const actions = readField(node, hook);
    if (!Array.isArray(actions)) continue;
    for (const action of actions) {
      const record = asRecord(action);
      if (record == null) continue;
      if (asNonEmptyString(record.type) !== "handoff") continue;
      const target = asNonEmptyString(record.target);
      if (target != null) targets.push(target);
    }
  }
  return targets;
}

/** Targets a router node can classify into. */
function routeTargets(node: Record<string, unknown>): string[] {
  const references = readField(node, "node_references");
  if (!Array.isArray(references)) return [];
  const targets: string[] = [];
  for (const reference of references) {
    const record = asRecord(reference);
    const target = record != null ? asNonEmptyString(record.target) : null;
    if (target != null) targets.push(target);
  }
  return targets;
}

export interface SpecGraphResult {
  graph: Graph | null;
  /** Why no graph could be built, for the view to show verbatim. */
  reason?: string;
  /** Human-readable label of the network, when the spec carries one. */
  label?: string;
}

/**
 * Convert a persisted `session_unified_spec` into the protocol graph shape.
 *
 * @param spec The parsed `execution.runtime.session_unified_spec` object.
 */
export function specToProtocolGraph(spec: unknown): SpecGraphResult {
  const root = asRecord(spec);
  if (root == null) {
    return { graph: null, reason: "The broker's persisted spec was not an object." };
  }

  const graphConfig = asRecord(readField(root, "graph"));
  if (graphConfig == null) {
    return { graph: null, reason: "The broker's persisted spec carries no graph configuration." };
  }

  const rawNodes = readField(graphConfig, "nodes");
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    return { graph: null, reason: "The broker's persisted spec declares no graph nodes." };
  }

  const nodes: ProtocolNode[] = [];
  const edges: ProtocolEdge[] = [];
  const declared = new Set<string>();
  const seenEdges = new Set<string>();

  const addEdge = (from: string, to: string, via: string): void => {
    const key = `${from}->${to}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ from, to, additionalProperties: { via } });
  };

  for (const rawNode of rawNodes) {
    const node = asRecord(rawNode);
    if (node == null) continue;
    const name = asNonEmptyString(readField(node, "name"));
    if (name == null) continue;
    const kind = asNonEmptyString(readField(node, "type")) ?? "agent";
    const label = asNonEmptyString(readField(node, "label"));
    declared.add(name);
    nodes.push({
      id: name,
      kind,
      ...(label != null ? { additionalProperties: { label } } : {}),
    });
  }

  if (nodes.length === 0) {
    return { graph: null, reason: "The broker's persisted spec declares no named graph nodes." };
  }

  for (const rawNode of rawNodes) {
    const node = asRecord(rawNode);
    const name = node != null ? asNonEmptyString(readField(node, "name")) : null;
    if (node == null || name == null) continue;
    for (const target of handoffTargets(node)) addEdge(name, target, "handoff");
    for (const target of routeTargets(node)) addEdge(name, target, "route");
  }

  // The spec names its entrypoint rather than declaring a trigger node, but the
  // published source does declare one and the runtime labels it as a node it
  // entered, so it is drawn to keep those three consistent.
  const initialNode = asNonEmptyString(readField(graphConfig, "initial_node"));
  if (initialNode != null && declared.has(initialNode)) {
    nodes.unshift({ id: "trigger", kind: "trigger" });
    addEdge("trigger", initialNode, "trigger");
  }

  // A handoff can name a node the graph does not declare; drawing an edge to a
  // node that is not there would produce a dangling arrow.
  const drawable = edges.filter(
    (edge) => (edge.from === "trigger" || declared.has(edge.from)) && declared.has(edge.to)
  );

  const label = asNonEmptyString(readField(root, "label"));
  return {
    graph: { nodes, edges: drawable },
    ...(label != null ? { label } : {}),
  };
}
