import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCredentialsForRegion } from "@/lib/regions";
import type { RegionId } from "@/lib/regions";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { getSession } from "@/lib/session";
import { getDefaultRedirectUri } from "@/lib/auth/config";
import { TokenRequestSchema } from "@/lib/schemas";
import {
  createAuthenticatedSessionResponse,
  enrichSessionFromAccessToken,
} from "@/lib/auth/login-session";
import type { SessionData } from "@/lib/session";

/** How long after CSRF-state validation a code may still be redeemed. */
const STATE_VALIDATION_TTL_MS = 10 * 60 * 1000;

interface LoginProfile {
  email?: string | null;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  organization?: {
    id?: string | null;
    name?: string | null;
  } | null;
}

async function sendAccessLogWebhook(baseUrl: string, accessToken: string): Promise<void> {
  const webhookUrl = process.env.ACCESS_LOG_WEBHOOK_URL?.trim();
  if (!webhookUrl) return;

  try {
    const profileRes = await loggedFetch(`${baseUrl}/accounts/api/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!profileRes.ok) {
      debugError("[WEBHOOK] Profile fetch failed during login webhook:", profileRes.status);
      return;
    }

    const profile = (await profileRes.json()) as LoginProfile;
    const webhookPayload = {
      binType: "ant",
      email: profile.email || null,
      username: profile.username || null,
      first_name: profile.firstName || null,
      last_name: profile.lastName || null,
      org_id: profile.organization?.id || null,
      org_name: profile.organization?.name || null,
    };

    const webhookRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
      signal: AbortSignal.timeout(5000),
    });
    if (!webhookRes.ok) {
      debugError("[WEBHOOK] Login webhook returned non-OK status:", webhookRes.status);
    }
  } catch (error) {
    debugError("[WEBHOOK] Failed to send login webhook:", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = TokenRequestSchema.safeParse(body);
    
    if (!parseResult.success) {
      return NextResponse.json(
        { message: "Authorization code is required" },
        { status: 400 }
      );
    }
    
    const { code } = parseResult.data;

    // Bind code redemption to the session that just passed OAuth state (CSRF)
    // validation. Without this, an intercepted `code` could be redeemed by any
    // party with a simple POST, bypassing the callback's state check.
    const session = await getSession();
    const validatedAt = session.oauthStateValidatedAt ?? 0;
    if (!validatedAt || Date.now() - validatedAt > STATE_VALIDATION_TTL_MS) {
      return NextResponse.json(
        { message: "OAuth state was not validated for this session" },
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
    
    // Must match the redirect URI used for the authorization request.
    const redirectUri = getDefaultRedirectUri();
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
      return NextResponse.json(
        { message: "Failed to exchange authorization code" },
        { status: tokenResponse.status }
      );
    }
    
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token as string;
    const monitoring = await enrichSessionFromAccessToken(creds.baseUrl, accessToken);

    const sessionData: SessionData = {
      accessToken,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      baseUrl: creds.baseUrl,
      invalidatedAt: undefined,
      ...monitoring,
    };

    const response = await createAuthenticatedSessionResponse(sessionData);

    // Fire server-side login access webhook (if configured).
    await sendAccessLogWebhook(creds.baseUrl, accessToken);

    // Delete region cookie (no longer needed)
    response.cookies.delete("anypoint_signin_region");

    return response;
  } catch (error) {
    debugError("Token exchange error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
