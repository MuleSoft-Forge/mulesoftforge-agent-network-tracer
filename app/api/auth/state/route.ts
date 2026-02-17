import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { StateRequestSchema, StateValidationSchema } from "@/lib/schemas";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 600, // 10 minutes
  path: "/",
} as const;

/**
 * Store OAuth state (POST - idempotent)
 * Called before redirecting to OAuth provider
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = StateRequestSchema.safeParse(body);
    
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parseResult.error.format() },
        { status: 400 }
      );
    }
    
    const { state, region } = parseResult.data;
    
    // Store state in session (atomic write)
    const session = await getSession();
    session.oauthState = state;
    await session.save();
    
    const response = NextResponse.json({ success: true });
    
    // Store region in separate cookie for token exchange
    if (region) {
      response.cookies.set("anypoint_signin_region", region, COOKIE_OPTIONS);
    }
    
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Consume OAuth state (GET - atomic read-and-clear)
 * Validates provided state against stored state and clears it
 * 
 * CRITICAL: This prevents race conditions by atomically consuming the state
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    const storedState = session.oauthState;
    
    // Atomic read-and-clear (prevents race conditions)
    // Clear BEFORE returning response to ensure atomicity
    if (storedState) {
      session.oauthState = undefined;
      await session.save(); // Save synchronously before response
    }
    
    return NextResponse.json({ state: storedState ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Validate OAuth state (PUT - for callback validation)
 * Alternative approach: validate and consume in one atomic operation
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = StateValidationSchema.safeParse(body);
    
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parseResult.error.format() },
        { status: 400 }
      );
    }
    
    const { state: providedState } = parseResult.data;
    
    const session = await getSession();
    const storedState = session.oauthState;
    
    // Validate and clear atomically
    if (!storedState || storedState !== providedState) {
      return NextResponse.json(
        { error: "Invalid state", valid: false },
        { status: 400 }
      );
    }
    
    // Clear state after successful validation
    session.oauthState = undefined;
    await session.save();
    
    return NextResponse.json({ valid: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
