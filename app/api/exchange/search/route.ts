import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth-middleware";
import { validationError } from "@/lib/api/error-responses";
import {
  EXCHANGE_SEARCH_TYPES,
  searchExchangeAssets,
  searchMulesoftSuppliedAssets,
} from "@/lib/mulesoft/exchange-search";
import { fetchGovernedAssetIds } from "@/lib/mulesoft/governed-assets";

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
  includeBusinessGroup: z.enum(["true", "false"]).default("true"),
  includeMulesoftSupplied: z.enum(["true", "false"]).default("false"),
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
  /** Source scope: caller's business group vs the MuleSoft public org. */
  source: "business-group" | "mulesoft-supplied";
  /** True when this asset is governed (has an instance) in the caller's org. */
  governed: boolean;
}

function normalizeKind(rawType: string | undefined, fallback: "agent" | "mcp" | "llm"): "agent" | "mcp" | "llm" {
  const t = (rawType ?? "").toLowerCase();
  if (t.includes("mcp")) return "mcp";
  if (t.includes("llm")) return "llm";
  if (t.includes("agent")) return "agent";
  return fallback;
}

function canonicalAssetId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .replace(/\b(hosted|mcp|server|asset)\b/g, "")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function isGovernedPublicAsset(publicAssetId: string, governedCanonicalIds: Set<string>): boolean {
  // Governing a public MuleSoft MCP creates an instance in the caller's own org
  // whose assetId may differ from the public one (e.g. the public
  // "salesforce-sobject-all-asset" governs to "salesforce-hosted-mcp-server-
  // sobject-all"). Canonicalizing both — stripping the hosted/mcp/server/asset
  // boilerplate — makes them compare equal, while exact matches (github-asset,
  // mulesoft-platform-mcp-server) still line up. We require canonical EQUALITY
  // (not substring containment) to avoid false positives across the 100+ public
  // catalog.
  const target = canonicalAssetId(publicAssetId);
  if (!target) return false;
  return governedCanonicalIds.has(target);
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;
  const parsed = RequestSchema.safeParse({
    organizationId: request.nextUrl.searchParams.get("organizationId"),
    q: request.nextUrl.searchParams.get("q") ?? "",
    kinds: request.nextUrl.searchParams.get("kinds") ?? "agent,mcp,llm",
    includeBusinessGroup: request.nextUrl.searchParams.get("includeBusinessGroup") ?? "true",
    includeMulesoftSupplied: request.nextUrl.searchParams.get("includeMulesoftSupplied") ?? "false",
  });
  if (!parsed.success) return validationError(parsed.error);

  const { organizationId, q, kinds } = parsed.data;
  const includeBusinessGroup = parsed.data.includeBusinessGroup === "true";
  const includeMulesoftSupplied = parsed.data.includeMulesoftSupplied === "true";
  const requestedKinds = kinds
    .split(",")
    .map((k) => k.trim())
    .filter((k): k is "agent" | "mcp" | "llm" => k === "agent" || k === "mcp" || k === "llm");

  const searchTypes = requestedKinds.map((k) => KIND_TO_SEARCH_TYPE[k]);
  const authHeader = { Authorization: `Bearer ${accessToken}` };
  const fallbackKind = requestedKinds[0] ?? "agent";

  // Run BG search, public MuleSoft search, and (only when we need it to
  // annotate public results) the org's governed-asset lookup in parallel.
  const [bgResult, publicHits, governedAssetIds] = await Promise.all([
    includeBusinessGroup
      ? searchExchangeAssets(baseUrl, organizationId, q || "", authHeader, fetch, searchTypes)
      : Promise.resolve({ hits: [], attempt: "none" as const }),
    includeMulesoftSupplied
      ? searchMulesoftSuppliedAssets(baseUrl, q || "", authHeader, fetch, searchTypes)
      : Promise.resolve([]),
    includeMulesoftSupplied
      ? fetchGovernedAssetIds(baseUrl, organizationId, authHeader, fetch)
      : Promise.resolve(new Set<string>()),
  ]);

  const { hits: scopedHits, attempt } = bgResult;

  // Precompute canonical forms of the org's governed asset ids once, so each
  // public hit is a single O(1) set lookup rather than a scan.
  const governedCanonicalIds = new Set<string>();
  for (const id of governedAssetIds) {
    const c = canonicalAssetId(id);
    if (c) governedCanonicalIds.add(c);
  }

  // Dedupe by groupId:assetId, keeping the first (highest-ranked) hit. BG hits
  // rank ahead of public hits when the same asset appears in both.
  const byKey = new Map<string, ExchangeSearchResultItem>();

  const addHit = (
    h: { groupId: string; assetId: string; name?: string; version?: string; type?: string },
    source: "business-group" | "mulesoft-supplied"
  ) => {
    const key = `${h.groupId}:${h.assetId}`;
    if (byKey.has(key)) return;
    byKey.set(key, {
      groupId: h.groupId,
      assetId: h.assetId,
      name: h.name ?? h.assetId,
      version: h.version ?? null,
      kind: normalizeKind(h.type, fallbackKind),
      rawType: h.type,
      source,
      // BG assets are inherently in the caller's org; public assets are
      // "governed" only when they resolve to a node in the org's fabric.
      governed:
        source === "business-group" || isGovernedPublicAsset(h.assetId, governedCanonicalIds),
    });
  };

  for (const h of scopedHits) addHit(h, "business-group");
  for (const h of publicHits) addHit(h, "mulesoft-supplied");

  const results = Array.from(byKey.values());

  return NextResponse.json({ results, total: results.length, attempt });
}
