import type {
  CanonicalGraph,
  CanonicalNode,
  CanonicalEdge,
  NodeType,
} from "@/lib/agent-network-types";
import { debugLog, debugWarn } from "@/lib/api-logger";

export interface ExchangeConnection {
  kind: string;
  ref: {
    groupId: string;
    assetId: string;
    version: string;
  };
  metadata?: Record<string, unknown>;
}

export interface ExchangeVersionMetadata {
  metadata?: {
    card?: { name?: string; description?: string; [key: string]: unknown };
    connections?: ExchangeConnection[];
    [key: string]: unknown;
  };
  llm: { groupId: string; assetId: string; version: string } | null;
  connections: ExchangeConnection[];
}

export interface ExchangeAssetInfo {
  name?: string;
  organizationId?: string;
  groupId?: string;
  version?: string;
  files?: Array<{
    classifier?: string;
    packaging?: string;
    downloadURL?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

function connectionKindToNodeType(kind: string): NodeType {
  switch (kind.toLowerCase()) {
    case "agent":
      return "AGENT";
    case "mcp":
      return "MCP";
    case "llm":
      return "LLM";
    default:
      return "AGENT";
  }
}

function buildIconPath(
  orgId: string,
  groupId: string,
  assetId: string,
  iconFile: { classifier?: string; packaging?: string }
): string | undefined {
  if (!iconFile.classifier || !iconFile.packaging) return undefined;
  return `/exchange/files/api/v1/organizations/${encodeURIComponent(orgId)}/assets/${encodeURIComponent(groupId)}/${encodeURIComponent(assetId)}/${encodeURIComponent(iconFile.classifier)}/${encodeURIComponent(iconFile.packaging)}`;
}

/**
 * Builds a canonical graph from Exchange metadata for a single broker version.
 * Fetches the broker's connections (agents, MCPs, LLMs) and resolves their
 * display names and icons from Exchange.
 */
export async function exchangeVersionToCanonical(
  orgId: string,
  assetId: string,
  version: string,
  brokerName: string
): Promise<CanonicalGraph> {
  const nodes: CanonicalNode[] = [];
  const edges: CanonicalEdge[] = [];
  const existingNodeIds = new Set<string>();

  const brokerNodeId = `${orgId}:${assetId}`;

  nodes.push({
    id: brokerNodeId,
    label: brokerName,
    version,
    type: "BROKER",
    organizationId: orgId,
    position: { x: 0, y: 0 },
    exchangeAssetId: assetId,
  });
  existingNodeIds.add(brokerNodeId);

  try {
    const metaRes = await fetch(
      `/api/exchange/metadata?organizationId=${encodeURIComponent(orgId)}&assetId=${encodeURIComponent(assetId)}&version=${encodeURIComponent(version)}`
    );

    if (!metaRes.ok) {
      debugWarn(`Exchange metadata fetch failed for ${assetId}@${version}: ${metaRes.status}`);
      return { nodes, edges, mode: "design" };
    }

    const metaData = (await metaRes.json()) as ExchangeVersionMetadata;
    const connections = metaData.connections ?? [];

    debugLog(`[exchangeVersionToCanonical] ${assetId}@${version} connections:`, connections.length);

    const connectionPromises = connections.map(async (conn) => {
      const connNodeId = `${conn.ref.groupId}:${conn.ref.assetId}`;
      const nodeType = connectionKindToNodeType(conn.kind);

      if (existingNodeIds.has(connNodeId)) return;
      existingNodeIds.add(connNodeId);

      let connName = conn.ref.assetId;
      let connIcon: string | undefined;

      try {
        const assetRes = await fetch(
          `/api/exchange/asset?organizationId=${encodeURIComponent(conn.ref.groupId)}&assetId=${encodeURIComponent(conn.ref.assetId)}&version=${encodeURIComponent(conn.ref.version)}`
        );

        if (assetRes.ok) {
          const assetData = (await assetRes.json()) as ExchangeAssetInfo;
          if (assetData.name) connName = assetData.name;

          const iconFile = assetData.files?.find(
            (f) => f.classifier?.toLowerCase() === "icon"
          );
          if (iconFile) {
            connIcon = buildIconPath(
              assetData.organizationId || conn.ref.groupId,
              assetData.groupId || conn.ref.groupId,
              conn.ref.assetId,
              iconFile
            );
          }
        }
      } catch {
        debugWarn(`Failed to fetch asset info for ${connNodeId}`);
      }

      const node: CanonicalNode = {
        id: connNodeId,
        label: connName,
        version: conn.ref.version,
        type: nodeType,
        organizationId: conn.ref.groupId,
        position: { x: 0, y: 0 },
        exchangeAssetId: conn.ref.assetId,
        ...(connIcon ? { icon: connIcon } : {}),
      };

      nodes.push(node);

      edges.push({
        id: `${brokerNodeId}->${connNodeId}`,
        source: brokerNodeId,
        target: connNodeId,
        type: "designTime",
      });
    });

    await Promise.all(connectionPromises);
  } catch (error) {
    debugWarn(`Error building exchange canonical graph:`, error);
  }

  return { nodes, edges, mode: "design" };
}

/**
 * Compares two canonical graphs and produces a diff result.
 * Nodes/edges are classified as added, removed, changed, or unchanged.
 */
export interface GraphDiff {
  addedNodes: CanonicalNode[];
  removedNodes: CanonicalNode[];
  changedNodes: Array<{ before: CanonicalNode; after: CanonicalNode }>;
  unchangedNodes: CanonicalNode[];
  addedEdges: CanonicalEdge[];
  removedEdges: CanonicalEdge[];
}

export function diffGraphs(
  before: CanonicalGraph,
  after: CanonicalGraph
): GraphDiff {
  const beforeNodeMap = new Map(before.nodes.map((n) => [n.id, n]));
  const afterNodeMap = new Map(after.nodes.map((n) => [n.id, n]));

  const addedNodes: CanonicalNode[] = [];
  const removedNodes: CanonicalNode[] = [];
  const changedNodes: Array<{ before: CanonicalNode; after: CanonicalNode }> = [];
  const unchangedNodes: CanonicalNode[] = [];

  for (const [id, node] of afterNodeMap) {
    const prev = beforeNodeMap.get(id);
    if (!prev) {
      addedNodes.push(node);
    } else if (prev.version !== node.version || prev.type !== node.type) {
      changedNodes.push({ before: prev, after: node });
    } else {
      unchangedNodes.push(node);
    }
  }

  for (const [id, node] of beforeNodeMap) {
    if (!afterNodeMap.has(id)) {
      removedNodes.push(node);
    }
  }

  const beforeEdgeIds = new Set(before.edges.map((e) => e.id));
  const afterEdgeIds = new Set(after.edges.map((e) => e.id));

  const addedEdges = after.edges.filter((e) => !beforeEdgeIds.has(e.id));
  const removedEdges = before.edges.filter((e) => !afterEdgeIds.has(e.id));

  return {
    addedNodes,
    removedNodes,
    changedNodes,
    unchangedNodes,
    addedEdges,
    removedEdges,
  };
}
