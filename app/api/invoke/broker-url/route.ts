import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";

export const dynamic = "force-dynamic";

interface ExchangeFile {
  classifier?: string;
  packaging?: string;
  externalLink?: string;
  downloadURL?: string;
}

interface ExchangeAsset {
  files?: ExchangeFile[];
}

/**
 * Resolves the A2A endpoint URL for a broker by reading its `a2a-card.json`
 * from Exchange. This lets the Invoke tab auto-populate the URL bar when the
 * user has already selected a broker in the left sidebar.
 *
 * Query params: orgId, assetId
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;
  const { searchParams } = request.nextUrl;
  const orgId = searchParams.get("orgId");
  const assetId = searchParams.get("assetId");

  if (!orgId || !assetId) {
    return NextResponse.json({ error: "orgId and assetId are required" }, { status: 400 });
  }

  const authHeader = `Bearer ${accessToken}`;

  try {
    // Exchange v2 unversioned asset endpoint returns the latest version + files
    const assetUrl = `${baseUrl}/exchange/api/v2/assets/${encodeURIComponent(orgId)}/${encodeURIComponent(assetId)}`;
    const assetRes = await loggedFetch(assetUrl, { headers: { Authorization: authHeader } });
    if (!assetRes.ok) {
      const text = await assetRes.text();
      return NextResponse.json(
        { error: `Exchange asset fetch failed: ${assetRes.status}`, url: null },
        { status: assetRes.status }
      );
    }

    const asset = (await assetRes.json()) as ExchangeAsset;
    const files = asset.files ?? [];

    debugLog("[BROKER-URL] Exchange files for", assetId, ":", files.map((f) => `${f.classifier}.${f.packaging}`));

    const cardFile = files.find(
      (f) =>
        f.classifier?.toLowerCase() === "a2a-card" &&
        ["json", "yaml", "yml"].includes(f.packaging?.toLowerCase() ?? "")
    );

    if (!cardFile) {
      return NextResponse.json({ url: null, reason: "no_a2a_card" });
    }

    // Use externalLink or downloadURL to fetch the raw card content
    const fileUrl = cardFile.downloadURL ?? cardFile.externalLink;
    if (!fileUrl) {
      return NextResponse.json({ url: null, reason: "no_download_url" });
    }

    const fileRes = await loggedFetch(fileUrl, { headers: { Authorization: authHeader } });
    if (!fileRes.ok) {
      return NextResponse.json({ url: null, reason: "download_failed" });
    }

    const text = await fileRes.text();
    let card: { url?: string } = {};
    try {
      card = JSON.parse(text) as { url?: string };
    } catch {
      // Might be YAML — extract url: field with a simple regex
      const match = /^url:\s*["']?([^\s"'\n]+)/m.exec(text);
      if (match) card = { url: match[1] };
    }

    const brokerUrl = typeof card.url === "string" ? card.url.trim() : null;
    debugLog("[BROKER-URL] Resolved URL for", assetId, "→", brokerUrl ?? "(none)");
    return NextResponse.json({ url: brokerUrl });
  } catch (err) {
    debugError("[BROKER-URL] Error:", err);
    return NextResponse.json({ error: "Failed to resolve broker URL", url: null }, { status: 500 });
  }
}
