import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import type { IronSession } from "iron-session";
import { z } from "zod";

// Zod schema for runtime validation
const SessionDataSchema = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  baseUrl: z.string().url().optional(),
  oauthState: z.string().optional(),
  invalidatedAt: z.number().optional(),
  /** True only when monitoringCenter.productSKU === 1 (Log Search / _msearch available). SKU 3 = basic monitoring (no Log Search). */
  monitoringCenterEnabled: z.boolean().optional(),
  /** Raw productSKU from profile for debugging. */
  monitoringProductSKU: z.number().optional(),
});

export type SessionData = z.infer<typeof SessionDataSchema>;

/** Iron-session encryption key for the auth cookie — not an Anypoint user password. Set `SESSION_SECRET` in production (e.g. Vercel). */
const sessionOptions = {
  password: process.env.SESSION_SECRET || "change-me-to-a-random-secret-key-min-32-chars",
  cookieName: "ant_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 90 * 24 * 60 * 60, // 90 days
  },
} as const;

/**
 * Get the current session (unified implementation)
 * Validates session data structure and handles corrupted sessions
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  
  // Validate session data structure (prevent type confusion attacks)
  const validated = SessionDataSchema.safeParse(session);
  if (!validated.success) {
    // Session data is corrupted, reset it
    session.destroy();
    return await getIronSession<SessionData>(cookieStore, sessionOptions);
  }
  
  return session;
}

/**
 * Check if user is authenticated
 * Handles invalidated sessions and expired tokens
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    const session = await getSession();
    const { accessToken, expiresAt, invalidatedAt } = session;
    
    // Check invalidation first (corporate governance)
    if (invalidatedAt) return false;
    
    // Check token existence and expiration
    if (!accessToken || !expiresAt) return false;
    
    // Add 5-minute buffer for token refresh
    return expiresAt > Date.now() + 5 * 60 * 1000;
  } catch {
    return false;
  }
}

/**
 * Get session status (for Server Components)
 * Returns minimal data suitable for serialization.
 * Uses the same auth rule as isAuthenticated() to avoid redirect loops (home says "authenticated" but layout says "not").
 */
export async function getSessionStatus() {
  try {
    const session = await getSession();
    
    if (session.invalidatedAt) {
      return { authenticated: false };
    }
    
    const { accessToken, expiresAt } = session;
    const fiveMinBuffer = 5 * 60 * 1000;
    const isAuth = !!(accessToken && expiresAt && expiresAt > Date.now() + fiveMinBuffer);
    
    return {
      authenticated: isAuth,
      expiresAt: session.expiresAt,
      baseUrl: session.baseUrl,
      monitoringCenterEnabled: session.monitoringCenterEnabled,
      monitoringProductSKU: session.monitoringProductSKU,
    };
  } catch {
    return { authenticated: false };
  }
}

export { sessionOptions };
