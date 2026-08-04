import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * **Local development only** (`next dev`). Returns the current OAuth access token so you can
 * paste it into curl/Postman. Disabled in production builds (404).
 *
 * Never commit tokens or share terminal output that includes the logged line.
 */
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await getSession();
  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const token = session.accessToken;
  // Intentional: visible in the terminal running `next dev` for quick copy-paste.
  console.log(`[auth/debug/access-token] Bearer ${token}`);

  return NextResponse.json({
    warning:
      "Development only. This value is a secret — revoke the Connected App session in Anypoint if you leak it.",
    baseUrl: session.baseUrl ?? null,
    expiresAt: session.expiresAt ?? null,
    accessToken: token,
  });
}
