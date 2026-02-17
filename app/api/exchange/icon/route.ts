import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { sessionOptions, type SessionData } from "@/lib/session";

export const dynamic = "force-dynamic";

const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";

/**
 * Proxies Exchange icon requests with the user's session so node icons
 * (e.g. /exchange/files/api/v1/organizations/.../icon) can be loaded on the canvas.
 */
export async function GET(request: NextRequest) {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);

  if (session.invalidatedAt) {
    return NextResponse.json({ error: "Session invalidated" }, { status: 401 });
  }

  if (!session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const path = request.nextUrl.searchParams.get("path");
  if (path == null || path === "") {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
  const pathNormalized = path.startsWith("/") ? path : `/${path}`;
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
