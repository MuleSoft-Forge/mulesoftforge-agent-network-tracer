import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

const sessionOptions = {
  password: process.env.SESSION_SECRET || "change-me-to-a-random-secret-key-min-32-chars",
  cookieName: "ant_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const, // Changed to "lax" to allow OAuth redirects from external domains
    maxAge: 90 * 24 * 60 * 60, // 90 days
  },
};

export interface SessionData {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  baseUrl?: string;
  oauthState?: string; // Temporary state for OAuth CSRF protection
  invalidatedAt?: number; // Timestamp when session was invalidated (for corporate governance that prevents cookie deletion)
}

export async function getSession() {
  try {
    const session = await getIronSession<SessionData>(
      await cookies(),
      sessionOptions
    );
    
    // Check if session was invalidated (server-side invalidation for corporate governance)
    // Even if browser doesn't delete cookie, server will reject invalidated sessions
    if (session.invalidatedAt) {
      console.log("[SESSION] Session rejected - invalidated at:", new Date(session.invalidatedAt).toISOString());
      return { authenticated: false };
    }
    
    return {
      authenticated: !!session.accessToken,
      expiresAt: session.expiresAt,
    };
  } catch {
    return { authenticated: false };
  }
}

export { sessionOptions };
