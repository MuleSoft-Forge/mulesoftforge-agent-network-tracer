/**
 * AgentFabric → React Flow overview-graph adapter.
 *
 * Translates the protocol `Graph` from `@sf-agentscript/agentfabric-dialect#getGraph`
 * into React Flow nodes + edges, matching the official @agentscript/ui mapper.
 */

import type { Graph, ProtocolEdge, ProtocolNode } from "@sf-agentscript/agentfabric-dialect";
import type {
  AgentFabricGraphEdge,
  AgentFabricGraphNode,
  AgentFabricGraphNodeType,
} from "@/lib/composer/agentfabric-graph-types";

/** Handle-id prefix for per-output source handles on router nodes. */
const ROUTER_OUTPUT_HANDLE_PREFIX = "out:";

/** Build the source handle id used by an edge leaving a router by output name. */
export function routerOutputHandleId(output: string): string {
  return `${ROUTER_OUTPUT_HANDLE_PREFIX}${output}`;
}

/** Parse a router source handle id back to its output label. */
export function routerOutputFromHandleId(handleId: string | null | undefined): string | null {
  if (!handleId?.startsWith(ROUTER_OUTPUT_HANDLE_PREFIX)) return null;
  return handleId.slice(ROUTER_OUTPUT_HANDLE_PREFIX.length);
}

/** Canvas handle label for a conditional route (matches edge sourceHandle). */
export function routeOutputLabel(route: { label?: string; when: string }): string {
  return (route.label || route.when || "route").trim();
}

/**
 * Ordered router output handles shown on the Builder canvas.
 * Includes one "+ route" slot and an always-visible otherwise handle.
 */
export function routerCanvasOutputs(node: {
  routes?: Array<{ label?: string; when: string }>;
}): string[] {
  const outputs = (node.routes ?? []).map(routeOutputLabel);
  outputs.push("route");
  outputs.push("otherwise");
  return outputs;
}

/**
 * Parse the protocol's comma-separated `outputs` string into trimmed route labels.
 * Reverses dialect escaping (`\\` and `\\,`).
 */
export function parseProtocolOutputs(outputs: string | undefined): string[] {
  if (!outputs) return [];
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < outputs.length; i++) {
    const ch = outputs[i];
    if (ch === "\\" && i + 1 < outputs.length) {
      current += outputs[i + 1];
      i++;
      continue;
    }
    if (ch === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Parse `"line,character"` lexical position strings from the protocol bag (0-based). */
export function parseLexicalPosition(value: string | undefined): { line: number; character: number } | null {
  if (!value) return null;
  const [lineRaw, charRaw] = value.split(",");
  const line = Number.parseInt(lineRaw?.trim() ?? "", 10);
  const character = Number.parseInt(charRaw?.trim() ?? "", 10);
  if (!Number.isFinite(line) || !Number.isFinite(character)) return null;
  return { line, character };
}

type StructuralRole = "entry" | "router" | "leaf" | "step";

function inferRoles(graph: Graph): Map<string, StructuralRole> {
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const node of graph.nodes) {
    inDeg.set(node.id, 0);
    outDeg.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    outDeg.set(edge.from, (outDeg.get(edge.from) ?? 0) + 1);
    inDeg.set(edge.to, (inDeg.get(edge.to) ?? 0) + 1);
  }
  const roles = new Map<string, StructuralRole>();
  for (const node of graph.nodes) {
    const out = outDeg.get(node.id) ?? 0;
    const inc = inDeg.get(node.id) ?? 0;
    const declaresOutputs = !!node.additionalProperties?.outputs;
    if (declaresOutputs || out > 1) roles.set(node.id, "router");
    else if (inc === 0) roles.set(node.id, "entry");
    else if (out === 0) roles.set(node.id, "leaf");
    else roles.set(node.id, "step");
  }
  return roles;
}

function nodeTypeForRole(role: StructuralRole): AgentFabricGraphNodeType {
  switch (role) {
    case "entry":
      return "af-trigger";
    case "router":
      return "af-router";
    default:
      return "af-node";
  }
}

function deriveLabelFromId(id: string): string {
  const parts = id.split(".");
  if (parts.length >= 2) return parts[1];
  return id;
}

function makeEdge(edge: ProtocolEdge, idx: number): AgentFabricGraphEdge {
  const output = edge.additionalProperties?.output;
  const predicate = edge.additionalProperties?.predicate;
  const id = `${edge.from}->${edge.to}#${output ?? ""}#${idx}`;
  const reactFlowEdge: AgentFabricGraphEdge = {
    id,
    source: edge.from,
    target: edge.to,
    type: "smoothstep",
  };
  if (output) {
    reactFlowEdge.label = predicate ?? output;
    reactFlowEdge.data = {
      output,
      ...(predicate ? { predicate } : {}),
    };
    reactFlowEdge.sourceHandle = routerOutputHandleId(output);
  }
  return reactFlowEdge;
}

function makeNode(node: ProtocolNode, role: StructuralRole): AgentFabricGraphNode {
  const props = node.additionalProperties ?? {};
  const nodeType = nodeTypeForRole(role);
  const label = props.label ?? deriveLabelFromId(node.id);

  return {
    id: node.id,
    type: nodeType,
    position: { x: 0, y: 0 },
    data: {
      nodeType,
      label,
      subtitle: node.kind,
      blockType: node.kind,
      kind: node.kind,
      ...(props.outputs ? { outputs: props.outputs } : {}),
    },
  };
}

/** Convert a protocol `Graph` to React Flow nodes + edges (official mapper). */
export function protocolGraphToReactFlow(graph: Graph): {
  nodes: AgentFabricGraphNode[];
  edges: AgentFabricGraphEdge[];
} {
  const roles = inferRoles(graph);
  return {
    nodes: graph.nodes.map((node) => makeNode(node, roles.get(node.id) ?? "step")),
    edges: graph.edges.map((edge, idx) => makeEdge(edge, idx)),
  };
}

/** Resolve a 0-based source position for graph node click → Monaco navigation. */
export function lexicalPositionForNode(graph: Graph, nodeId: string): { line: number; character: number } | null {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node?.additionalProperties) return null;
  return parseLexicalPosition(node.additionalProperties["lexical-start-position"]);
}
