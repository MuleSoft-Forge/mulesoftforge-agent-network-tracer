import { NextRequest, NextResponse } from "next/server";
import { debugError, debugLog } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";
import { resolveAllowedUrl } from "@/lib/api/allowed-hosts";
import { extractTextFiles } from "@/lib/zip-extract";

export const dynamic = "force-dynamic";

/**
 * Downloads a zip file from Exchange (via downloadURL) and extracts all text files.
 * Returns the extracted files as JSON.
 *
 * Query params: downloadURL (the full Exchange download URL for a zip file)
 *               classifier (optional, for labelling)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;

  const { searchParams } = new URL(request.url);
  const downloadURL = searchParams.get("downloadURL");
  const classifier = searchParams.get("classifier") ?? "unknown";

  if (!downloadURL) {
    return NextResponse.json({ error: "downloadURL is required", files: [] }, { status: 400 });
  }

  // Validate host before attaching the user's bearer token (prevents SSRF /
  // token exfiltration via attacker-supplied URLs).
  const safe = resolveAllowedUrl(downloadURL, baseUrl);
  if (!safe) {
    return NextResponse.json(
      { error: "downloadURL host is not allowed", files: [] },
      { status: 400 }
    );
  }
  const url = safe.toString();

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      debugError(`[extract-zip] Download failed: ${res.status} for ${classifier}`);
      return NextResponse.json({ error: `Download failed: ${res.status}`, files: [] }, { status: res.status });
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    debugLog(`[extract-zip] Downloaded ${classifier} zip: ${buffer.length} bytes`);

    const textFiles = extractTextFiles(buffer);

    debugLog(`[extract-zip] Extracted ${textFiles.length} files from ${classifier}:`, textFiles.map((f) => f.filename));

    const files = textFiles.map((f) => ({
      filename: f.filename,
      content: f.content,
    }));

    return NextResponse.json({ classifier, files });
  } catch (error) {
    debugError("[extract-zip] Error:", error);
    return NextResponse.json({ error: "Failed to extract zip", files: [] }, { status: 500 });
  }
}
