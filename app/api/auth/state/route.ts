import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { StateValidationSchema } from "@/lib/schemas";

/**
 * Validate and consume the stored OAuth state atomically. The sign-in route
 * writes the state directly to the session cookie; the callback page calls
 * this PUT to verify the `state` echoed back by Anypoint matches. There are
 * no other state endpoints: POST/GET handlers that used to live here were
 * never called.
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

    if (!storedState || storedState !== providedState) {
      return NextResponse.json(
        { error: "Invalid state", valid: false },
        { status: 400 }
      );
    }

    session.oauthState = undefined;
    await session.save();

    return NextResponse.json({ valid: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
