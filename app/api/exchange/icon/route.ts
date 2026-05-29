import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { ExchangeIconRequestSchema } from "@/lib/schemas";
import { requireAuth } from "@/lib/api/auth-middleware";
import { validationError } from "@/lib/api/error-responses";

export const dynamic = "force-dynamic";

/**
 * Proxies Exchange icon requests with the user's session so node icons
 * (e.g. /exchange/files/api/v1/organizations/.../icon) can be loaded on the canvas.
 */
export async function GET(request: NextRequest) {
  // Authentication check
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  
  const { baseUrl, accessToken } = authResult;

  // Validate query parameters
  const path = request.nextUrl.searchParams.get("path");
  const parseResult = ExchangeIconRequestSchema.safeParse({ path });
  
  if (!parseResult.success) {
    return validationError(parseResult.error);
  }
  
  const { path: validatedPath } = parseResult.data;
  const pathNormalized = validatedPath.startsWith("/") ? validatedPath : `/${validatedPath}`;

  // Restrict this proxy to Exchange asset/icon paths. Without this, any signed-in
  // user could proxy arbitrary control-plane paths (e.g. /accounts, /apimanager)
  // with their own token via the `path` param.
  if (!pathNormalized.startsWith("/exchange/")) {
    return NextResponse.json(
      { error: "path must be an Exchange path (starting with /exchange/)" },
      { status: 400 }
    );
  }

  const url = `${baseUrl.replace(/\/$/, "")}${pathNormalized}`;

  try {
    const res = await loggedFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      return new NextResponse(null, { status: res.status });
    }

    const contentType = res.headers.get("content-type") ?? "image/png";
    const body = await res.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    debugError("Exchange icon proxy error:", error);
    return NextResponse.json(
      { error: "Failed to fetch icon from Exchange" },
      { status: 500 }
    );
  }
}
