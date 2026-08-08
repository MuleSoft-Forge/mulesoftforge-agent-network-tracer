/**
 * "Governed" asset detection for the Compose picker.
 *
 * When a customer governs a provider-managed (public MuleSoft) MCP/agent/LLM,
 * the resulting instance is registered in the customer's OWN org — it appears
 * as a node in the org-level Visualizer fabric-network, keyed by assetId. The
 * public Exchange asset itself never reports these instances.
 *
 * So to indicate which public assets a customer has governed, we read the
 * org-level fabric-network (no environment needed — same source the brokers
 * view already relies on) and collect the assetIds that resolve to real nodes.
 */

import type { FabricGraphResponse } from "@/lib/adapters/visualizer-to-canonical";

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Fetches the set of assetIds that are governed (deployed/registered) in the
 * caller's org, according to the Visualizer fabric-network. Returns an empty
 * set on any failure so callers can degrade gracefully (no badges rather than
 * an error).
 */
export async function fetchGovernedAssetIds(
  baseUrl: string,
  organizationId: string,
  authHeader: Record<string, string>,
  fetchFn: FetchFn = fetch
): Promise<Set<string>> {
  const url = `${baseUrl}/visualizer/api/v2/organizations/${encodeURIComponent(organizationId)}/fabric-network`;
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ orgIds: [organizationId] }),
    });
    if (!res.ok) return new Set();
    const body = (await res.json()) as FabricGraphResponse;
    const governed = new Set<string>();
    for (const node of body.nodes ?? []) {
      if (typeof node.assetId === "string" && node.assetId) {
        governed.add(node.assetId);
      }
    }
    return governed;
  } catch {
    return new Set();
  }
}
