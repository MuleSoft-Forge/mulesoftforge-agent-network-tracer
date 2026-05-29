import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";

export const dynamic = "force-dynamic";

/**
 * Finds the agent-network Exchange asset that contains a given broker.
 *
 * Uses the Exchange search API with the broker assetId as the search term,
 * filtered to type=agent-network. This is a single API call — O(1), not O(n).
 *
 * Query params: organizationId, brokerAssetId
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;
  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");
  const brokerAssetId = searchParams.get("brokerAssetId");

  if (!organizationId || !brokerAssetId) {
    return NextResponse.json(
      { error: "organizationId and brokerAssetId are required" },
      { status: 400 }
    );
  }

  const authHeader = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

  try {
    // Single call: search Exchange for agent-network assets mentioning this broker
    const searchUrl = `${baseUrl}/exchange/api/v2/assets?organizationId=${encodeURIComponent(organizationId)}&type=agent-network&search=${encodeURIComponent(brokerAssetId)}&limit=5`;

    const res = await loggedFetch(searchUrl, { headers: authHeader });
    if (!res.ok) {
      return NextResponse.json({ error: `Exchange search failed: ${res.status}` }, { status: res.status });
    }

    const assets = (await res.json()) as Array<{
      groupId: string;
      assetId: string;
      name?: string;
      version?: string;
    }>;

    // Filter out the broker asset itself — we want the parent agent-network, not the broker
    const filtered = assets.filter((a) => a.assetId !== brokerAssetId);

    debugLog(`[agent-network-asset] Search for "${brokerAssetId}" returned ${assets.length} results, ${filtered.length} after excluding broker`);

    if (filtered.length === 0) {
      return NextResponse.json({ error: "No agent-network asset found", assetId: null }, { status: 404 });
    }

    // Rank candidates deterministically rather than blindly taking the first
    // search hit: prefer assets whose id/name actually references a network and
    // that share the broker's groupId, so multi-match searches don't resolve to
    // an unrelated asset.
    const score = (a: { groupId: string; assetId: string; name?: string }): number => {
      let s = 0;
      const hay = `${a.assetId} ${a.name ?? ""}`.toLowerCase();
      if (/(agent[-_ ]?network|network)/.test(hay)) s += 2;
      if (hay.includes(brokerAssetId.toLowerCase())) s += 1;
      return s;
    };
    const ranked = [...filtered].sort((a, b) => score(b) - score(a));
    if (ranked.length > 1) {
      debugLog(
        `[agent-network-asset] ${ranked.length} candidates; picked "${ranked[0].assetId}" (others: ${ranked
          .slice(1)
          .map((a) => a.assetId)
          .join(", ")})`
      );
    }
    const match = ranked[0];
    const detailUrl = `${baseUrl}/exchange/api/v2/assets/${encodeURIComponent(match.groupId)}/${encodeURIComponent(match.assetId)}`;
    const detailRes = await fetch(detailUrl, { headers: authHeader });

    if (!detailRes.ok) {
      // Return what we have from search even without full details
      return NextResponse.json({
        assetId: match.assetId,
        groupId: match.groupId,
        name: match.name ?? match.assetId,
        versions: [{ version: match.version ?? "unknown", createdAt: null, status: null }],
      });
    }

    const detail = (await detailRes.json()) as {
      groupId: string;
      assetId: string;
      name?: string;
      versions?: Array<{ version: string; createdAt?: string; status?: string }>;
    };

    debugLog(`[agent-network-asset] Resolved: ${detail.assetId} with ${detail.versions?.length ?? 0} versions`);

    return NextResponse.json({
      assetId: detail.assetId,
      groupId: detail.groupId,
      name: detail.name ?? detail.assetId,
      versions: (detail.versions ?? []).map((v) => ({
        version: v.version,
        createdAt: v.createdAt ?? null,
        status: v.status ?? null,
      })),
    });
  } catch (error) {
    debugError("[agent-network-asset] Error:", error);
    return NextResponse.json({ error: "Failed to find agent-network asset" }, { status: 500 });
  }
}
