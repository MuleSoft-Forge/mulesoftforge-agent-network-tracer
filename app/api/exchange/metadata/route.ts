import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { ExchangeMetadataRequestSchema } from "@/lib/schemas";
import { requireAuth } from "@/lib/api/auth-middleware";
import { parseExchangeParams } from "@/lib/api/exchange-params";
import { validationError } from "@/lib/api/error-responses";

export const dynamic = "force-dynamic";

/**
 * Exchange API connection reference structure
 */
interface ConnectionRef {
  groupId: string;
  assetId: string;
  version: string;
}

/**
 * Exchange API connection structure
 */
interface AssetConnection {
  kind: "agent" | "mcp" | "llm";
  ref: ConnectionRef;
  metadata?: Record<string, unknown>;
}

/**
 * Exchange API agent metadata response structure
 */
interface AgentMetadataResponse {
  card?: {
    name?: string;
    version?: string;
    description?: string;
    [key: string]: unknown;
  };
  connections?: AssetConnection[];
  kind?: string;
  protocol?: string;
  platform?: string;
  description?: string;
  [key: string]: unknown;
}

/**
 * Fetches agent/broker metadata from Exchange API for a specific version.
 * Returns the LLM connection information if present.
 * 
 * Endpoint: GET /api/v2/assets/{organizationId}/{assetId}/{version}/agent/metadata
 */
export async function GET(request: NextRequest) {
  // Authentication check
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  
  const { baseUrl, accessToken } = authResult;

  // Validate and parse query parameters
  const { searchParams } = new URL(request.url);
  let params: { organizationId: string; assetId: string; version: string };
  
  try {
    params = parseExchangeParams(searchParams, ExchangeMetadataRequestSchema);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Invalid request")) {
      // Parse the error to get Zod error details
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
  const url = `${baseUrl}/exchange/api/v2/assets/${encodeURIComponent(organizationId)}/${encodeURIComponent(assetId)}/${encodeURIComponent(version)}/agent/metadata`;

  try {
    const res = await loggedFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Exchange API failed: ${res.status} ${text.slice(0, 200)}` },
        { status: res.status }
      );
    }

    const metadata = (await res.json()) as AgentMetadataResponse;

    // Extract LLM connection if present
    const llmConnection = metadata.connections?.find((conn: AssetConnection) => conn.kind === "llm");
    const llmRef = llmConnection?.ref;

    return NextResponse.json({
      metadata,
      llm: llmRef
        ? {
            groupId: llmRef.groupId,
            assetId: llmRef.assetId,
            version: llmRef.version,
          }
        : null,
      connections: metadata.connections || [],
    });
  } catch (error) {
    debugError("Exchange metadata fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch metadata from Exchange" },
      { status: 500 }
    );
  }
}
