import { NextRequest, NextResponse } from "next/server";
import { debugError, debugLog } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";
import { extractTextFiles } from "@/lib/zip-extract";

export const dynamic = "force-dynamic";

/**
 * Maven facade base URLs per control plane region.
 * The session baseUrl tells us which region the user authenticated against.
 */
const MAVEN_BASE_URLS: Record<string, string> = {
  "https://anypoint.mulesoft.com": "https://maven.anypoint.mulesoft.com",
  "https://eu1.anypoint.mulesoft.com": "https://maven.eu1.anypoint.mulesoft.com",
  "https://ca1.platform.mulesoft.com": "https://maven.ca1.platform.mulesoft.com",
  "https://jp1.platform.mulesoft.com": "https://maven.jp1.platform.mulesoft.com",
};

function getMavenBase(baseUrl: string): string {
  return MAVEN_BASE_URLS[baseUrl.replace(/\/$/, "")] ?? "https://maven.anypoint.mulesoft.com";
}

/**
 * Downloads the agent-network zip from the Exchange Maven facade,
 * extracts all text files, and returns them as JSON.
 *
 * Query params: organizationId, assetId, version, groupId (optional, defaults to organizationId)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");
  const assetId = searchParams.get("assetId");
  const version = searchParams.get("version");
  const groupId = searchParams.get("groupId") || organizationId;

  if (!organizationId || !assetId || !version) {
    return NextResponse.json(
      { error: "organizationId, assetId, and version are required" },
      { status: 400 }
    );
  }

  const mavenBase = getMavenBase(baseUrl);
  const zipName = `${assetId}-${version}-agent-network.zip`;
  const url = `${mavenBase}/api/v1/organizations/${encodeURIComponent(organizationId)}/maven/${encodeURIComponent(groupId!)}/${encodeURIComponent(assetId)}/${encodeURIComponent(version)}/${zipName}`;

  debugLog(`[maven-files] Fetching: ${url}`);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      debugError(`[maven-files] Maven download failed: ${res.status}`, text.slice(0, 300));
      return NextResponse.json(
        { error: `Maven download failed: ${res.status}`, files: [] },
        { status: res.status }
      );
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    debugLog(`[maven-files] Downloaded zip: ${buffer.length} bytes`);

    const textFiles = extractTextFiles(buffer);

    debugLog(`[maven-files] Extracted ${textFiles.length} text files:`, textFiles.map((f) => f.filename));

    const files = textFiles.map((f) => ({
      classifier: f.filename,
      packaging: f.filename.split(".").pop() ?? "txt",
      content: f.content,
    }));

    return NextResponse.json({ files });
  } catch (error) {
    debugError("[maven-files] Error:", error);
    return NextResponse.json(
      { error: "Failed to download agent-network from Maven", files: [] },
      { status: 500 }
    );
  }
}
