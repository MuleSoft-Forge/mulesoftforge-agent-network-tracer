import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { sessionOptions, type SessionData } from "@/lib/session";

export const dynamic = "force-dynamic";

const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";

/**
 * Fetches asset details from Exchange API for a specific version.
 * Returns asset information including name, files (with icon), etc.
 * 
 * Endpoint: GET /exchange/api/v2/assets/{organizationId}/{assetId}/{version}
 */
export async function GET(request: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);

  if (session.invalidatedAt) {
    return NextResponse.json({ error: "Session invalidated" }, { status: 401 });
  }

  if (!session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");
  const assetId = searchParams.get("assetId");
  const version = searchParams.get("version");

  if (!organizationId || !assetId || !version) {
    return NextResponse.json(
      { error: "organizationId, assetId, and version are required" },
      { status: 400 }
    );
  }

  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${baseUrl}/exchange/api/v2/assets/${encodeURIComponent(organizationId)}/${encodeURIComponent(assetId)}/${encodeURIComponent(version)}`;

  try {
    const res = await loggedFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
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
