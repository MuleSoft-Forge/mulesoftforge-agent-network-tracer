/**
 * OAuth configuration for Anypoint Platform Connected Apps
 */

const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";
const DEFAULT_REDIRECT_URI = "http://localhost:3000/auth/callback";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  baseUrl: string;
  scopes: string;
}

/**
 * Get OAuth configuration from environment variables
 */
export function getOAuthConfig(): OAuthConfig {
  const clientId = process.env.ANYPOINT_CLIENT_ID;
  const clientSecret = process.env.ANYPOINT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing OAuth configuration. Set ANYPOINT_CLIENT_ID and ANYPOINT_CLIENT_SECRET environment variables."
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri: process.env.ANYPOINT_REDIRECT_URI || DEFAULT_REDIRECT_URI,
    baseUrl: process.env.ANYPOINT_BASE_URL || DEFAULT_BASE_URL,
    scopes: "profile offline_access read:exchange view:monitoring read:api_configuration read:api_policies", // Match the scopes shown in authorization dialog
  };
}

/**
 * Get OAuth authorization endpoint URL
 */
export function getAuthorizationEndpoint(): string {
  const config = getOAuthConfig();
  return `${config.baseUrl}/accounts/api/v2/oauth2/authorize`;
}

/**
 * Get OAuth token endpoint URL
 */
export function getTokenEndpoint(): string {
  const config = getOAuthConfig();
  return `${config.baseUrl}/accounts/api/v2/oauth2/token`;
}
