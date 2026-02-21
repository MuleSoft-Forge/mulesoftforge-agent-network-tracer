import type { CanonicalEdge, CanonicalGraph, CanonicalNode } from "@/lib/agent-network-types";
import { debugWarn } from "@/lib/api-logger";

/**
 * LLM reference from Exchange API metadata
 */
interface LLMRef {
  groupId: string;
  assetId: string;
  version: string;
}

/**
 * Exchange metadata response structure
 */
interface ExchangeMetadataResponse {
  metadata?: {
    card?: {
      name?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  llm: LLMRef | null;
  connections?: Array<{
    kind: string;
    ref: LLMRef;
    [key: string]: unknown;
  }>;
}

/**
 * Enriches a canonical graph with LLM nodes and edges by fetching Exchange metadata
 * for each BROKER node and adding LLM connections.
 * 
 * @param graph - The canonical graph to enrich
 * @param orgId - Organization ID for Exchange API calls
 * @returns Enriched canonical graph with LLM nodes and edges
 */
export async function enrichCanonicalWithLLMs(
  graph: CanonicalGraph,
  orgId: string
): Promise<CanonicalGraph> {
  const enrichedNodes = [...graph.nodes];
  const enrichedEdges = [...graph.edges];
  const existingNodeIds = new Set(graph.nodes.map((n: CanonicalNode) => n.id));

  // Find all BROKER nodes
  const brokerNodes = graph.nodes.filter((n: CanonicalNode) => n.type === "BROKER");

  // Fetch LLM metadata for each broker in parallel
  const llmPromises = brokerNodes.map(async (broker: CanonicalNode) => {
    try {
      // Extract assetId and organizationId from broker node (node.id format is "orgId:assetId")
      let brokerOrgId = broker.organizationId;
      let assetId = broker.id;
      
      if (broker.id.includes(":")) {
        const parts = broker.id.split(":");
        brokerOrgId = parts[0] || broker.organizationId;
        assetId = parts.slice(1).join(":");
      }
      
      const version = broker.version || "0.0.0";

      // Fetch Exchange metadata for this broker version (use broker's orgId, fallback to passed orgId)
      const metadataOrgId = brokerOrgId || orgId;
      const response = await fetch(
        `/api/exchange/metadata?organizationId=${encodeURIComponent(metadataOrgId)}&assetId=${encodeURIComponent(assetId)}&version=${encodeURIComponent(version)}`
      );

      if (!response.ok) {
        debugWarn(`Failed to fetch LLM metadata for broker ${broker.id}: ${response.status}`);
        return null;
      }

      const data = (await response.json()) as ExchangeMetadataResponse;
      return {
        broker,
        llm: data.llm,
      };
    } catch (error) {
      debugWarn(`Error fetching LLM metadata for broker ${broker.id}:`, error);
      return null;
    }
  });

  const llmResults = await Promise.all(llmPromises);

  // Process LLM results and add nodes/edges
  for (const result of llmResults) {
    if (!result || !result.llm) continue;

    const { broker, llm } = result;

    // Create LLM node ID (format: "orgId:assetId" to match canonical format)
    const llmNodeId = `${llm.groupId}:${llm.assetId}`;

    // Add LLM node if it doesn't exist
    if (!existingNodeIds.has(llmNodeId)) {
      // Fetch LLM asset metadata to get icon and name
      let llmName = llm.assetId;
      let llmIcon: string | undefined = undefined;

      try {
        const assetResponse = await fetch(
          `/api/exchange/asset?organizationId=${encodeURIComponent(llm.groupId)}&assetId=${encodeURIComponent(llm.assetId)}&version=${encodeURIComponent(llm.version)}`
        );

        if (assetResponse.ok) {
          const assetData = (await assetResponse.json()) as {
            name?: string;
            organizationId?: string;
            groupId?: string;
            files?: Array<{
              classifier?: string;
              packaging?: string;
              downloadURL?: string;
              [key: string]: unknown;
            }>;
            [key: string]: unknown;
          };

          // Extract name
          if (assetData.name) {
            llmName = assetData.name;
          }

          // Extract icon path from files array (classifier === "icon")
          // Build icon path using the same pattern as other assets:
          // /exchange/files/api/v1/organizations/{orgId}/assets/{groupId}/{assetId}/{classifier}/{packaging}
          const iconFile = assetData.files?.find(
            (f) => f.classifier?.toLowerCase() === "icon"
          );
          if (iconFile?.classifier && iconFile?.packaging) {
            // Use organizationId from asset if available, otherwise fall back to llm.groupId
            // groupId from asset if available, otherwise use llm.groupId
            const orgIdForIcon = assetData.organizationId || llm.groupId;
            const groupIdForIcon = assetData.groupId || llm.groupId;
            llmIcon = `/exchange/files/api/v1/organizations/${encodeURIComponent(orgIdForIcon)}/assets/${encodeURIComponent(groupIdForIcon)}/${encodeURIComponent(llm.assetId)}/${encodeURIComponent(iconFile.classifier)}/${encodeURIComponent(iconFile.packaging)}`;
          }
        }
      } catch (error) {
        debugWarn(`Error fetching LLM asset metadata for ${llmNodeId}:`, error);
        // Continue without icon if fetch fails
      }

      const llmNode: CanonicalNode = {
        id: llmNodeId,
        label: llmName,
        version: llm.version,
        type: "LLM",
        organizationId: llm.groupId,
        position: { x: 0, y: 0 }, // Layout will position it
        exchangeAssetId: llm.assetId,
        ...(llmIcon ? { icon: llmIcon } : {}),
      };
      enrichedNodes.push(llmNode);
      existingNodeIds.add(llmNodeId);
    }

    // Add edge from broker to LLM
    const edgeId = `${broker.id}->${llmNodeId}`;
    const edgeExists = enrichedEdges.some(
      (e: CanonicalEdge) => e.source === broker.id && e.target === llmNodeId
    );

    if (!edgeExists) {
      const llmEdge: CanonicalEdge = {
        id: edgeId,
        source: broker.id,
        target: llmNodeId,
        type: "designTime", // LLM connection is design-time (from Exchange metadata)
      };
      enrichedEdges.push(llmEdge);
    }
  }

  return {
    nodes: enrichedNodes,
    edges: enrichedEdges,
    mode: graph.mode,
  };
}
