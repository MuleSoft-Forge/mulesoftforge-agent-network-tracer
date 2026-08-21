import type { Broker, GraphNodeKind } from "@/lib/composer/model";
import { applyDagreOverviewLayout, type GraphLayoutDirection } from "@/lib/composer/agentfabric-graph-layout";
import type {
  AgentFabricGraphEdge,
  AgentFabricGraphNode,
  AgentFabricGraphNodeData,
} from "@/lib/composer/agentfabric-graph-types";
import {
  ROUTER_OTHERWISE_SLOT,
  routerCanvasOutputs,
  routerOutputHandleId,
} from "@/lib/composer/agentfabric-graph";

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

function nodeTypeForKind(kind: GraphNodeKind): AgentFabricGraphNodeData["nodeType"] {
  if (kind === "trigger") return "af-trigger";
  if (kind === "router") return "af-router";
  return "af-node";
}

function encodeProtocolOutputs(outputs: string[]): string {
  return outputs.map((o) => o.replace(/\\/g, "\\\\").replace(/,/g, "\\,")).join(",");
}

function buildLayoutNodes(broker: Broker): AgentFabricGraphNode[] {
  return broker.nodes.map((n) => {
    const nodeType = nodeTypeForKind(n.kind);
    const data: AgentFabricGraphNodeData = {
      nodeType,
      label: n.name,
      subtitle: n.label || n.kind,
      blockType: n.kind,
      kind: n.kind,
    };
    // Dagre sizes the router card from the output count, so labels suffice here.
    if (n.kind === "router") {
      data.outputs = encodeProtocolOutputs(routerCanvasOutputs(n).map((output) => output.label));
    }
    return {
      id: n.id,
      type: nodeType,
      position: n.position,
      data,
    };
  });
}

function buildLayoutEdges(broker: Broker): AgentFabricGraphEdge[] {
  const edges: AgentFabricGraphEdge[] = [];

  for (const n of broker.nodes) {
    if (n.kind === "router") {
      for (const r of n.routes ?? []) {
        if (!r.targetNodeId) continue;
        edges.push({
          id: `route-${r.id}`,
          source: n.id,
          sourceHandle: routerOutputHandleId(r.id),
          target: r.targetNodeId,
          targetHandle: "top",
          label: r.label || r.when,
        });
      }
      if (n.otherwiseTargetNodeId) {
        edges.push({
          id: `otherwise-${n.id}`,
          source: n.id,
          sourceHandle: routerOutputHandleId(ROUTER_OTHERWISE_SLOT),
          target: n.otherwiseTargetNodeId,
          targetHandle: "top",
          label: "otherwise",
        });
      }
    } else if (n.onExitTarget) {
      edges.push({
        id: `exit-${n.id}`,
        source: n.id,
        sourceHandle: "bottom",
        target: n.onExitTarget,
        targetHandle: "top",
      });
    }
  }

  return edges;
}

export function computeBrokerHierarchicalPositions(
  broker: Broker,
  direction: GraphLayoutDirection = "vertical"
): Record<string, { x: number; y: number }> {
  const layout = applyDagreOverviewLayout(buildLayoutNodes(broker), buildLayoutEdges(broker), direction);
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of layout.nodes) positions[node.id] = node.position;
  return positions;
}

/** Apply Dagre top-to-bottom layout onto broker graph node positions. */
export function applyHierarchicalGraphLayout(
  broker: Broker,
  direction: GraphLayoutDirection = "vertical"
): Broker {
  const positions = computeBrokerHierarchicalPositions(broker, direction);
  return {
    ...broker,
    nodes: broker.nodes.map((node) => {
      const position = positions[node.id];
      return position ? { ...node, position } : node;
    }),
  };
}
