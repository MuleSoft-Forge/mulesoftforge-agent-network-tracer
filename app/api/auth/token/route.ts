import { NextRequest, NextResponse } from "next/server";
import { sealData } from "iron-session";
import { cookies } from "next/headers";
import { getCredentialsForRegion } from "@/lib/regions";
import type { RegionId } from "@/lib/regions";
import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";
import { sessionOptions, type SessionData } from "@/lib/session";

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code) {
      return NextResponse.json(
        { message: "Authorization code is required" },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const region = (cookieStore.get("anypoint_signin_region")?.value ?? "us") as RegionId;
    const creds = getCredentialsForRegion(region);

    if (!creds) {
      return NextResponse.json(
        { message: "Invalid or unsupported region for sign-in" },
        { status: 400 }
      );
    }

    const redirectUri = `${request.nextUrl.origin}/auth/callback`;
    const tokenUrl = `${creds.baseUrl}/accounts/api/v2/oauth2/token`;

    const tokenResponse = await loggedFetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      debugError("Token exchange failed:", error);
      return NextResponse.json(
        { message: "Failed to exchange authorization code" },
        { status: tokenResponse.status }
      );
    }

    const tokenData = await tokenResponse.json();
    
    debugLog("[TOKEN] ========== START TOKEN EXCHANGE ==========");
    debugLog("[TOKEN] Token data received:", {
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
    });
    
    // Check cookie BEFORE setting
    const cookieBefore = cookieStore.get("ant_session");
    debugLog("[TOKEN] Cookie BEFORE setting:", {
      exists: !!cookieBefore,
      value: cookieBefore ? `${cookieBefore.value.substring(0, 20)}...` : "null",
    });
    
    // Manually seal session data and set cookie on response
    // session.save() doesn't work in Next.js App Router, so we use sealData directly
    // Explicitly clear invalidatedAt to ensure new session is valid (even if old cookie had it)
    const sessionData: SessionData = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      baseUrl: creds.baseUrl,
      invalidatedAt: undefined, // Explicitly clear any previous invalidation
    };
    
    debugLog("[TOKEN] Session data to seal:", {
      hasAccessToken: !!sessionData.accessToken,
      hasRefreshToken: !!sessionData.refreshToken,
      expiresAt: sessionData.expiresAt,
      baseUrl: sessionData.baseUrl,
    });
    
    debugLog("[TOKEN] Calling sealData()");
    const sealed = await sealData(sessionData, sessionOptions);
    debugLog("[TOKEN] Sealed cookie:", {
      length: sealed.length,
      preview: `${sealed.substring(0, 30)}...`,
    });
    
    const cookieOptions = sessionOptions.cookieOptions;
    const secure = cookieOptions.secure ?? (process.env.NODE_ENV === "production");
    const sameSite = cookieOptions.sameSite ?? "lax";
    
    debugLog("[TOKEN] Cookie options:", {
      httpOnly: cookieOptions.httpOnly ?? true,
      secure,
      sameSite,
      maxAge: cookieOptions.maxAge ?? 90 * 24 * 60 * 60,
      path: "/",
    });
    
    const response = NextResponse.json({ success: true });
    
    debugLog("[TOKEN] Setting cookie via response.cookies.set()");
    response.cookies.set("ant_session", sealed, {
      httpOnly: cookieOptions.httpOnly ?? true,
      secure: secure,
      sameSite: sameSite,
      maxAge: cookieOptions.maxAge ?? 90 * 24 * 60 * 60,
      path: "/",
    });
    
    // Check what's in response cookies
    const responseCookies = response.headers.getSetCookie();
    debugLog("[TOKEN] Response Set-Cookie headers:", responseCookies);
    
    // Also set on cookie store
    debugLog("[TOKEN] Setting cookie on cookieStore");
    cookieStore.set("ant_session", sealed, {
      httpOnly: cookieOptions.httpOnly ?? true,
      secure: secure,
      sameSite: sameSite,
      maxAge: cookieOptions.maxAge ?? 90 * 24 * 60 * 60,
      path: "/",
    });
    
    // Verify it's set
    const cookieAfter = cookieStore.get("ant_session");
    debugLog("[TOKEN] Cookie AFTER setting:", {
      exists: !!cookieAfter,
      value: cookieAfter ? `${cookieAfter.value.substring(0, 30)}...` : "null",
      matchesSealed: cookieAfter?.value === sealed,
    });

    cookieStore.delete("anypoint_signin_region");
    response.cookies.delete("anypoint_signin_region");
    
    debugLog("[TOKEN] ========== END TOKEN EXCHANGE ==========");

    return response;
  } catch (error) {
    debugError("Token exchange error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
