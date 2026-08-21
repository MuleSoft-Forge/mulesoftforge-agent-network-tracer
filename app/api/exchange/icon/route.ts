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
  const requestedPath = validatedPath.startsWith("/") ? validatedPath : `/${validatedPath}`;

  // Restrict this proxy to Exchange asset/icon paths. Without this, any signed-in
  // user could proxy arbitrary control-plane paths (e.g. /accounts, /apimanager)
  // with their own token via the `path` param.
  //
  // Resolve before checking: a prefix test on the raw string is defeated by
  // "/exchange/../accounts/...", which the URL parser normalizes away.
  let url: URL;
  try {
    url = new URL(requestedPath, `${baseUrl.replace(/\/$/, "")}/`);
  } catch {
    return NextResponse.json({ error: "path is not a valid Exchange path" }, { status: 400 });
  }

  // Percent-encoded separators survive URL normalization, so a server that
  // decodes them would still escape /exchange/. Reject them outright.
  const hasEncodedTraversal = /%2e|%2f|%5c/i.test(requestedPath);

  const expectedOrigin = new URL(baseUrl).origin;
  if (hasEncodedTraversal || url.origin !== expectedOrigin || !url.pathname.startsWith("/exchange/")) {
    return NextResponse.json(
      { error: "path must be an Exchange path (starting with /exchange/)" },
      { status: 400 }
    );
  }

  try {
    const res = await loggedFetch(url.toString(), {
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
