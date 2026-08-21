import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { ExchangeAssetRequestSchema } from "@/lib/schemas";
import { requireAuth } from "@/lib/api/auth-middleware";
import { parseExchangeParams } from "@/lib/api/exchange-params";
import { validationError } from "@/lib/api/error-responses";

export const dynamic = "force-dynamic";

/**
 * Fetches asset details from Exchange API for a specific version.
 * Returns asset information including name, files (with icon), etc.
 * 
 * Endpoint: GET /exchange/api/v2/assets/{organizationId}/{assetId}/{version}
 */
export async function GET(request: NextRequest) {
  // Authentication check
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  
  const { baseUrl, accessToken } = authResult;

  // Validate and parse query parameters
  const { searchParams } = new URL(request.url);
  let params: { organizationId: string; assetId: string; version: string };
  
  try {
    params = parseExchangeParams(searchParams, ExchangeAssetRequestSchema);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Invalid request")) {
      // Parse the error to get Zod error details
      const parseResult = ExchangeAssetRequestSchema.safeParse({
        organizationId: searchParams.get("organizationId") ?? undefined,
        assetId: searchParams.get("assetId") ?? undefined,
        version: searchParams.get("version") ?? undefined,
        path: searchParams.get("path") ?? undefined,
      });
      if (!parseResult.success) {
        return validationError(parseResult.error);
      }
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 }
    );
  }

  const { organizationId, assetId, version } = params;
  const url = `${baseUrl}/exchange/api/v2/assets/${encodeURIComponent(organizationId)}/${encodeURIComponent(assetId)}/${encodeURIComponent(version)}`;

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
    return NextResponse.json(assetData);
  } catch (error) {
    debugError("Exchange asset fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch asset from Exchange" },
      { status: 500 }
    );
  }
}
