/**
 * Helper to get access token from session for API routes
 */

import { NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/session";

/**
 * Get access token from session
 * Returns token if authenticated and not expired, null otherwise
 * Also checks for server-side invalidation (for corporate governance compliance)
 */
export async function getAccessToken(request: NextRequest): Promise<string | null> {
  try {
    const session = await getIronSession<SessionData>(
      await cookies(),
      sessionOptions
    );

    // Check if session was invalidated (server-side invalidation for corporate governance)
    // Even if browser doesn't delete cookie, server will reject invalidated sessions
    if (session.invalidatedAt) {
      return null;
    }

    if (!session.accessToken) {
      return null;
    }

    // Check if token is expired
    if (session.expiresAt && session.expiresAt <= Date.now()) {
      return null;
    }

    return session.accessToken;
  } catch {
    return null;
  }
}
