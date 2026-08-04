import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { DEFAULT_BASE_URL } from "@/lib/constants";
import { EXCHANGE_SURFACES } from "@/lib/mulesoft/exchange-surfaces";
import { runExchangeProbes } from "@/lib/mulesoft/exchange-probe";

export const dynamic = "force-dynamic";

/**
 * **Local development only.** Compare Exchange v2 catalog lookups vs Maven facade
 * for broker-related asset IDs (metadata.source GAV vs broker assetId).
 *
 * Usage:
 *   /api/auth/debug/exchange-probe?orgId=<uuid>&brokerAssetId=agent_broker_get_date
 *   /api/auth/debug/exchange-probe?orgId=<uuid>&apiInstanceId=21033824&envId=<uuid>
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await getSession();
  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const accessToken = session.accessToken;
  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
  const orgId = req.nextUrl.searchParams.get("orgId") ?? "";
  let brokerAssetId = req.nextUrl.searchParams.get("brokerAssetId") ?? undefined;
  const apiInstanceId = req.nextUrl.searchParams.get("apiInstanceId") ?? "";
  const envId = req.nextUrl.searchParams.get("envId") ?? "";

  if (!orgId) {
    return NextResponse.json({ error: "orgId required" }, { status: 400 });
  }

  let metadataSource: string | null = null;
  let rmApiInstance: unknown = null;

  if (apiInstanceId && envId) {
    const rmUrl = `${baseUrl}/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiInstanceId}`;
    const rmRes = await fetch(rmUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (rmRes.ok) {
      rmApiInstance = await rmRes.json();
      const body = rmApiInstance as {
        assetId?: string;
        metadata?: { source?: string };
      };
      metadataSource = body.metadata?.source ?? null;
      if (!brokerAssetId && body.assetId) brokerAssetId = body.assetId;
    }
  }

  if (!brokerAssetId && !metadataSource) {
    return NextResponse.json(
      {
        error:
          "Provide brokerAssetId and/or apiInstanceId+envId so we can resolve metadata.source",
      },
      { status: 400 }
    );
  }

  const probe = await runExchangeProbes({
    baseUrl,
    orgId,
    accessToken,
    brokerAssetId,
    metadataSource,
  });

  const v2Hits = probe.v2AssetLookups.filter((p) => p.ok);
  const mavenHits = probe.mavenProbes.filter((p) => p.ok);
  const searchHits = probe.v2Searches.filter((p) => p.ok && (p.hitCount ?? 0) > 0);

  return NextResponse.json({
    params: { orgId, brokerAssetId: brokerAssetId ?? null, apiInstanceId: apiInstanceId || null, envId: envId || null },
    surfaces: EXCHANGE_SURFACES,
    rmApiInstance,
    metadataSource,
    summary: {
      v2CatalogHits: v2Hits.map((p) => p.label),
      mavenHits: mavenHits.map((p) => p.label),
      searchHits: searchHits.map((p) => ({ label: p.label, hitCount: p.hitCount, sample: p.sample })),
      likelyResolution:
        v2Hits.length > 0
          ? "Use Exchange v2 groupId/assetId from a successful v2 lookup (often broker assetId, not metadata.source name)."
          : mavenHits.length > 0
            ? "Asset exists on Maven facade only — use maven-files route, not Exchange versions API."
            : "No Exchange or Maven hit — asset may be undeployed from catalog or use a different groupId.",
    },
    notes: probe.notes,
    candidates: probe.candidates,
    v2AssetLookups: probe.v2AssetLookups,
    v2Searches: probe.v2Searches,
    mavenProbes: probe.mavenProbes,
  });
}
