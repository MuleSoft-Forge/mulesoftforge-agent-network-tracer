import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/session";
import { getAuthorizationUrl } from "@/lib/auth/oauth";
import type { RegionId } from "@/lib/regions";

export const dynamic = "force-dynamic";

/**
 * Generate a random state string for CSRF protection
 */
function generateState(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function GET(request: Request) {
  // Check if already authenticated (using shared session config)
  const session = await getIronSession<SessionData>(
    await cookies(),
    sessionOptions
  );
  
  // Check if session was invalidated (server-side invalidation for corporate governance)
  if (session.invalidatedAt) {
    // Session was invalidated, allow sign-in to proceed (will create new session)
  } else if (session.accessToken && session.expiresAt && session.expiresAt > Date.now()) {
    // Already authenticated with valid session, redirect to agent-network
    return NextResponse.redirect(new URL("/agent-network", request.url));
  }

  // Get region from URL params (defaults to "us")
  const requestUrl = new URL(request.url);
  const region = (requestUrl.searchParams.get("region") ?? "us") as RegionId;

  // Build redirect URI dynamically from request origin (matches token exchange)
  const redirectUri = `${requestUrl.origin}/auth/callback`;

  // Generate state for CSRF protection
  const state = generateState();

  // Store state in session temporarily
  // If session was invalidated, clear it first to start fresh
  if (session.invalidatedAt) {
    // Clear invalidated session data before storing new OAuth state
    session.accessToken = undefined;
    session.refreshToken = undefined;
    session.expiresAt = undefined;
    session.baseUrl = undefined;
    session.invalidatedAt = undefined;
  }
  session.oauthState = state;
  await session.save();

  // Build authorization URL with dynamic redirect URI
  const authUrl = getAuthorizationUrl(state, redirectUri);
  
  // Create redirect response and set region cookie for token exchange
  const response = NextResponse.redirect(authUrl);
  const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 600, // 10 minutes
    path: "/",
  };
  response.cookies.set("anypoint_signin_region", region, COOKIE_OPTIONS);
  
  return response;
}
