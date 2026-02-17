import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { loggedFetch, debugError } from "@/lib/api-logger";
import { sessionOptions, type SessionData } from "@/lib/session";

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
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);

  if (session.invalidatedAt) {
    return NextResponse.json({ error: "Session invalidated" }, { status: 401 });
  }

  if (!session.accessToken) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");
  const assetId = searchParams.get("assetId");
  const version = searchParams.get("version");

  if (!organizationId || !assetId || !version) {
    return NextResponse.json(
      { error: "organizationId, assetId, and version are required" },
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
