import type { FabricGraphResponse, FabricNode, FabricEdge } from "@/lib/adapters/visualizer-to-canonical";

/**
 * Common BFS function to find all nodes reachable from starting node IDs.
 * Returns set of reachable node IDs.
 * Uses unidirectional traversal (forward only: source → target).
 */
function findReachableNodes(
  nodes: FabricNode[],
  edges: FabricEdge[],
  startNodeIds: string[]
): Set<string> {
  // Build adjacency list (unidirectional: source → target only)
  const adjacencyList = new Map<string, Set<string>>();
  
  // Initialize for all nodes
  for (const node of nodes) {
    adjacencyList.set(node.id, new Set());
  }
  
  // Add edges (unidirectional: only forward direction)
  for (const edge of edges) {
    const sourceNeighbors = adjacencyList.get(edge.sourceId);
    if (sourceNeighbors) {
      sourceNeighbors.add(edge.targetId);
    }
  }
  
  // BFS from all starting nodes
  const reachableNodeIds = new Set<string>();
  const queue: string[] = [...startNodeIds];
  
  for (const startId of startNodeIds) {
    reachableNodeIds.add(startId);
  }
  
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
  
  return reachableNodeIds;
}

/**
 * Common function to filter Visualizer response to only include reachable nodes.
 */
function filterByReachableNodes(
  response: FabricGraphResponse,
  reachableNodeIds: Set<string>
): FabricGraphResponse {
  const nodes = response.nodes || [];
  const edges = response.edges || [];
  
  // Filter nodes and edges
  const filteredNodes = nodes.filter((node: FabricNode) => reachableNodeIds.has(node.id));
  const filteredEdges = edges.filter(
    (edge: FabricEdge) => reachableNodeIds.has(edge.sourceId) && reachableNodeIds.has(edge.targetId)
  );
  
  // Filter instance maps
  const prodMap = response.prod_instances_map || {};
  const nonProdMap = response.non_prod_instances_map || {};
  const filteredProdMap: Record<string, string[]> = {};
  const filteredNonProdMap: Record<string, string[]> = {};
  
  for (const nodeId of reachableNodeIds) {
    if (prodMap[nodeId]) {
      filteredProdMap[nodeId] = prodMap[nodeId];
    }
    if (nonProdMap[nodeId]) {
      filteredNonProdMap[nodeId] = nonProdMap[nodeId];
    }
  }
  
  return {
    nodes: filteredNodes,
    edges: filteredEdges,
    prod_instances_map: filteredProdMap,
    non_prod_instances_map: filteredNonProdMap,
  };
}

/**
 * Filters a Visualizer API response to include only nodes reachable from a broker.
 * This filtering happens BEFORE canonical transformation, keeping canonical graphs pure.
 * 
 * Only shows nodes connected via runtime edges (activity-based).
 * If a broker has no runtime traffic, only the broker node will be shown.
 */
export function filterVisualizerByBroker(
  response: FabricGraphResponse,
  brokerAssetId: string
): FabricGraphResponse {
  const nodes = response.nodes || [];
  const edges = response.edges || [];
  
  // Debug: Log all broker nodes and their assetIds
  const allBrokers = nodes.filter((n: FabricNode) => n.type === "BROKER");
  console.log("[filterVisualizerByBroker] Looking for broker with assetId:", brokerAssetId);
  console.log("[filterVisualizerByBroker] Available brokers:", allBrokers.map((b: FabricNode) => ({ id: b.id, assetId: b.assetId, name: b.name })));
  
  // Find the broker node by assetId
  const brokerNode = nodes.find(
    (n: FabricNode) => n.type === "BROKER" && n.assetId === brokerAssetId
  );
  
  if (!brokerNode) {
    console.warn("[filterVisualizerByBroker] Broker not found! Searched for assetId:", brokerAssetId);
    console.warn("[filterVisualizerByBroker] Available broker assetIds:", allBrokers.map((b: FabricNode) => b.assetId));
    return { nodes: [], edges: [], prod_instances_map: {}, non_prod_instances_map: {} };
  }
  
  console.log("[filterVisualizerByBroker] Found broker node:", { id: brokerNode.id, assetId: brokerNode.assetId, name: brokerNode.name });
  
  // Use BFS to find reachable nodes via runtime edges (unidirectional: source → target only)
  // If no edges exist (no runtime traffic), only the broker node will be included
  const reachableNodeIds = findReachableNodes(nodes, edges, [brokerNode.id]);
  console.log("[filterVisualizerByBroker] Reachable node IDs:", Array.from(reachableNodeIds));
  
  const filtered = filterByReachableNodes(response, reachableNodeIds);
  console.log("[filterVisualizerByBroker] Filtered result:", { 
    nodes: filtered.nodes?.length ?? 0, 
    edges: filtered.edges?.length ?? 0,
    nodeIds: filtered.nodes?.map((n: FabricNode) => n.id) ?? []
  });
  
  return filtered;
}

/**
 * Filters Visualizer response to show ALL brokers and their recursive stacks.
 * Finds all BROKER nodes and includes all nodes reachable from each broker.
 * This is what "All" means - all brokers with their complete dependency trees.
 */
export function filterVisualizerAllBrokers(response: FabricGraphResponse): FabricGraphResponse {
  const nodes = response.nodes || [];
  
  // Find all BROKER nodes
  const brokerNodes = nodes.filter((n: FabricNode) => n.type === "BROKER");

  if (brokerNodes.length === 0) {
    return { nodes: [], edges: [], prod_instances_map: {}, non_prod_instances_map: {} };
  }

  const brokerNodeIds = brokerNodes.map((n: FabricNode) => n.id);
  const reachableNodeIds = findReachableNodes(nodes, response.edges || [], brokerNodeIds);
  
  return filterByReachableNodes(response, reachableNodeIds);
}

/**
 * Extracts assetId from brokerKey format.
 * brokerKey: "orgId-assetId" → returns "assetId"
 */
export function extractAssetIdFromBrokerKey(brokerKey: string): string {
  // brokerKey format: "orgId-assetId"
  // Find UUID pattern and extract everything after it
  const uuidPattern = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const match = brokerKey.match(uuidPattern);
  
  if (match && match.index !== undefined) {
    // Extract assetId (everything after UUID and the "-")
    return brokerKey.substring(match.index + match[0].length + 1);
  }
  
  // Fallback: return everything after first UUID-like pattern or return as-is
  const parts = brokerKey.split("-");
  return parts.length > 1 ? parts.slice(1).join("-") : brokerKey;
}
