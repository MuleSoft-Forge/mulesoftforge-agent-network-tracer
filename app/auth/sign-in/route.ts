import { NextResponse } from "next/server";
import { getSession, isAuthenticated } from "@/lib/session";
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
  const requestUrl = new URL(request.url);
  /** After adding scopes in Anypoint, visit `/auth/sign-in?reauth=1` to run OAuth again (otherwise we redirect and skip consent). */
  const forceReauth = requestUrl.searchParams.get("reauth") === "1";

  if (forceReauth) {
    const cleared = await getSession();
    cleared.destroy();
    await cleared.save();
  } else if (await isAuthenticated()) {
    return NextResponse.redirect(new URL("/agent-network", request.url));
  }

  const session = await getSession();

  // Check if session was invalidated (server-side invalidation for corporate governance)
  if (session.invalidatedAt) {
    // Session was invalidated, clear it first to start fresh
    session.accessToken = undefined;
    session.refreshToken = undefined;
    session.expiresAt = undefined;
    session.baseUrl = undefined;
    session.invalidatedAt = undefined;
  }

  const region = (requestUrl.searchParams.get("region") ?? "us") as RegionId;

  // Build redirect URI dynamically from request origin (matches token exchange)
  const redirectUri = `${requestUrl.origin}/auth/callback`;

  // Generate state for CSRF protection
  const state = generateState();

  // Store state in session temporarily
  session.oauthState = state;
  await session.save();

  const authUrl = getAuthorizationUrl(state, redirectUri, forceReauth ? { prompt: "consent" } : undefined);
  
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
