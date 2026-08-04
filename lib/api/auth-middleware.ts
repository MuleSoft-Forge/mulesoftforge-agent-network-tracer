import { NextRequest, NextResponse } from "next/server";
import { getSession, type SessionData } from "@/lib/session";
import type { IronSession } from "iron-session";
import { DEFAULT_BASE_URL } from "@/lib/constants";
import { refreshAccessToken } from "@/lib/auth/oauth";
import { debugError, debugLog } from "@/lib/api-logger";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export interface AuthenticatedSession {
  session: IronSession<SessionData>;
  baseUrl: string;
  accessToken: string;
}

/**
 * Authenticate an API route. If the access token is within the refresh buffer
 * and a refresh token is present, we refresh transparently and persist the new
 * token on the session before returning — so long-lived iron-session cookies
 * (90-day cookie, hours-long access tokens) stay useful.
 */
export async function requireAuth(
  _request: NextRequest
): Promise<NextResponse | AuthenticatedSession> {
  const session = await getSession();

  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
  const expiresAt = session.expiresAt ?? 0;
  const needsRefresh = expiresAt <= Date.now() + REFRESH_BUFFER_MS;

  if (needsRefresh) {
    if (!session.refreshToken) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }
    try {
      const fresh = await refreshAccessToken(session.refreshToken, baseUrl);
      session.accessToken = fresh.accessToken;
      session.refreshToken = fresh.refreshToken;
      session.expiresAt = fresh.expiresAt;
      await session.save();
      debugLog("[auth] refreshed access token; new expiresAt=", fresh.expiresAt);
    } catch (err) {
      debugError("[auth] refresh failed:", err);
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }
  }

  return {
    session,
    baseUrl,
    accessToken: session.accessToken,
  };
}
