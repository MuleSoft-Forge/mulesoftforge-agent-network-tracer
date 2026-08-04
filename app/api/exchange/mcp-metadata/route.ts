import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { ExchangeMetadataRequestSchema } from "@/lib/schemas";
import { requireAuth } from "@/lib/api/auth-middleware";
import { parseExchangeParams } from "@/lib/api/exchange-params";
import { validationError } from "@/lib/api/error-responses";
import { resolveExchangeFileDownloadUrls } from "@/lib/mulesoft/exchange-file-download";
import {
  parseMcpMetadataContent,
  pickMcpMetadataFile,
  type ExchangeAssetFileRef,
} from "@/lib/mulesoft/exchange-mcp-metadata";

export const dynamic = "force-dynamic";

interface ExchangeAssetDetail {
  files?: ExchangeAssetFileRef[];
  groupId?: string;
  organizationId?: string;
}

async function downloadExchangeFile(
  urls: string[],
  accessToken: string
): Promise<{ ok: true; content: string } | { ok: false; status: number; body: string }> {
  let lastStatus = 404;
  let lastBody = "not found";

  for (const url of urls) {
    const fileRes = await loggedFetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (fileRes.ok) {
      return { ok: true, content: await fileRes.text() };
    }

    lastStatus = fileRes.status;
    lastBody = await fileRes.text().catch(() => "");
  }

  return { ok: false, status: lastStatus, body: lastBody };
}

/**
 * Fetches MCP tool catalog from Exchange for a published MCP server asset.
 * Reads mcp-metadata.json (or standalone mcp.json) from the asset's files[].
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;

  const { searchParams } = new URL(request.url);
  let params: { organizationId: string; assetId: string; version: string };

  try {
    params = parseExchangeParams(searchParams, ExchangeMetadataRequestSchema);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Invalid request")) {
      const parseResult = ExchangeMetadataRequestSchema.safeParse({
        organizationId: searchParams.get("organizationId") ?? undefined,
        assetId: searchParams.get("assetId") ?? undefined,
        version: searchParams.get("version") ?? undefined,
        path: searchParams.get("path") ?? undefined,
      });
      if (!parseResult.success) {
        return validationError(parseResult.error);
      }
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 }
    );
  }

  const { organizationId, assetId, version } = params;
  const groupId = searchParams.get("groupId") ?? organizationId;
  const assetUrl = `${baseUrl}/exchange/api/v2/assets/${encodeURIComponent(groupId)}/${encodeURIComponent(assetId)}/${encodeURIComponent(version)}`;

  try {
    const assetRes = await loggedFetch(assetUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!assetRes.ok) {
      const text = await assetRes.text();
      return NextResponse.json(
        { error: `Exchange API failed: ${assetRes.status} ${text.slice(0, 200)}` },
        { status: assetRes.status }
      );
    }

    const assetData = (await assetRes.json()) as ExchangeAssetDetail;
    const files = assetData.files ?? [];
    const metadataFile = pickMcpMetadataFile(files);

    if (!metadataFile?.classifier || !metadataFile.packaging) {
      return NextResponse.json(
        { error: "No mcp-metadata file found on this Exchange asset version." },
        { status: 404 }
      );
    }

    const downloadUrls = resolveExchangeFileDownloadUrls(baseUrl, {
      organizationId: assetData.organizationId ?? organizationId,
      groupId: assetData.groupId ?? groupId,
      assetId,
      version,
    }, metadataFile);

    if (downloadUrls.length === 0) {
      return NextResponse.json(
        { error: "No download URL available for mcp-metadata on this asset." },
        { status: 404 }
      );
    }

    const downloaded = await downloadExchangeFile(downloadUrls, accessToken);
    if (!downloaded.ok) {
      return NextResponse.json(
        {
          error: `Exchange metadata file download failed: ${downloaded.status} ${downloaded.body.slice(0, 200)}`,
        },
        { status: downloaded.status }
      );
    }

    const metadata = parseMcpMetadataContent(metadataFile.classifier, downloaded.content);

    if (!metadata) {
      return NextResponse.json(
        { error: "Could not parse MCP metadata file." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      classifier: metadataFile.classifier,
      metadata,
      tools: metadata.tools,
    });
  } catch (error) {
    debugError("Exchange MCP metadata fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch MCP metadata from Exchange" }, { status: 500 });
  }
}
