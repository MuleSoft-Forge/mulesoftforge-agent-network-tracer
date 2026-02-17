import type { CanonicalEdge, CanonicalGraph, CanonicalNode, NodeType } from "@/lib/agent-network-types";

/** Visualizer fabric-network API response (v2). */
export interface FabricNode {
  id: string;
  assetId: string;
  name: string;
  version?: string;
  type: string;
  organizationId: string;
  [key: string]: unknown;
}

export interface FabricEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type?: string;
  properties?: {
    throughput?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface FabricGraphResponse {
  nodes?: FabricNode[];
  edges?: FabricEdge[];
  prod_instances_map?: Record<string, string[]>;
  non_prod_instances_map?: Record<string, string[]>;
}

const NODE_TYPES: NodeType[] = ["BROKER", "AGENT", "MCP"];

function toNodeType(t: string): NodeType {
  return NODE_TYPES.includes(t as NodeType) ? (t as NodeType) : "AGENT";
}

/**
 * Maps Visualizer fabric-network response to canonical graph.
 * Isolates canvas from Visualizer API changes.
 */
export function visualizerToCanonical(res: FabricGraphResponse): CanonicalGraph {
  const nodes: CanonicalNode[] = [];
  const edges: CanonicalEdge[] = [];
  const prodMap = res.prod_instances_map ?? {};
  const nonProdMap = res.non_prod_instances_map ?? {};

  for (const n of res.nodes ?? []) {
    const nodeId = n.id ?? `${n.organizationId}:${n.assetId}`;
    const instanceIds = [
      ...(prodMap[nodeId] ?? []),
      ...(nonProdMap[nodeId] ?? []),
    ];
    const platform =
      typeof (n as unknown as { platform?: string }).platform === "string" &&
      (n as unknown as { platform?: string }).platform !== ""
        ? (n as unknown as { platform?: string }).platform
        : undefined;
    const icon =
      typeof (n as unknown as { icon?: string }).icon === "string" && (n as unknown as { icon?: string }).icon?.startsWith("/")
        ? (n as unknown as { icon?: string }).icon
        : undefined;
    nodes.push({
      id: nodeId,
      label: n.name ?? n.assetId ?? nodeId,
      version: n.version ?? "0.0.0",
      type: toNodeType(n.type),
      organizationId: n.organizationId ?? "",
      position: { x: 0, y: 0 },
      ...(instanceIds.length > 0 ? { instanceIds } : {}),
      ...(platform ? { frameworkType: platform } : {}),
      ...(icon ? { icon } : {}),
    });
  }

  for (const e of res.edges ?? []) {
    edges.push({
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      type: e.type === "runTime" ? "runTime" : "designTime",
    });
  }

  return { nodes, edges, mode: "runtime" };
}
