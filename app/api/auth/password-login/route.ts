import { NextRequest, NextResponse } from "next/server";
import { isElectronDesktop } from "@/lib/auth/desktop";
import {
  createAuthenticatedSessionResponse,
  enrichSessionFromAccessToken,
  loginWithPassword,
  LoginError,
} from "@/lib/auth/login-session";
import { debugError } from "@/lib/api-logger";
import { PasswordLoginRequestSchema } from "@/lib/schemas";
import { validationError } from "@/lib/api/error-responses";
import type { SessionData } from "@/lib/session";
import { getRegionById } from "@/lib/regions";

export const dynamic = "force-dynamic";

/**
 * Desktop-only sign-in: POST username/password to Anypoint `/accounts/login`.
 * No Connected App client secret required — credentials never leave this machine
 * except to the chosen control plane.
 */
export async function POST(request: NextRequest) {
  if (!isElectronDesktop()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = PasswordLoginRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return validationError(parseResult.error);
  }

  const { username, password, region } = parseResult.data;
  const regionOption = getRegionById(region);
  if (!regionOption?.available) {
    return NextResponse.json({ error: `Region ${region} is not available` }, { status: 400 });
  }

  const baseUrl = regionOption.baseUrl;

  try {
    const tokens = await loginWithPassword(baseUrl, username, password);
    const monitoring = await enrichSessionFromAccessToken(baseUrl, tokens.accessToken);

    const sessionData: SessionData = {
      accessToken: tokens.accessToken,
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      expiresAt: tokens.expiresAt,
      baseUrl,
      invalidatedAt: undefined,
      ...monitoring,
    };

    return createAuthenticatedSessionResponse(sessionData, { expiresAt: tokens.expiresAt });
  } catch (error) {
    if (error instanceof LoginError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    debugError("Password login error:", error);
    return NextResponse.json({ error: "Sign-in failed" }, { status: 500 });
  }
}
