import { NextRequest, NextResponse } from "next/server";
import { sealData } from "iron-session";
import { cookies } from "next/headers";
import { getCredentialsForRegion } from "@/lib/regions";
import type { RegionId } from "@/lib/regions";
import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";
import { sessionOptions, type SessionData } from "@/lib/session";
import { TokenRequestSchema } from "@/lib/schemas";

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

    // Fetch profile to derive entitlements (stable for duration of login)
    // monitoringCenter.productSKU mapping (empirical):
    //   1 = includes Log Search (_msearch API works)
    //   3 = basic monitoring (no Log Search — _msearch returns 200 + empty)
    //   other/unknown = assume no _msearch
    let monitoringCenterEnabled = false;
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
        monitoringCenterEnabled = monitoringProductSKU === 1;
        debugLog(`[AUTH-TOKEN] monitoringCenter.productSKU=${monitoringProductSKU} → monitoringCenterEnabled=${monitoringCenterEnabled}`);
      }
    } catch (profileError) {
      debugError("Profile fetch after login failed (using monitoringCenterEnabled=false):", profileError);
    }

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
