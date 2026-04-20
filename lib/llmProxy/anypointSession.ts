/**
 * Anypoint "user-session" token helper.
 *
 * The `xapi/v1/.../prompt-topics/{id}` endpoint (and its sibling
 * `semantic-service-configs`) returns 403 for Connected-App OAuth bearer
 * tokens — it only accepts tokens minted by `POST /accounts/login` with a
 * username/password pair (the same flow the Anypoint UI uses). This helper
 * encapsulates that exchange, caches the resulting token in-memory, and
 * refreshes on 401.
 *
 * Credentials are read from the following environment variables:
 *   ANYPOINT_USER_USERNAME
 *   ANYPOINT_USER_PASSWORD
 *   ANYPOINT_BASE_URL (optional; defaults to the standard Anypoint host)
 *
 * If either credential is missing, `getAnypointSessionToken()` returns
 * `null` so callers can skip xapi entirely and degrade gracefully.
 */

import { DEFAULT_BASE_URL } from "@/lib/constants";
import { debugError, debugLog } from "@/lib/api-logger";

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;
let inflight: Promise<string | null> | null = null;

/**
 * Session tokens don't advertise a TTL in the response body. Empirically the
 * Anypoint UI re-authenticates well inside an hour; we cache for 25 min and
 * refresh on any 401 from downstream.
 */
const DEFAULT_TTL_MS = 25 * 60 * 1000;

function hasCredentials(): boolean {
  return Boolean(process.env.ANYPOINT_USER_USERNAME && process.env.ANYPOINT_USER_PASSWORD);
}

async function login(): Promise<string | null> {
  const username = process.env.ANYPOINT_USER_USERNAME;
  const password = process.env.ANYPOINT_USER_PASSWORD;
  if (!username || !password) return null;
  const baseUrl = process.env.ANYPOINT_BASE_URL || DEFAULT_BASE_URL;

  try {
    const res = await fetch(`${baseUrl}/accounts/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      debugError(
        "[ANYPOINT-SESSION] /accounts/login failed",
        res.status,
        text.slice(0, 200)
      );
      return null;
    }
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) {
      debugError("[ANYPOINT-SESSION] /accounts/login returned no access_token");
      return null;
    }
    cached = {
      token: body.access_token,
      expiresAt: Date.now() + DEFAULT_TTL_MS,
    };
    debugLog("[ANYPOINT-SESSION] session token obtained, cached for 25m");
    return body.access_token;
  } catch (error) {
    debugError("[ANYPOINT-SESSION] login error:", error);
    return null;
  }
}

/**
 * Returns a cached (or freshly minted) Anypoint user-session token, or null
 * if credentials aren't configured or the login fails. Coalesces concurrent
 * requests so we never hit `/accounts/login` more than necessary.
 */
export async function getAnypointSessionToken(
  opts: { force?: boolean } = {}
): Promise<string | null> {
  if (!hasCredentials()) return null;

  const now = Date.now();
  if (!opts.force && cached && cached.expiresAt > now) {
    return cached.token;
  }
  if (inflight) return inflight;

  inflight = login().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Call `fn(token)` with a session token, retrying once with a refreshed
 * token if the first attempt returns 401 (token expired server-side).
 * Returns `null` if no session token can be obtained at all.
 */
export async function withSessionToken<T>(
  fn: (token: string) => Promise<{ status: number; value?: T }>
): Promise<{ status: number; value?: T } | null> {
  const token = await getAnypointSessionToken();
  if (!token) return null;

  const first = await fn(token);
  if (first.status !== 401) return first;

  // Refresh + retry once.
  const refreshed = await getAnypointSessionToken({ force: true });
  if (!refreshed) return first;
  return fn(refreshed);
}
