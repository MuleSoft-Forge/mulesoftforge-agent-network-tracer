import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth-middleware";
import { validationError } from "@/lib/api/error-responses";
import { EXCHANGE_SEARCH_TYPES, searchExchangeAssets } from "@/lib/mulesoft/exchange-search";

export const dynamic = "force-dynamic";

const KIND_TO_SEARCH_TYPE = {
  agent: EXCHANGE_SEARCH_TYPES.AGENT,
  mcp: EXCHANGE_SEARCH_TYPES.MCP,
  llm: EXCHANGE_SEARCH_TYPES.LLM,
} as const;

const RequestSchema = z.object({
  organizationId: z.string().min(1),
  q: z.string().default(""),
  /** Comma-separated: agent,mcp,llm. */
  kinds: z.string().default("agent,mcp,llm"),
});

export interface ExchangeSearchResultItem {
  groupId: string;
  assetId: string;
  name: string;
  version: string | null;
  /** Normalized composer kind. */
  kind: "agent" | "mcp" | "llm";
  /** Raw exchange asset type string. */
  rawType?: string;
}

function normalizeKind(rawType: string | undefined, fallback: "agent" | "mcp" | "llm"): "agent" | "mcp" | "llm" {
  const t = (rawType ?? "").toLowerCase();
  if (t.includes("mcp")) return "mcp";
  if (t.includes("llm")) return "llm";
  if (t.includes("agent")) return "agent";
  return fallback;
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;
  const parsed = RequestSchema.safeParse({
    organizationId: request.nextUrl.searchParams.get("organizationId"),
    q: request.nextUrl.searchParams.get("q") ?? "",
    kinds: request.nextUrl.searchParams.get("kinds") ?? "agent,mcp,llm",
  });
  if (!parsed.success) return validationError(parsed.error);

  const { organizationId, q, kinds } = parsed.data;
  const requestedKinds = kinds
    .split(",")
    .map((k) => k.trim())
    .filter((k): k is "agent" | "mcp" | "llm" => k === "agent" || k === "mcp" || k === "llm");

  const searchTypes = requestedKinds.map((k) => KIND_TO_SEARCH_TYPE[k]);
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  const { hits, attempt } = await searchExchangeAssets(
    baseUrl,
    organizationId,
    q || "",
    authHeader,
    fetch,
    searchTypes
  );

  const fallbackKind = requestedKinds[0] ?? "agent";
  const results: ExchangeSearchResultItem[] = hits.map((h) => ({
    groupId: h.groupId,
    assetId: h.assetId,
    name: h.name ?? h.assetId,
    version: h.version ?? null,
    kind: normalizeKind(h.type, fallbackKind),
    rawType: h.type,
  }));

  return NextResponse.json({ results, total: results.length, attempt });
}
