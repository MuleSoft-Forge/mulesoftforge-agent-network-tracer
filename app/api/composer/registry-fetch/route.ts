import { NextRequest, NextResponse } from "next/server";
import { isSafePublicUrl, safeFetch } from "@/lib/api/url-safety";
import { parseMcpMetadataJson } from "@/lib/composer/registry/import-helpers";
import { isAuthenticated } from "@/lib/session";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const kind = req.nextUrl.searchParams.get("kind");
  if (kind !== "mcp") {
    return NextResponse.json({ error: "Unsupported kind (use kind=mcp)" }, { status: 400 });
  }

  const targetUrl = req.nextUrl.searchParams.get("url");
  if (!targetUrl) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  const safety = isSafePublicUrl(targetUrl, { allowHttp: false });
  if (!safety.ok) {
    return NextResponse.json({ error: `Unsafe URL: ${safety.reason}` }, { status: 400 });
  }

  try {
    const res = await safeFetch(
      targetUrl,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      },
      { allowHttp: false }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `Fetch failed (${res.status})` },
        { status: res.status >= 400 && res.status < 500 ? res.status : 502 }
      );
    }

    const text = await res.text();
    const parsed = parseMcpMetadataJson(text);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 422 });
    }

    return NextResponse.json({ metadata: parsed.metadata, sourceUrl: targetUrl });
  } catch {
    return NextResponse.json({ error: "Failed to fetch MCP metadata" }, { status: 502 });
  }
}
