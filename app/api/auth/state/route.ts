import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/session";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 600, // 10 minutes
  path: "/",
};

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { state, region } = body as { state?: string; region?: string };

  if (!state) {
    return NextResponse.json(
      { error: "State is required" },
      { status: 400 }
    );
  }

  // Store state in session cookie (ant_session) so it persists across OAuth redirects
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  session.oauthState = state;
  await session.save();

  // Also store region in a separate cookie for token exchange
  const response = NextResponse.json({ success: true });
  if (region) {
    response.cookies.set("anypoint_signin_region", region, COOKIE_OPTIONS);
  }

  return response;
}

export async function GET(request: NextRequest) {
  // Read state from session cookie (ant_session)
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  const state = session.oauthState;

  const response = NextResponse.json({ state: state ?? null });
  
  // Clear the state from session after reading (one-time use)
  if (state) {
    session.oauthState = undefined;
    await session.save();
  }

  return response;
}
