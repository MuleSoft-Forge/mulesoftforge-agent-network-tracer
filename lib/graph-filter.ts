import type { CanonicalGraph, CanonicalNode, CanonicalEdge } from "@/lib/agent-network-types";

/**
 * Filters a canonical graph to show only nodes reachable from a given broker node.
 * Uses BFS to find all connected nodes recursively.
 */
export function filterGraphByBroker(
  graph: CanonicalGraph,
  brokerNodeId: string
): CanonicalGraph {
  // Build adjacency list (bidirectional for undirected traversal)
  const adjacencyList = new Map<string, Set<string>>();
  
  // Initialize adjacency list for all nodes
  for (const node of graph.nodes) {
    adjacencyList.set(node.id, new Set());
  }
  
  // Add edges (bidirectional)
  for (const edge of graph.edges) {
    const sourceNeighbors = adjacencyList.get(edge.source);
    const targetNeighbors = adjacencyList.get(edge.target);
    if (sourceNeighbors && targetNeighbors) {
      sourceNeighbors.add(edge.target);
      targetNeighbors.add(edge.source);
    }
  }
  
  // BFS to find all reachable nodes
  const reachableNodeIds = new Set<string>();
  const queue: string[] = [brokerNodeId];
  reachableNodeIds.add(brokerNodeId);
  
  while (queue.length > 0) {
    const currentNodeId = queue.shift()!;
    const neighbors = adjacencyList.get(currentNodeId) || new Set();
    
    for (const neighborId of neighbors) {
      if (!reachableNodeIds.has(neighborId)) {
        reachableNodeIds.add(neighborId);
        queue.push(neighborId);
      }
    }
  }
  
  // Filter nodes to only include reachable ones
  const filteredNodes = graph.nodes.filter((node: CanonicalNode) => reachableNodeIds.has(node.id));

  const filteredEdges = graph.edges.filter(
    (edge: CanonicalEdge) => reachableNodeIds.has(edge.source) && reachableNodeIds.has(edge.target)
  );
  
  return {
    nodes: filteredNodes,
    edges: filteredEdges,
    mode: graph.mode,
  };
}

/**
 * Finds a broker node by its brokerKey.
 * Returns the node ID if found, null otherwise.
 * 
 * brokerKey format: "orgId-assetId" (e.g., "eca25329-...-invoiceDisputeBroker")
 * node.id format: "orgId:assetId" (e.g., "eca25329-...:invoiceDisputeBroker")
 */
export function findBrokerNodeId(
  graph: CanonicalGraph,
  brokerKey: string
): string | null {
  // Convert brokerKey format (orgId-assetId) to node ID format (orgId:assetId)
  // Find the last occurrence of orgId pattern (UUID format) and replace the separator
  const uuidPattern = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const match = brokerKey.match(uuidPattern);
  
  if (match) {
    // brokerKey has orgId-assetId format, convert to orgId:assetId
    const orgId = match[1];
    const assetId = brokerKey.substring(match.index! + match[0].length + 1); // +1 for the "-"
    const expectedNodeId = `${orgId}:${assetId}`;
    
    // Direct match
    for (const node of graph.nodes) {
      if (node.type === "BROKER" && node.id === expectedNodeId) {
        return node.id;
      }
    }
  }
  
  // Fallback: try to find by assetId in various ways
  const parts = brokerKey.split("-");
  const assetId = parts.length > 1 ? parts.slice(1).join("-") : brokerKey;
  
  for (const node of graph.nodes) {
    if (node.type === "BROKER") {
      // Check if node.id ends with the assetId (handles orgId:assetId format)
      if (node.id.endsWith(`:${assetId}`) || node.id.endsWith(`-${assetId}`)) {
        return node.id;
      }
      // Check if exchangeAssetId matches
      if (node.exchangeAssetId === assetId) {
        return node.id;
      }
      // Check if label contains the assetId (case-insensitive)
      if (node.label.toLowerCase().includes(assetId.toLowerCase())) {
        return node.id;
      }
    }
  }
  
  return null;
}
