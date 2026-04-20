/**
 * OAuth configuration for Anypoint Platform Connected Apps.
 *
 * **Vercel / production:** Configure only the variables below. This application
 * does **not** use Anypoint interactive user accounts (`ANYPOINT_USER_*`,
 * `/accounts/login` with a password, etc.); those env vars are not read anywhere.
 *
 * `ANYPOINT_CLIENT_SECRET` is the OAuth **Connected App** client secret from
 * Anypoint (the same credential type every OAuth app stores server-side), not
 * a person’s platform password.
 *
 * Also required for sessions: `SESSION_SECRET` (iron-session cookie encryption;
 * see `lib/session.ts`), and `ANYPOINT_REDIRECT_URI` matching your deployment URL.
 */

import { DEFAULT_BASE_URL } from "@/lib/constants";

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

  // Default list aligns with a typical Connected App (Exchange, Monitoring, API Manager viewers,
  // Object Store, Runtime Fabrics, AMC). Must match scopes enabled on the Connected App; use
  // ANYPOINT_SCOPES to override (space-separated OAuth scope names, not UI labels).
  const scopes =
    process.env.ANYPOINT_SCOPES?.trim() ||
    "profile read:exchange view:monitoring read:api_configuration read:api_policies read:client_applications read:api_contracts manage:store_data read:runtime_fabrics read:applications manage:application_data read:full";

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
