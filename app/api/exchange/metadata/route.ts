import { NextRequest, NextResponse } from "next/server";
import { getSession, isAuthenticated } from "@/lib/session";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { ExchangeMetadataRequestSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";

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
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  
  const session = await getSession();
  
  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Validate query parameters - support both formats:
  // 1. organizationId, assetId, version (used by enrich-with-llms.ts)
  // 2. path (alternative format)
  const { searchParams } = new URL(request.url);
  // Convert null to undefined for Zod (searchParams.get returns string | null, but Zod expects string | undefined)
  const organizationIdParam = searchParams.get("organizationId") ?? undefined;
  const assetIdParam = searchParams.get("assetId") ?? undefined;
  const versionParam = searchParams.get("version") ?? undefined;
  const pathParam = searchParams.get("path") ?? undefined;
  
  const parseResult = ExchangeMetadataRequestSchema.safeParse({
    organizationId: organizationIdParam,
    assetId: assetIdParam,
    version: versionParam,
    path: pathParam,
  });
  
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details: parseResult.error.format(),
      },
      { status: 400 }
    );
  }
  
  // Extract organizationId, assetId, version from either format
  let organizationId: string;
  let assetId: string;
  let version: string;
  
  if (parseResult.data.organizationId && parseResult.data.assetId && parseResult.data.version) {
    // Format 1: separate query parameters
    organizationId = parseResult.data.organizationId;
    assetId = parseResult.data.assetId;
    version = parseResult.data.version;
  } else if (parseResult.data.path) {
    // Format 2: path format (organizationId/assetId/version)
    const pathParts = parseResult.data.path.split("/");
    if (pathParts.length < 3) {
      return NextResponse.json(
        { error: "Invalid path format. Expected: organizationId/assetId/version" },
        { status: 400 }
      );
    }
    [organizationId, assetId, version] = pathParts;
  } else {
    return NextResponse.json(
      { error: "Either provide organizationId, assetId, and version, or provide path" },
      { status: 400 }
    );
  }

  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${baseUrl}/exchange/api/v2/assets/${encodeURIComponent(organizationId)}/${encodeURIComponent(assetId)}/${encodeURIComponent(version)}/agent/metadata`;

  try {
    const res = await loggedFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
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
