/**
 * Lightweight session check for middleware (Edge runtime compatible)
 * Only checks if session cookie exists, full validation happens in route handlers
 */

import type { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "ant_session";

/**
 * Check if session cookie exists (lightweight check for middleware)
 * Full session validation happens in route handlers using getSession()
 */
export function hasSessionCookie(request: NextRequest): boolean {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  return !!cookie && cookie.value.length > 0;
}
