/**
 * Bearer-token credential resolution.
 *
 * The worker authenticates CLI runs only via the acting user's short-lived
 * Anypoint access token (`ANYPOINT_BEARER`). There is intentionally no fallback
 * to per-org env credentials.
 */

/** Concrete credentials + the env the CLI child should run with. */
export interface ResolvedCredentials {
  /** Env vars to merge into the CLI child process (client id/secret, base url). */
  env: Record<string, string>;
  /**
   * Env vars that must be removed from the inherited environment before the
   * chosen auth vars are applied. The Anypoint CLI maps ANYPOINT_* vars to flags
   * and rejects conflicting auth (e.g. `--client_id ... cannot also be provided
   * when using --bearer`), so bearer mode must scrub any ambient client
   * id/secret and vice versa.
   */
  unsetEnv: string[];
  /** Literal secret strings to redact from all output for this job. */
  secretValues: string[];
}

/** ANYPOINT_* env vars the CLI turns into auth flags. */
const CLIENT_AUTH_ENV = [
  "ANYPOINT_CLIENT_ID",
  "ANYPOINT_CLIENT_SECRET",
  "ANYPOINT_USERNAME",
  "ANYPOINT_PASSWORD",
];
/**
 * Build CLI credentials from the acting user's Anypoint access token. The CLI
 * honours ANYPOINT_BEARER and, when set, ignores any client id/secret — so the
 * command runs as the user with the user's own permissions.
 *
 * ANYPOINT_HOST wants a bare hostname (no scheme); we derive it from the token's
 * control-plane base URL so EU/CA/JP sessions hit the right control plane.
 */
export function bearerCredentials(userToken: string, baseUrl?: string): ResolvedCredentials {
  const token = userToken.trim();
  if (!token) {
    throw new Error("Empty user token.");
  }
  const env: Record<string, string> = { ANYPOINT_BEARER: token };
  if (baseUrl) {
    try {
      env.ANYPOINT_HOST = new URL(baseUrl).host;
    } catch {
      // Ignore an unparseable base URL; the CLI falls back to its default host.
    }
  }
  // Scrub any ambient client id/secret so the CLI doesn't see both --bearer and
  // --client_id (they conflict). The web app keeps a Connected App client
  // id/secret in the environment for its own OAuth, which the worker inherits.
  return { env, unsetEnv: CLIENT_AUTH_ENV, secretValues: [token] };
}
