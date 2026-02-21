/**
 * OAuth 2.0 Authorization Code flow implementation
 */

import { getOAuthConfig, getAuthorizationEndpoint, getTokenEndpoint } from "./config";
import { loggedFetch } from "@/lib/api-logger";

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
export function getAuthorizationUrl(state: string, redirectUri?: string): string {
  const config = getOAuthConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: redirectUri ?? config.redirectUri,
    scope: config.scopes,
    state,
  });

  const authUrl = `${getAuthorizationEndpoint()}?${params.toString()}`;
  
  // Debug logging: Log requested scopes (only in development)
  if (process.env.NODE_ENV !== "production") {
    console.log("[OAuth] Requesting scopes:", config.scopes);
    console.log("[OAuth] Authorization URL scopes parameter:", params.get("scope"));
  }

  return authUrl;
}

/**
 * Exchange authorization code for access and refresh tokens
 */
export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  const config = getOAuthConfig();

  const body = JSON.stringify({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });

  const response = await loggedFetch(getTokenEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  // API returns snake_case, convert to camelCase for our session
  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    id_token?: string;
  };

  // Convert expires_in (seconds) to expiresAt (timestamp in milliseconds)
  const expiresAt = Date.now() + data.expires_in * 1000;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
  };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const config = getOAuthConfig();

  const body = JSON.stringify({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await loggedFetch(getTokenEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };

  const expiresAt = Date.now() + data.expires_in * 1000;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
  };
}
