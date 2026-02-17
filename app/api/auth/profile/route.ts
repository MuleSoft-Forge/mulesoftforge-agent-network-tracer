import { NextResponse } from "next/server";
import { getSession, isAuthenticated } from "@/lib/session";
import { loggedFetch, debugError } from "@/lib/api-logger";

const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";

export async function GET() {
  // Authentication check
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  
  const session = await getSession();
  
  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;

  try {
    const res = await loggedFetch(`${baseUrl}/accounts/api/profile`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Profile failed: ${res.status} ${text}` },
        { status: res.status }
      );
    }

    const profile = await res.json();
    return NextResponse.json(profile);
  } catch (error) {
    debugError("Profile fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}
