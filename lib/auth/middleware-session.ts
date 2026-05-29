/**
 * Session check for middleware (Edge runtime compatible).
 *
 * Previously this only checked that a non-empty `ant_session` cookie existed,
 * which let any garbage value (e.g. `ant_session=x`) pass middleware. We now
 * actually decrypt the iron-session seal and confirm it contains a live,
 * non-invalidated access token. Full refresh logic still lives in the route
 * handlers via `requireAuth`.
 */

import { unsealData } from "iron-session";
import type { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "ant_session";

/**
 * Resolve the iron-session password the same way `lib/session.ts` does, but
 * without importing that module (it pulls in `next/headers`, which is not
 * available in the Edge middleware bundle).
 */
function resolveSessionPassword(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "development") {
    return "dev-only-session-secret-change-me-change-me";
  }
  return null;
}

interface MinimalSession {
  accessToken?: string;
  invalidatedAt?: number;
}

/**
 * Validate the session cookie: it must decrypt with our password, not be
 * invalidated, and carry an access token. Returns false for missing, garbage,
 * tampered, expired-seal, or invalidated cookies.
 */
export async function hasValidSession(request: NextRequest): Promise<boolean> {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (!cookie?.value) return false;

  const password = resolveSessionPassword();
  if (!password) return false;

  try {
    const data = await unsealData<MinimalSession>(cookie.value, { password });
    if (!data || typeof data !== "object") return false;
    if (data.invalidatedAt) return false;
    return typeof data.accessToken === "string" && data.accessToken.length > 0;
  } catch {
    return false;
  }
}
