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

  // Match scopes shown in authorization dialog (from _old project)
  // Added read:applications for Application Manager API access (needed for Hybrid deployment Object Store lookup)
  // Added manage:store_data for Object Store partition access (needed for reading broker state)
  // NOTE: If you get 403 errors from APIs, try testing different scopes. See AMC_COMMON_SCOPES_TO_TRY for Application Manager.
  // Set ANYPOINT_SCOPES in .env.local (space-separated) to override. Object Store: manage:store_data, manage:store, read:store
  const scopes =
    process.env.ANYPOINT_SCOPES?.trim() ||
    "profile read:exchange view:monitoring read:api_configuration read:api_policies manage:store_data read:applications";

  return {
    clientId,
    clientSecret,
    redirectUri: process.env.ANYPOINT_REDIRECT_URI || DEFAULT_REDIRECT_URI,
    baseUrl: process.env.ANYPOINT_BASE_URL || DEFAULT_BASE_URL,
    scopes,
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

/**
 * Human-readable list of scopes to suggest when AMC returns 403 (single source of truth for 403 messages).
 * Application Manager API: read:applications (docs: allows GET .../deployments/**), read:deployments, manage:applications, view:applications, read:runtime
 */
export const AMC_COMMON_SCOPES_TO_TRY =
  "read:applications, read:deployments, manage:applications, view:applications, read:runtime";
