import { NextRequest, NextResponse } from "next/server";
import { sealData } from "iron-session";
import { cookies } from "next/headers";
import { getCredentialsForRegion } from "@/lib/regions";
import type { RegionId } from "@/lib/regions";
import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";
import { getSession, sessionOptions, type SessionData } from "@/lib/session";
import { TokenRequestSchema } from "@/lib/schemas";
import { probeMsearchEntitlement } from "@/lib/api/msearch-probe";

/** How long after CSRF-state validation a code may still be redeemed. */
const STATE_VALIDATION_TTL_MS = 10 * 60 * 1000;

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
      return NextResponse.json(
        { message: "Failed to exchange authorization code" },
        { status: tokenResponse.status }
      );
    }
    
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token as string;

    // Decide _msearch (Log Search) availability. Historically we inferred this
    // from `organization.entitlements.monitoringCenter.productSKU` — but
    // that field doesn't reliably line up with whether the API actually
    // works (observed: SKU 3 orgs that call _msearch successfully). Now we
    // probe the endpoint directly and record the SKU alongside it purely for
    // diagnostics.
    let monitoringProductSKU: number | undefined;
    try {
      const profileRes = await loggedFetch(`${creds.baseUrl}/accounts/api/profile`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (profileRes.ok) {
        const profile = (await profileRes.json()) as {
          organization?: { entitlements?: { monitoringCenter?: { productSKU?: number } } };
        };
        monitoringProductSKU = profile?.organization?.entitlements?.monitoringCenter?.productSKU;
      }
    } catch (profileError) {
      debugError("Profile fetch after login failed:", profileError);
    }

    const monitoringCenterEnabled = await probeMsearchEntitlement(creds.baseUrl, accessToken);
    debugLog(
      `[AUTH-TOKEN] monitoringCenter.productSKU=${monitoringProductSKU} ` +
        `_msearch probe → monitoringCenterEnabled=${monitoringCenterEnabled}`
    );

    // Prepare session data
    const sessionData: SessionData = {
      accessToken,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      baseUrl: creds.baseUrl,
      invalidatedAt: undefined,
      monitoringCenterEnabled,
      monitoringProductSKU,
    };

    const sealed = await sealData(sessionData, sessionOptions);
    
    const cookieOptions = sessionOptions.cookieOptions;
    const secure = cookieOptions.secure ?? (process.env.NODE_ENV === "production");
    const sameSite = cookieOptions.sameSite ?? "lax";
    
    // Create response
    const response = NextResponse.json({ success: true });
    
    // Set session cookie ONLY on response (Next.js 15 pattern)
    // Removed redundant cookieStore.set() to prevent double setting
    response.cookies.set("ant_session", sealed, {
      httpOnly: cookieOptions.httpOnly ?? true,
      secure: secure,
      sameSite: sameSite,
      maxAge: cookieOptions.maxAge ?? 90 * 24 * 60 * 60,
      path: "/",
    });
    
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
