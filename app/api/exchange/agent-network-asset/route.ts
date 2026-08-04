import { NextRequest, NextResponse } from "next/server";
import { debugLog, debugError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";
import { EXCHANGE_SEARCH_TYPES, searchExchangeAssets } from "@/lib/mulesoft/exchange-search";
import { fetchExchangeAssetViaGraphQL } from "@/lib/mulesoft/exchange-graphql";

export const dynamic = "force-dynamic";

/**
 * Finds the agent-network Exchange asset that contains a given broker.
 *
 * Searches via pseas/ang (the real endpoints behind Exchange's own search —
 * see lib/mulesoft/exchange-search.ts) filtered to type `agent-network`, then
 * resolves the winning hit's full version list via the Graph API. Returns the
 * parent network asset, not the broker asset itself.
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

  const authHeader = { Authorization: `Bearer ${accessToken}` };

  try {
    const { hits: assets, attempt } = await searchExchangeAssets(
      baseUrl,
      organizationId,
      brokerAssetId,
      authHeader,
      fetch,
      [EXCHANGE_SEARCH_TYPES.AGENT_NETWORK]
    );

    debugLog(
      `[agent-network-asset] Search for "${brokerAssetId}" via ${attempt} returned ${assets.length} results`
    );

    const filtered = assets.filter((a) => a.assetId !== brokerAssetId);

    debugLog(
      `[agent-network-asset] ${filtered.length} after excluding broker asset`
    );

    if (filtered.length === 0) {
      return NextResponse.json({ error: "No agent-network asset found", assetId: null }, { status: 404 });
    }

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
    // There is no documented/working GET for "asset, no version" on the REST
    // surface — resolve the full version list via the Graph API instead, the
    // same way MuleSoft's own CLI does (see lib/mulesoft/exchange-graphql.ts).
    const asset = await fetchExchangeAssetViaGraphQL(baseUrl, match.groupId, match.assetId, accessToken);

    if (!asset) {
      return NextResponse.json({
        assetId: match.assetId,
        groupId: match.groupId,
        name: match.name ?? match.assetId,
        versions: [{ version: match.version ?? "unknown", createdAt: null, status: null }],
        searchAttempt: attempt,
      });
    }

    const versions = [
      { version: asset.version, createdAt: null, status: asset.status ?? null },
      ...asset.otherVersions
        .filter((v) => v.version !== asset.version)
        .map((v) => ({ version: v.version, createdAt: null, status: null })),
    ];

    debugLog(`[agent-network-asset] Resolved: ${asset.assetId} with ${versions.length} versions`);

    return NextResponse.json({
      assetId: asset.assetId,
      groupId: asset.groupId,
      name: asset.name || match.name || match.assetId,
      versions,
      searchAttempt: attempt,
    });
  } catch (error) {
    debugError("[agent-network-asset] Error:", error);
    return NextResponse.json({ error: "Failed to find agent-network asset" }, { status: 500 });
  }
}
