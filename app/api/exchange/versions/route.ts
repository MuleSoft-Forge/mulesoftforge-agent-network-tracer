import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";

export const dynamic = "force-dynamic";

/**
 * Fetches all versions of an Exchange asset.
 * Uses the Exchange v2 search API to find all versions of a given asset.
 *
 * Query params: organizationId, assetId
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");
  const assetId = searchParams.get("assetId");

  if (!organizationId || !assetId) {
    return NextResponse.json(
      { error: "organizationId and assetId are required" },
      { status: 400 }
    );
  }

  const url = `${baseUrl}/exchange/api/v2/assets/${encodeURIComponent(organizationId)}/${encodeURIComponent(assetId)}`;

  try {
    const res = await loggedFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Exchange API failed: ${res.status} ${text.slice(0, 200)}` },
        { status: res.status }
      );
    }

    const assetData = await res.json();

    const versions = (assetData.versions ?? []).map(
      (v: {
        version: string;
        createdAt?: string;
        status?: string;
        [key: string]: unknown;
      }) => ({
        version: v.version,
        createdAt: v.createdAt ?? null,
        status: v.status ?? null,
      })
    );

    return NextResponse.json({
      organizationId,
      assetId,
      name: assetData.name ?? assetId,
      versions,
    });
  } catch (error) {
    debugError("Exchange versions fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch versions from Exchange" },
      { status: 500 }
    );
  }
}
