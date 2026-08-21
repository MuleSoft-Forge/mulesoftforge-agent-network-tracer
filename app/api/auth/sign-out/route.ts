import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function POST() {
  const session = await getSession();

  // Server-side invalidation: overwrite the cookie with an invalidated, stripped
  // session rather than deleting it. This implements the "corporate governance"
  // path where cookie *deletion* is blocked but the server can still set a new
  // value — `invalidatedAt` makes middleware, isAuthenticated(), and
  // requireAuth() all reject the session. A subsequent sign-in clears it and
  // re-runs OAuth (see app/auth/sign-in/route.ts).
  session.invalidatedAt = Date.now();
  session.accessToken = undefined;
  session.refreshToken = undefined;
  session.expiresAt = undefined;
  session.oauthState = undefined;
  session.oauthStateValidatedAt = undefined;
  await session.save();

  return NextResponse.json({ ok: true });
}
