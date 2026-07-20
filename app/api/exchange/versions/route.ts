import { NextRequest, NextResponse } from "next/server";
import { debugError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";
import { fetchExchangeAssetViaGraphQL } from "@/lib/mulesoft/exchange-graphql";

export const dynamic = "force-dynamic";

/**
 * Fetches all versions of an Exchange asset via the Graph API.
 *
 * `GET /exchange/api/v2/assets/{groupId}/{assetId}` (no version) is not a real
 * endpoint — only DELETE/PATCH exist there. MuleSoft's own CLI
 * (anypoint-cli-agent-fabric-plugin) resolves every version through
 * `POST /graph/api/v2/graphql`'s `asset(...).otherVersions`, which is what
 * this route does too.
 *
 * Query params: organizationId (asset groupId), assetId
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

  try {
    const asset = await fetchExchangeAssetViaGraphQL(baseUrl, organizationId, assetId, accessToken);

    if (!asset) {
      return NextResponse.json(
        { error: "Asset not found in Exchange" },
        { status: 404 }
      );
    }

    const versions = [
      { version: asset.version, createdAt: null, status: asset.status ?? null },
      ...asset.otherVersions
        .filter((v) => v.version !== asset.version)
        .map((v) => ({ version: v.version, createdAt: null, status: null })),
    ];

    return NextResponse.json({
      organizationId,
      assetId,
      name: asset.name ?? assetId,
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
