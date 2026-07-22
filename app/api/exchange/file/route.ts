import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";
import { resolveAllowedUrl } from "@/lib/api/allowed-hosts";
import { resolveExchangeFileDownloadUrls } from "@/lib/mulesoft/exchange-file-download";

export const dynamic = "force-dynamic";

/**
 * Downloads a specific file from an Exchange asset version.
 *
 * Accepts either:
 *   - downloadURL: the full download URL from the asset's files[] array
 *   - OR organizationId + assetId + version + classifier + packaging
 *     (constructs the download path)
 *
 * The Exchange files API returns the raw file content.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;

  const { searchParams } = new URL(request.url);
  const downloadURL = searchParams.get("downloadURL");
  const organizationId = searchParams.get("organizationId");
  const assetId = searchParams.get("assetId");
  const version = searchParams.get("version");
  const classifier = searchParams.get("classifier");
  const packaging = searchParams.get("packaging");

  let url: string;

  if (downloadURL) {
    // The user's bearer token is attached below, so `downloadURL` must be an
    // Anypoint/Exchange host. Otherwise an attacker could craft a
    // ?downloadURL=https://evil/ link and have the server leak the token.
    const safe = resolveAllowedUrl(downloadURL, baseUrl);
    if (!safe) {
      return NextResponse.json(
        { error: "downloadURL host is not allowed" },
        { status: 400 }
      );
    }
    url = safe.toString();
  } else if (organizationId && assetId && version && classifier && packaging) {
    const groupId = searchParams.get("groupId") ?? organizationId;
    const candidates = resolveExchangeFileDownloadUrls(
      baseUrl,
      { organizationId, groupId, assetId, version },
      { classifier, packaging }
    );
    url = candidates[0] ?? "";
    if (!url) {
      return NextResponse.json(
        { error: "Could not resolve Exchange file download URL." },
        { status: 400 }
      );
    }
  } else {
    return NextResponse.json(
      { error: "Provide downloadURL, or organizationId + assetId + version + classifier + packaging" },
      { status: 400 }
    );
  }

  try {
    const res = await loggedFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      debugError(`Exchange file download failed: ${res.status} for ${url}`, text.slice(0, 300));
      return NextResponse.json(
        { error: `Exchange file download failed: ${res.status}` },
        { status: res.status }
      );
    }

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const pathLower = url.split("?")[0].toLowerCase();
    const pathSuggestsText =
      /\.(json|ya?ml|txt|xml|raml|md)(?:$|[?#])/i.test(pathLower) ||
      /\/files\/[^/]+\.(json|ya?ml|txt|xml|raml)(?:$|[?#])/i.test(pathLower);
    const packagingLower = packaging?.toLowerCase();
    const isText =
      contentType.includes("yaml") ||
      contentType.includes("json") ||
      contentType.includes("text") ||
      contentType.includes("xml") ||
      contentType.includes("raml") ||
      (packagingLower &&
        ["yaml", "yml", "json", "txt", "xml", "raml"].includes(packagingLower)) ||
      pathSuggestsText;

    if (isText) {
      const text = await res.text();
      return NextResponse.json({
        content: text,
        contentType,
        classifier: classifier ?? null,
        packaging: packaging ?? null,
      });
    }

    const body = await res.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${classifier ?? "file"}.${packaging ?? "bin"}"`,
      },
    });
  } catch (error) {
    debugError("Exchange file download error:", error);
    return NextResponse.json(
      { error: "Failed to download file from Exchange" },
      { status: 500 }
    );
  }
}
