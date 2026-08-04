import { NextRequest, NextResponse } from "next/server";
import { debugError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";
import { fetchDeploymentTargets } from "@/lib/mulesoft/deployment-targets";

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
    const data = await fetchDeploymentTargets(baseUrl, orgId, envId, accessToken);
    return NextResponse.json({ data, total: data.length });
  } catch (error) {
    debugError("[DEPLOYMENT-TARGETS] Fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch deployment targets", data: [] }, { status: 500 });
  }
}
