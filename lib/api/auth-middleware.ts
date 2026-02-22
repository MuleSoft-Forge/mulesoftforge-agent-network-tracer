import { NextRequest, NextResponse } from "next/server";
import { getSession, isAuthenticated, type SessionData } from "@/lib/session";
import type { IronSession } from "iron-session";
import { DEFAULT_BASE_URL } from "@/lib/constants";

export interface AuthenticatedSession {
  session: IronSession<SessionData>;
  baseUrl: string;
  accessToken: string;
}

/**
 * Middleware to authenticate API routes
 * Returns authenticated session or error response
 */
export async function requireAuth(
  request: NextRequest
): Promise<NextResponse | AuthenticatedSession> {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const session = await getSession();

  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  return {
    session,
    baseUrl: session.baseUrl ?? DEFAULT_BASE_URL,
    accessToken: session.accessToken,
  };
}
