/**
 * OAuth 2.0 Authorization Code flow — helpers.
 *
 * The initial code-for-token exchange lives in `app/api/auth/token/route.ts`
 * (it also fetches the profile for entitlements and seals the session cookie).
 * This module hosts the `getAuthorizationUrl` builder and a standalone refresh
 * helper used by `requireAuth` to keep long sessions alive.
 */

import { getOAuthConfig, getAuthorizationEndpoint } from "./config";
import { getCredentialsForBaseUrl } from "@/lib/regions";
import { loggedFetch, debugLog } from "@/lib/api-logger";

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Timestamp in milliseconds
}

/**
 * Build OAuth authorization URL
 * @param state - CSRF protection state parameter
 * @param redirectUri - Optional redirect URI (defaults to config value)
 */
export function getAuthorizationUrl(
  state: string,
  redirectUri?: string,
  options?: { prompt?: string }
): string {
  const config = getOAuthConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: redirectUri ?? config.redirectUri,
    scope: config.scopes,
    state,
  });
  if (options?.prompt) {
    params.set("prompt", options.prompt);
  }

  const authUrl = `${getAuthorizationEndpoint()}?${params.toString()}`;
  debugLog("[OAuth] Requesting scopes:", config.scopes);
  return authUrl;
}

/**
 * Refresh an Anypoint access token. Resolves the per-region client creds from
 * the session's baseUrl so EU/CA/JP sessions refresh with the right client.
 */
export async function refreshAccessToken(
  refreshToken: string,
  baseUrl: string
): Promise<TokenResponse> {
  const creds = getCredentialsForBaseUrl(baseUrl);
  if (!creds) {
    throw new Error(`No OAuth client configured for baseUrl ${baseUrl}`);
  }

  const response = await loggedFetch(`${creds.baseUrl}/accounts/api/v2/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    // Anypoint usually returns a fresh refresh token; fall back to the current
    // one if it doesn't so we don't overwrite with undefined.
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}
