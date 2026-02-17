/**
 * Session management using iron-session
 * Stores OAuth tokens securely in encrypted HTTP-only cookies
 */

import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import type { IronSession } from "iron-session";

export interface SessionData {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  oauthState?: string; // Temporary state for OAuth CSRF protection
}

const sessionOptions = {
  password: process.env.SESSION_SECRET || "",
  cookieName: "ant_session", // Agent Network Tracer - unique name to avoid conflicts with Anypoint cookies
  ttl: 90 * 24 * 60 * 60, // 90 days (matches refresh token lifetime)
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    // No domain specified - uses current domain (won't interfere with anypoint.mulesoft.com cookies)
  },
};

/**
 * Get the current session
 * Returns session data or empty session if not authenticated
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  return session;
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = await getSession();
  return !!(session.accessToken && session.expiresAt && session.expiresAt > Date.now());
}
