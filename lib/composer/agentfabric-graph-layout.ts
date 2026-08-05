/**
 * Dagre layout for AgentFabric overview graphs (ported from @agentscript/ui).
 */

import dagre from "@dagrejs/dagre";
import { parseProtocolOutputs } from "@/lib/composer/agentfabric-graph";
import type {
  AgentFabricGraphEdge,
  AgentFabricGraphNode,
  AgentFabricGraphNodeType,
} from "@/lib/composer/agentfabric-graph-types";

type HandleSide = "top" | "bottom" | "left" | "right";
export type GraphLayoutDirection = "vertical" | "horizontal";

interface SideConfig {
  type: "source" | "target";
}

// Sized for the expanded card: title row, subtitle, summary chips, and preview.
const NODE_DIMENSIONS: Record<AgentFabricGraphNodeType, { width: number; height: number }> = {
  "af-trigger": { width: 220, height: 72 },
  "af-router": { width: 260, height: 96 },
  "af-node": { width: 288, height: 124 },
};

const OVERVIEW_SIDES: Partial<Record<HandleSide, SideConfig>> = {
  top: { type: "target" },
  bottom: { type: "source" },
  left: { type: "target" },
  right: { type: "source" },
};

const AF_TRIGGER_SIDES: Partial<Record<HandleSide, SideConfig>> = {
  bottom: { type: "source" },
  right: { type: "source" },
};

const AF_ROUTER_SIDES: Partial<Record<HandleSide, SideConfig>> = {
  top: { type: "target" },
  left: { type: "target" },
};

function getNodeDimensions(node: AgentFabricGraphNode): { width: number; height: number } {
  const base = NODE_DIMENSIONS[node.data.nodeType] ?? { width: 200, height: 70 };

  if (node.data.nodeType === "af-router") {
    const outputs = parseProtocolOutputs(node.data.outputs);
    if (outputs.length > 0) {
      const rowHeight = 22;
      const gap = 4;
      const listHeight = outputs.length * rowHeight + (outputs.length - 1) * gap;
      return { width: base.width, height: 56 + 8 + listHeight };
    }
  }

  return base;
}

function getOverviewSides(nodeType: AgentFabricGraphNodeType): Partial<Record<HandleSide, SideConfig>> {
  switch (nodeType) {
    case "af-trigger":
      return AF_TRIGGER_SIDES;
    case "af-router":
      return AF_ROUTER_SIDES;
    default:
      return OVERVIEW_SIDES;
  }
}

function trackHandle(map: Map<string, Set<string>>, nodeId: string, handleId: string): void {
  const set = map.get(nodeId);
  if (set) set.add(handleId);
  else map.set(nodeId, new Set([handleId]));
}

export interface AgentFabricLayoutResult {
  nodes: AgentFabricGraphNode[];
  edges: AgentFabricGraphEdge[];
  connectedHandles: Map<string, Set<string>>;
}

/** Dagre-based hierarchical layout for AgentFabric overview graphs. */
export function applyDagreOverviewLayout(
  nodes: AgentFabricGraphNode[],
  edges: AgentFabricGraphEdge[],
  direction: GraphLayoutDirection = "vertical"
): AgentFabricLayoutResult {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], connectedHandles: new Map() };
  }

  const g = new dagre.graphlib.Graph({ directed: true });
  g.setGraph({
    rankdir: direction === "horizontal" ? "LR" : "TB",
    nodesep: 80,
    ranksep: 120,
    marginx: 40,
    marginy: 40,
    ranker: "network-simplex",
  });
  g.setDefaultNodeLabel(() => ({}));
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const dims = getNodeDimensions(node);
    g.setNode(node.id, { width: dims.width, height: dims.height });
  }

  for (const edge of edges) {
    if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positionedNodes = nodes.map((node) => {
    const dn = g.node(node.id) as { x: number; y: number; width: number; height: number } | undefined;
    return {
      ...node,
      position: {
        x: dn ? dn.x - dn.width / 2 : 0,
        y: dn ? dn.y - dn.height / 2 : 0,
      },
    };
  });

  return wireHandles(positionedNodes, edges, direction);
}

/**
 * Assign each edge a concrete source/target handle and record which handles are connected.
 */
function wireHandles(
  positionedNodes: AgentFabricGraphNode[],
  edges: AgentFabricGraphEdge[],
  direction: GraphLayoutDirection
): AgentFabricLayoutResult {
  const sourcePool = new Map<string, string[]>();
  const targetPool = new Map<string, string[]>();
  const consumedSet = new Map<string, Set<string>>();

  for (const node of positionedNodes) {
    const sides = getOverviewSides(node.data.nodeType);
    const sources: string[] = [];
    if (direction === "horizontal") {
      if (sides.right?.type === "source") sources.push("right");
      if (sides.bottom?.type === "source") sources.push("bottom");
    } else {
      if (sides.bottom?.type === "source") sources.push("bottom");
      if (sides.right?.type === "source") sources.push("right");
    }
    const targets: string[] = [];
    if (direction === "horizontal") {
      if (sides.left?.type === "target") targets.push("left");
      if (sides.top?.type === "target") targets.push("top");
    } else {
      if (sides.top?.type === "target") targets.push("top");
      if (sides.left?.type === "target") targets.push("left");
    }
    sourcePool.set(node.id, sources);
    targetPool.set(node.id, targets);
    consumedSet.set(node.id, new Set());
  }

  function consume(nodeId: string, handleId: string): void {
    consumedSet.get(nodeId)?.add(handleId);
  }

  function takeSource(nodeId: string): string {
    const pool = sourcePool.get(nodeId) ?? [];
    const used = consumedSet.get(nodeId) ?? new Set();
    for (const h of pool) {
      if (!used.has(h)) {
        consume(nodeId, h);
        return h;
      }
    }
    return direction === "horizontal" ? "right" : "bottom";
  }

  function takeTarget(nodeId: string): string {
    const pool = targetPool.get(nodeId) ?? [];
    const used = consumedSet.get(nodeId) ?? new Set();
    for (const h of pool) {
      if (!used.has(h)) {
        consume(nodeId, h);
        return h;
      }
    }
    return direction === "horizontal" ? "left" : "top";
  }

  for (const edge of edges) {
    if (edge.sourceHandle) consume(edge.source, edge.sourceHandle);
    if (edge.targetHandle) consume(edge.target, edge.targetHandle);
  }

  const connectedHandles = new Map<string, Set<string>>();
  const updatedEdges = edges.map((edge) => {
    const sourceHandle = edge.sourceHandle ?? takeSource(edge.source);
    const targetHandle = edge.targetHandle ?? takeTarget(edge.target);
    trackHandle(connectedHandles, edge.source, sourceHandle);
    trackHandle(connectedHandles, edge.target, targetHandle);
    return { ...edge, sourceHandle, targetHandle };
  });

  const nodesWithHandles = positionedNodes.map((node) => {
    const connected = connectedHandles.get(node.id);
    if (connected) {
      return { ...node, data: { ...node.data, connectedHandles: connected } };
    }
    return node;
  });

  return { nodes: nodesWithHandles, edges: updatedEdges, connectedHandles };
}
