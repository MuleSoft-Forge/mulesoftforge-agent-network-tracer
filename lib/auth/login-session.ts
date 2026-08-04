import { NextResponse } from "next/server";
import { sealData } from "iron-session";
import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";
import { probeLogSearch } from "@/lib/api/log-search";
import { sessionOptions, type SessionData } from "@/lib/session";

/** Default access-token lifetime when Anypoint omits `expires_in` (login API). */
const DEFAULT_EXPIRES_IN_SEC = 3600;

export interface AnypointLoginResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

/**
 * Exchange username/password for an Anypoint access token (desktop / CLI flow).
 */
export async function loginWithPassword(
  baseUrl: string,
  username: string,
  password: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
  const res = await loggedFetch(`${baseUrl.replace(/\/$/, "")}/accounts/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new LoginError("Invalid username or password.", res.status);
    }
    throw new LoginError(
      text.trim() ? `Anypoint login failed: ${text.slice(0, 200)}` : `Anypoint login failed (${res.status}).`,
      res.status
    );
  }

  const data = (await res.json()) as AnypointLoginResponse;
  const accessToken = data.access_token?.trim();
  if (!accessToken) {
    throw new LoginError("Anypoint login succeeded but returned no access token.", 502);
  }

  const expiresIn =
    typeof data.expires_in === "number" && data.expires_in > 0
      ? data.expires_in
      : DEFAULT_EXPIRES_IN_SEC;

  return {
    accessToken,
    ...(data.refresh_token?.trim() ? { refreshToken: data.refresh_token.trim() } : {}),
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export class LoginError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "LoginError";
  }
}

/** Profile + log-search probe — shared by OAuth code exchange and password login. */
export async function enrichSessionFromAccessToken(
  baseUrl: string,
  accessToken: string
): Promise<Pick<SessionData, "monitoringCenterEnabled" | "monitoringProductSKU">> {
  let monitoringProductSKU: number | undefined;
  let orgId: string | undefined;

  try {
    const profileRes = await loggedFetch(`${baseUrl}/accounts/api/profile`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (profileRes.ok) {
      const profile = (await profileRes.json()) as {
        organization?: {
          id?: string;
          entitlements?: { monitoringCenter?: { productSKU?: number } };
        };
      };
      monitoringProductSKU = profile?.organization?.entitlements?.monitoringCenter?.productSKU;
      orgId = profile?.organization?.id;
    }
  } catch (profileError) {
    debugError("Profile fetch after login failed:", profileError);
  }

  const monitoringCenterEnabled = orgId
    ? await probeLogSearch(baseUrl, orgId, accessToken)
    : false;

  debugLog(
    `[AUTH] monitoringCenter.productSKU=${monitoringProductSKU} ` +
      `log-search probe → monitoringCenterEnabled=${monitoringCenterEnabled}`
  );

  return { monitoringCenterEnabled, monitoringProductSKU };
}

/** Seal session data into the iron-session cookie on a JSON success response. */
export async function createAuthenticatedSessionResponse(
  sessionData: SessionData,
  extraBody: Record<string, unknown> = {}
): Promise<NextResponse> {
  const sealed = await sealData(sessionData, sessionOptions);
  const cookieOptions = sessionOptions.cookieOptions;
  const secure = cookieOptions.secure ?? process.env.NODE_ENV === "production";
  const sameSite = cookieOptions.sameSite ?? "lax";

  const response = NextResponse.json({ success: true, ...extraBody });
  response.cookies.set("ant_session", sealed, {
    httpOnly: cookieOptions.httpOnly ?? true,
    secure,
    sameSite,
    maxAge: cookieOptions.maxAge ?? 90 * 24 * 60 * 60,
    path: "/",
  });
  return response;
}
