import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getSession, isAuthenticated } from "@/lib/session";
import { getAuthorizationUrlForRegion } from "@/lib/auth/oauth";
import { getDefaultRedirectUri } from "@/lib/auth/config";
import type { RegionId } from "@/lib/regions";
import { getCredentialsForRegion, getDefaultRegionId } from "@/lib/regions";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

/**
 * Generate a CSPRNG-backed state for OAuth CSRF protection.
 * Must be unguessable — `Math.random()` is not (V8 exposes internal state).
 */
function generateState(): string {
  return randomUUID();
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
    const redirect = safeRedirectPath(requestUrl.searchParams.get("redirect"));
    return NextResponse.redirect(new URL(redirect, request.url));
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

  let region = (requestUrl.searchParams.get("region") ?? getDefaultRegionId()) as RegionId;
  if (!getCredentialsForRegion(region)) {
    region = getDefaultRegionId();
  }
  if (!getCredentialsForRegion(region)) {
    return NextResponse.json(
      {
        error:
          "No OAuth Connected App configured. Set ANYPOINT_CLIENT_ID/SECRET (US) or ANYPOINT_EU_CLIENT_ID/SECRET (EU) in .env.local.",
      },
      { status: 500 }
    );
  }

  // Use configured redirect URI so proxy/internal origins cannot leak localhost
  // into hosted auth flows. Local dev still defaults to localhost via config.
  const redirectUri = getDefaultRedirectUri();

  // Generate state for CSRF protection
  const state = generateState();

  // Store state in session temporarily
  session.oauthState = state;
  await session.save();

  const authUrl = getAuthorizationUrlForRegion(region, state, redirectUri, forceReauth ? { prompt: "consent" } : undefined);
  
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
