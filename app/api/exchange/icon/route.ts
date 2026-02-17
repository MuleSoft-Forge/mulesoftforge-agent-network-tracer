import { NextRequest, NextResponse } from "next/server";
import { getSession, isAuthenticated } from "@/lib/session";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { ExchangeIconRequestSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";

/**
 * Proxies Exchange icon requests with the user's session so node icons
 * (e.g. /exchange/files/api/v1/organizations/.../icon) can be loaded on the canvas.
 */
export async function GET(request: NextRequest) {
  // Authentication check
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  
  const session = await getSession();
  
  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Validate query parameters
  const path = request.nextUrl.searchParams.get("path");
  const parseResult = ExchangeIconRequestSchema.safeParse({ path });
  
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details: parseResult.error.format(),
      },
      { status: 400 }
    );
  }
  
  const { path: validatedPath } = parseResult.data;

  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
  const pathNormalized = validatedPath.startsWith("/") ? validatedPath : `/${validatedPath}`;
  const url = `${baseUrl.replace(/\/$/, "")}${pathNormalized}`;

  try {
    const res = await loggedFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
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
