import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ orgId: string }> }
) {
  // requireAuth (not isAuthenticated) so a token near expiry is refreshed
  // before we call Anypoint with it.
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { baseUrl, accessToken } = authResult;

  const { orgId } = await context.params;
  if (!orgId || orgId.length === 0) {
    return NextResponse.json(
      { error: "Organization ID required" },
      { status: 400 }
    );
  }

  const url = `${baseUrl}/accounts/api/organizations/${encodeURIComponent(orgId)}/environments`;

  try {
    const res = await loggedFetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Environments failed: ${res.status} ${text}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    debugError("[ENVIRONMENTS] Fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch environments" },
      { status: 500 }
    );
  }
}
