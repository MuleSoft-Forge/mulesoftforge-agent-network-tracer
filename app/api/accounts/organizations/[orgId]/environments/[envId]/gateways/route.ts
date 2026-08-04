import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";
import {
  enrichManagedGatewaysWithTargetSpaces,
  parseManagedGatewaysResponse,
} from "@/lib/mulesoft/managed-gateways";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ orgId: string; envId: string }> }
) {
  // requireAuth (not isAuthenticated) so a token near expiry is refreshed
  // before we call Anypoint with it.
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { baseUrl, accessToken } = authResult;

  const { orgId, envId } = await context.params;
  if (!orgId?.length || !envId?.length) {
    return NextResponse.json({ error: "Organization and environment IDs required" }, { status: 400 });
  }

  const url =
    `${baseUrl}/gatewaymanager/api/v1/organizations/${encodeURIComponent(orgId)}` +
    `/environments/${encodeURIComponent(envId)}/gateways?pageSize=100`;

  try {
    const res = await loggedFetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Gateways failed: ${res.status} ${text}`, data: [] },
        { status: res.status }
      );
    }

    const body = await res.json();
    const listed = parseManagedGatewaysResponse(body);
    const data = await enrichManagedGatewaysWithTargetSpaces(
      baseUrl,
      orgId,
      envId,
      listed,
      accessToken,
      (url, init) => loggedFetch(url, init)
    );
    return NextResponse.json({ data, total: data.length });
  } catch (error) {
    debugError("[GATEWAYS] Fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch gateways", data: [] }, { status: 500 });
  }
}
