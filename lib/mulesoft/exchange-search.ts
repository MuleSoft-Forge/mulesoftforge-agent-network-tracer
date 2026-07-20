/**
 * Exchange asset search — ported from MuleSoft's own `mulesoft-mcp-server`
 * (`packages/mule-exchange-services/src/services/searchAssets.ts`), the real
 * implementation behind the official `search_asset` MCP tool.
 *
 * Primary: POST /exchange/api/v2/pseas/_search (hybrid keyword + semantic).
 * Fallback: GET /exchange/api/v2/ang/_search (legacy Lucene keyword).
 *
 * Neither is on the documented `/assets/search` (getAssetsSearch) contract —
 * that op has no `search` term parameter at all. These two are what Exchange's
 * own UI and MuleSoft's own tooling actually call.
 */

export interface ExchangeSearchHit {
  groupId: string;
  assetId: string;
  name?: string;
  version?: string;
  type?: string;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Search filter values recognized by pseas/ang (from mule-exchange-services
 * `SearchAssetFilter` enum). `agent-network` and `agent` are both real,
 * distinct asset types here — `agent-network` is not a phantom value.
 */
export const EXCHANGE_SEARCH_TYPES = {
  AGENT_NETWORK: "agent-network",
  AGENT: "agent",
  AGENT_DOMAIN: "agent-domain",
  MCP: "mcp",
  LLM: "llm",
} as const;

/** ang/_search needs the digital-repository URI form of each type for `assets.@type`. */
const DIGITAL_REPOSITORY_PATH = "http://anypoint.com/vocabs/digital-repository";
const ANG_TYPE_URI: Record<string, string> = {
  "agent-network": `${DIGITAL_REPOSITORY_PATH}#AgentNetworkAsset`,
  agent: `${DIGITAL_REPOSITORY_PATH}#AgentAsset`,
  "agent-domain": `${DIGITAL_REPOSITORY_PATH}#AgentDomainAsset`,
  mcp: `${DIGITAL_REPOSITORY_PATH}#MCPAsset`,
  llm: `${DIGITAL_REPOSITORY_PATH}#LLMAsset`,
};

interface PseasHit {
  source?: {
    groupId?: string;
    assetId?: string;
    name?: string;
    assetType?: string;
    majorVersion?: string;
    minorVersion?: string;
    patch?: Array<{ semverVersion?: { value?: string } }>;
  };
}

function mapPseasHit(hit: PseasHit): ExchangeSearchHit | null {
  const src = hit.source;
  if (!src?.groupId || !src?.assetId) return null;
  const latestPatch = src.patch?.[0]?.semverVersion?.value;
  return {
    groupId: src.groupId,
    assetId: src.assetId,
    name: src.name,
    version: latestPatch ?? `${src.majorVersion ?? ""}.${src.minorVersion ?? ""}`,
    type: src.assetType,
  };
}

async function searchViaPseas(
  baseUrl: string,
  organizationId: string,
  searchTerm: string,
  types: string[],
  authHeader: Record<string, string>,
  fetchFn: FetchFn
): Promise<ExchangeSearchHit[] | null> {
  const url = `${baseUrl}/exchange/api/v2/pseas/_search`;
  const body: Record<string, unknown> = {
    size: 15,
    organizationId: [organizationId],
    search: searchTerm,
  };
  if (types.length > 0) body.types = types;

  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { hits?: PseasHit[] };
    const hits = (data.hits ?? []).map(mapPseasHit).filter((h): h is ExchangeSearchHit => h !== null);
    return hits;
  } catch {
    return null;
  }
}

interface AngHit {
  _source?: {
    "asset-minor-versions"?: Record<string, unknown[]>;
    assets?: Record<string, unknown[]>;
  };
}

function mapAngHit(hit: AngHit): ExchangeSearchHit | null {
  const source = hit._source;
  if (!source) return null;
  const versions = source["asset-minor-versions"];
  const assets = source["assets"];
  const groupId = versions?.["MinorVersionNode.groupId"]?.[0] as string | undefined;
  const assetId = versions?.["MinorVersionNode.assetId"]?.[0] as string | undefined;
  if (!groupId || !assetId) return null;
  const major = versions?.["MinorVersionNode.majorVersionComponent"]?.[0];
  const minor = versions?.["MinorVersionNode.minorVersionComponent"]?.[0];
  return {
    groupId,
    assetId,
    name: (assets?.["AssetNode.name"]?.[0] as string | undefined) ?? assetId,
    version: major != null && minor != null ? `${major}.${minor}` : undefined,
  };
}

async function searchViaAng(
  baseUrl: string,
  organizationId: string,
  searchTerm: string,
  types: string[],
  authHeader: Record<string, string>,
  fetchFn: FetchFn
): Promise<ExchangeSearchHit[]> {
  const params = new URLSearchParams();
  params.append("q", searchTerm);
  params.append("_size", "15");
  params.append("_source", "asset-minor-versions.MinorVersionNode.*");
  params.append("_source", "assets.AssetNode.*");
  for (const t of types) {
    const uri = ANG_TYPE_URI[t];
    if (uri) params.append("assets.@type", uri);
  }
  params.append("k:assets.AssetNode.organizationId", organizationId);
  params.append("_boost", "assets.AssetNode.name^10");

  const url = `${baseUrl}/exchange/api/v2/ang/_search?${params.toString()}`;
  const res = await fetchFn(url, { headers: authHeader });
  if (!res.ok) return [];
  const data = (await res.json()) as { hits?: AngHit[] };
  return (data.hits ?? []).map(mapAngHit).filter((h): h is ExchangeSearchHit => h !== null);
}

/**
 * Searches Exchange for assets matching `searchTerm`, scoped to `organizationId`
 * and optionally filtered by `types` (e.g. `["agent-network"]`). Tries pseas
 * first, then falls back to ang — matching the real MCP server's own fallback
 * order and 0-result handling.
 */
export async function searchExchangeAssets(
  baseUrl: string,
  organizationId: string,
  searchTerm: string,
  authHeader: Record<string, string>,
  fetchFn: FetchFn = fetch,
  types: string[] = []
): Promise<{ hits: ExchangeSearchHit[]; attempt: "pseas" | "ang" | "none" }> {
  const pseasHits = await searchViaPseas(baseUrl, organizationId, searchTerm, types, authHeader, fetchFn);
  if (pseasHits && pseasHits.length > 0) {
    return { hits: pseasHits, attempt: "pseas" };
  }

  const angHits = await searchViaAng(baseUrl, organizationId, searchTerm, types, authHeader, fetchFn);
  if (angHits.length > 0) {
    return { hits: angHits, attempt: "ang" };
  }

  return { hits: [], attempt: "none" };
}

/** Exchange v2 REST responses sometimes wrap payloads as `{ value: T }`. */
export function normalizeExchangeDetail(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  if (o.value && typeof o.value === "object" && !Array.isArray(o.value)) {
    return o.value as Record<string, unknown>;
  }
  return o;
}
