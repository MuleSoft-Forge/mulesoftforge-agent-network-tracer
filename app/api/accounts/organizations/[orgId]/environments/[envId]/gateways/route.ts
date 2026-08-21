import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";
import {
  enrichManagedGatewaysWithTargetSpaces,
  parseManagedGatewaysResponse,
} from "@/lib/mulesoft/managed-gateways";
import type { ManagedGateway } from "@/lib/mulesoft/managed-gateways";

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

  try {
    // Match Runtime Manager UI first (xapi + kind=managed); fall back to api/v1.
    const urls = [
      `${baseUrl}/gatewaymanager/xapi/v1/organizations/${encodeURIComponent(orgId)}` +
        `/environments/${encodeURIComponent(envId)}/gateways?kind=managed&pageNumber=0&pageSize=100`,
      `${baseUrl}/gatewaymanager/xapi/v1/organizations/${encodeURIComponent(orgId)}` +
        `/environments/${encodeURIComponent(envId)}/gateways?pageNumber=0&pageSize=100`,
      `${baseUrl}/gatewaymanager/api/v1/organizations/${encodeURIComponent(orgId)}` +
        `/environments/${encodeURIComponent(envId)}/gateways?pageSize=100`,
    ];

    let listed: ManagedGateway[] = [];
    let lastFailure: { status: number; text: string } | null = null;
    for (const url of urls) {
      const res = await loggedFetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        lastFailure = { status: res.status, text: await res.text() };
        continue;
      }

      const body = await res.json();
      listed = parseManagedGatewaysResponse(body);
      if (listed.length > 0) break;
    }

    if (listed.length === 0 && lastFailure) {
      return NextResponse.json(
        { error: `Gateways failed: ${lastFailure.status} ${lastFailure.text}`, data: [] },
        { status: lastFailure.status }
      );
    }
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
