import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import type { IronSession } from "iron-session";
import { z } from "zod";

// Zod schema for runtime validation. `accessToken` + `expiresAt` must travel
// together: a session that has one but not the other is corrupted and should
// be destroyed rather than silently flip to "expired".
const SessionDataSchema = z
  .object({
    accessToken: z.string().min(1).optional(),
    refreshToken: z.string().min(1).optional(),
    expiresAt: z.number().int().positive().optional(),
    baseUrl: z.string().url().optional(),
    oauthState: z.string().min(1).optional(),
    invalidatedAt: z.number().int().positive().optional(),
    /** True when the _msearch probe at login returned 200. Anypoint's `productSKU` field on the profile is not a reliable signal — some SKU 3 orgs can call _msearch — so we probe directly. */
    monitoringCenterEnabled: z.boolean().optional(),
    /** Raw productSKU from profile; kept for diagnostics only, not used for gating. */
    monitoringProductSKU: z.number().optional(),
  })
  .refine(
    (d) => (d.accessToken ? d.expiresAt !== undefined : true),
    { message: "accessToken requires expiresAt" }
  )
  .refine(
    (d) => (d.accessToken ? d.baseUrl !== undefined : true),
    { message: "accessToken requires baseUrl" }
  );

export type SessionData = z.infer<typeof SessionDataSchema>;

/** Iron-session encryption key for the auth cookie — not an Anypoint user password. Set `SESSION_SECRET` in production (e.g. Vercel). */
function resolveSessionPassword(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "development") {
    return "dev-only-session-secret-change-me-change-me";
  }
  throw new Error(
    "SESSION_SECRET is required (min 32 chars) in non-development environments. Set it in your deployment (e.g. Vercel) environment variables."
  );
}

const sessionOptions = {
  password: resolveSessionPassword(),
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
