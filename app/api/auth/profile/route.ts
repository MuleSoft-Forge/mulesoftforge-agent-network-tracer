import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";
import { orgIdsHaveOpsAccess } from "@/lib/ops/access";

export async function GET(request: NextRequest) {
  // requireAuth (not isAuthenticated) so a token near expiry is refreshed before
  // we call Anypoint with it. This route is under /api/auth/* so middleware
  // does not gate it.
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { baseUrl, accessToken } = authResult;

  try {
    const res = await loggedFetch(`${baseUrl}/accounts/api/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Profile failed: ${res.status}` },
        { status: res.status }
      );
    }

    const profile = await res.json();

    // Resolved here so the allowlist stays server-side; Header only sees a boolean.
    const orgIds: string[] = [
      profile?.organization?.id,
      ...(Array.isArray(profile?.memberOfOrganizations)
        ? profile.memberOfOrganizations.map((org: { id?: string }) => org?.id)
        : []),
    ].filter((id): id is string => typeof id === "string" && id.length > 0);

    return NextResponse.json({ ...profile, opsAccess: orgIdsHaveOpsAccess(orgIds) });
  } catch (error) {
    debugError("Profile fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}
