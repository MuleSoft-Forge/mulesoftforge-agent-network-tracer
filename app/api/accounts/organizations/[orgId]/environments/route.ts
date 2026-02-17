import { NextResponse } from "next/server";
import { getSession, isAuthenticated } from "@/lib/session";
import { loggedFetch, debugError } from "@/lib/api-logger";

const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";

export async function GET(
  _request: Request,
  context: { params: Promise<{ orgId: string }> }
) {
  // Authentication check
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  
  const session = await getSession();
  
  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { orgId } = await context.params;
  if (!orgId || orgId.length === 0) {
    return NextResponse.json(
      { error: "Organization ID required" },
      { status: 400 }
    );
  }

  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${baseUrl}/accounts/api/organizations/${encodeURIComponent(orgId)}/environments`;

  try {
    const res = await loggedFetch(url, {
      headers: { Authorization: `Bearer ${session.accessToken}` }
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
