import type { FabricGraphResponse, FabricEdge } from "@/lib/adapters/visualizer-to-canonical";
import { debugWarn } from "@/lib/api-logger";

/**
 * Activity period options (in minutes) matching MuleSoft Visualizer UI:
 * - Last 5 minutes = 5 minutes
 * - Last 15 minutes = 15 minutes
 * - Last 30 minutes = 30 minutes
 * - Last 60 minutes = 60 minutes (1 hour)
 * - Last 24 hours = 1440 minutes
 * - Last 3 days = 4320 minutes  
 * - Last 5 days = 7200 minutes
 * - Last 7 days = 10080 minutes (maximum - Visualizer API hard limit)
 * 
 * Note: Visualizer runtime-edges API enforces a 7-day maximum limit server-side.
 * Tasks API uses _msearch (Anypoint Monitoring logs) but we apply the same 7-day
 * limit for consistency and to match Visualizer UI behavior.
 */
export const ACTIVITY_PERIODS = {
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "60m": 60,
  "24h": 1440,
  "3d": 4320,
  "5d": 7200,
  "7d": 10080,
} as const;

export type ActivityPeriod = keyof typeof ACTIVITY_PERIODS;

export type Environment = "production" | "sandbox";

/**
 * Runtime edges request payload structure.
 * 
 * Payload breakdown:
 * - `assets`: Array of assets with their deployed instances
 *   - Each asset has:
 *     - `id`: Node ID (e.g., "orgId:assetId")
 *     - `instances`: Array of instance IDs
 *   - Only assets with instances are included
 *   - Built dynamically from fabric-network response
 * 
 * - `activityPeriod`: Time window in minutes for edge detection
 *   - Default: 1440 (24 hours)
 *   - Configurable based on user selection
 */
export interface RuntimeEdgesRequest {
  assets: Array<{
    id: string;
    instances: string[];
  }>;
  activityPeriod: number; // minutes
}

export interface RuntimeEdgesResponse {
  edges: FabricEdge[];
}

/**
 * Builds the runtime edges request payload from a fabric-network response.
 * 
 * Logic:
 * 1. Extract nodes of type BROKER, AGENT, or MCP
 * 2. Map each node to {id, instances} using instance maps
 * 3. Filter based on environment (prod or non-prod)
 * 4. Filter out assets with no instances
 * 5. Return payload with configurable activityPeriod
 */
export function buildRuntimeEdgesPayload(
  fabricNetworkResponse: FabricGraphResponse,
  activityPeriodMinutes: number = ACTIVITY_PERIODS["24h"],
  environment: Environment = "production"
): RuntimeEdgesRequest | null {
  const nodes = fabricNetworkResponse.nodes ?? [];
  const prodMap = fabricNetworkResponse.prod_instances_map ?? {};
  const nonProdMap = fabricNetworkResponse.non_prod_instances_map ?? {};

  // Build assets array: filter nodes, extract instances based on environment, filter empty
  type FabricNode = (typeof nodes)[number];
  const assets = nodes
    .filter((node: FabricNode) => node.type === "BROKER" || node.type === "AGENT" || node.type === "MCP")
    .map((node: FabricNode) => {
      const nodeId = node.id;
      // Combine instances based on environment filter
      const instances: string[] = [];
      if (environment === "production") {
        instances.push(...(prodMap[nodeId] ?? []));
      }
      if (environment === "sandbox") {
        instances.push(...(nonProdMap[nodeId] ?? []));
      }
      return {
        id: nodeId,
        instances,
      };
    })
    .filter((asset: { id: string; instances: string[] }) => asset.instances.length > 0);

  // Return null if no assets with instances
  if (assets.length === 0) {
    return null;
  }

  return {
    assets,
    activityPeriod: activityPeriodMinutes,
  };
}

/**
 * Fetches runtime edges from the Visualizer API and merges them into the fabric-network response.
 * 
 * @param orgId - Organization ID for the API path
 * @param fabricNetworkResponse - The fabric-network response to enrich with edges
 * @param activityPeriodMinutes - Time window for edge detection (default: 1440 = 24 hours)
 * @param environment - Environment filter: "production" or "sandbox" (default: "production")
 * @returns Updated fabric-network response with merged edges, or original if fetch fails
 */
export async function fetchAndMergeRuntimeEdges(
  orgId: string,
  fabricNetworkResponse: FabricGraphResponse,
  activityPeriodMinutes: number = ACTIVITY_PERIODS["24h"],
  environment: Environment = "production"
): Promise<FabricGraphResponse> {
  // Build payload
  const payload = buildRuntimeEdgesPayload(fabricNetworkResponse, activityPeriodMinutes, environment);
  
  if (!payload) {
    // No assets with instances, return original response
    return fabricNetworkResponse;
  }

  try {
    const url = `/api/visualizer/v2/organizations/${orgId}/fabric-network/runtime-edges`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      debugWarn(`Failed to fetch runtime edges: ${response.status} ${response.statusText}`);
      return fabricNetworkResponse;
    }

    const runtimeEdgesData = (await response.json()) as RuntimeEdgesResponse;
    const runtimeEdges = runtimeEdgesData.edges ?? [];
    const designTimeEdges = fabricNetworkResponse.edges ?? [];

    // Create a map of runtime edges by ID for quick lookup
    const runtimeEdgeMap = new Map<string, FabricEdge>();
    for (const edge of runtimeEdges) {
      runtimeEdgeMap.set(edge.id, edge);
    }

    // Merge edges: keep design-time edges, but replace with runtime edges if they exist
    // Runtime edges take precedence because they have throughput data
    const mergedEdges: FabricEdge[] = [];
    const addedEdgeIds = new Set<string>();

    // First, add all runtime edges (they take precedence)
    for (const edge of runtimeEdges) {
      mergedEdges.push(edge);
      addedEdgeIds.add(edge.id);
    }

    // Then, add design-time edges that don't have runtime equivalents
    for (const edge of designTimeEdges) {
      if (!addedEdgeIds.has(edge.id)) {
        mergedEdges.push(edge);
        addedEdgeIds.add(edge.id);
      }
    }

    // Merge runtime edges into fabric-network response
    return {
      ...fabricNetworkResponse,
      edges: mergedEdges,
    };
  } catch (err) {
    debugWarn("Error fetching runtime edges, continuing without them:", err);
    return fabricNetworkResponse;
  }
}
