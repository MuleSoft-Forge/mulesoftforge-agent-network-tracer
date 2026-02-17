import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { sessionOptions, type SessionData } from "@/lib/session";

const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";

export async function GET() {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);

  // Check if session was invalidated (server-side invalidation for corporate governance)
  if (session.invalidatedAt) {
    return NextResponse.json(
      { error: "Session invalidated" },
      { status: 401 }
    );
  }

  if (!session.accessToken) {
    return NextResponse.json(
      { error: "Not signed in" },
      { status: 401 }
    );
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
