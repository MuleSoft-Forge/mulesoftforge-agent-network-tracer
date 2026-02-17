import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/session";

export async function GET() {
  const session = await getIronSession<SessionData>(
    await cookies(),
    sessionOptions
  );

  // Check if session was invalidated (server-side invalidation for corporate governance)
  if (session.invalidatedAt) {
    return NextResponse.json({ authenticated: false });
  }

  if (session.accessToken && session.expiresAt) {
    return NextResponse.json({
      authenticated: true,
      expiresAt: session.expiresAt,
      baseUrl: session.baseUrl,
    });
  }

  return NextResponse.json({ authenticated: false });
}
