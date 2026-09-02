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
  /** Display name of the org that publishes the asset (e.g. "MuleSoft"). */
  organizationName?: string;
  /** Owning org id of the asset. */
  organizationId?: string;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Exchange marks provider-managed assets (GitHub MCP, Salesforce SObject MCP,
 * MuleSoft Platform MCP, etc.) with `organizationName === "MuleSoft"`. This is
 * the same signal behind the Exchange UI's "Provided by MuleSoft" filter and is
 * control-plane agnostic — unlike the provider org's UUID/groupId, which differs
 * per control plane (US/EU/…). We match on it instead of hardcoding any org id.
 */
export const MULESOFT_PROVIDER_ORG_NAME = "mulesoft";

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
  POLICY: "policy",
} as const;

/** ang/_search needs the digital-repository URI form of each type for `assets.@type`. */
const DIGITAL_REPOSITORY_PATH = "http://anypoint.com/vocabs/digital-repository";
const ANG_TYPE_URI: Record<string, string> = {
  "agent-network": `${DIGITAL_REPOSITORY_PATH}#AgentNetworkAsset`,
  agent: `${DIGITAL_REPOSITORY_PATH}#AgentAsset`,
  "agent-domain": `${DIGITAL_REPOSITORY_PATH}#AgentDomainAsset`,
  mcp: `${DIGITAL_REPOSITORY_PATH}#MCPAsset`,
  llm: `${DIGITAL_REPOSITORY_PATH}#LLMAsset`,
  policy: `${DIGITAL_REPOSITORY_PATH}#PolicyAsset`,
};

interface PseasHit {
  source?: {
    groupId?: string;
    assetId?: string;
    name?: string;
    assetType?: string;
    majorVersion?: string;
    minorVersion?: string;
    organizationName?: string;
    organizationId?: string;
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
    organizationName: src.organizationName,
    organizationId: src.organizationId,
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
 * Lists MuleSoft-supplied (provider-managed) assets for the given types.
 *
 * How this works, and why there is no hardcoded org id:
 *
 * An unscoped pseas search returns every asset the caller can see — their own
 * business-group assets AND the provider (MuleSoft) catalog — each hit tagged
 * with the publishing org's `organizationName`. Exchange's UI "Provided by
 * MuleSoft" filter is simply `organizationName === "MuleSoft"`, so we replicate
 * that client-side. This matches on every control plane (US/EU/gov/…) because
 * the provider org's display name is stable, whereas its UUID/groupId is not.
 *
 * We deliberately do NOT gate on "has instances": when a customer governs a
 * public MuleSoft MCP, the instance is registered in THEIR org, not in the
 * provider org — so the public asset never reports instances. Governed status
 * is determined separately (see governed-assets) and results are simply
 * annotated rather than filtered.
 */
export async function searchMulesoftSuppliedAssets(
  baseUrl: string,
  searchTerm: string,
  authHeader: Record<string, string>,
  fetchFn: FetchFn = fetch,
  types: string[] = [EXCHANGE_SEARCH_TYPES.MCP]
): Promise<ExchangeSearchHit[]> {
  const body: Record<string, unknown> = {
    // The provider catalog is large (100+ MCPs); pull a wide page so the full
    // "Provided by MuleSoft" list survives the client-side org filter below.
    size: 250,
    search: searchTerm,
  };
  if (types.length > 0) body.types = types;

  let hits: PseasHit[] = [];
  try {
    const res = await fetchFn(`${baseUrl}/exchange/api/v2/pseas/_search`, {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = (await res.json()) as { hits?: PseasHit[] };
      hits = data.hits ?? [];
    }
  } catch {
    return [];
  }

  const byKey = new Map<string, ExchangeSearchHit>();
  for (const raw of hits) {
    const hit = mapPseasHit(raw);
    if (!hit) continue;
    if ((hit.organizationName ?? "").trim().toLowerCase() !== MULESOFT_PROVIDER_ORG_NAME) {
      continue;
    }
    const key = `${hit.groupId}:${hit.assetId}`;
    if (!byKey.has(key)) byKey.set(key, hit);
  }
  return Array.from(byKey.values());
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

/**
 * Lists every asset owned by `organizationId`, across all types, with NO search
 * term. This is the "stubborn teardown" listing: a normal teardown searches by
 * network name and misses orphaned agent/mcp/llm assets a failed CLI delete left
 * behind, so here we enumerate the whole business group instead.
 *
 * We omit `search` entirely (rather than sending `""`) so pseas treats the query
 * as "everything this org owns" instead of a keyword match, and omit `types` so
 * every asset type comes back. Results are deduped to one row per asset (latest
 * version); the caller resolves every version before deleting.
 */
export async function listAllExchangeAssetsInOrg(
  baseUrl: string,
  organizationId: string,
  authHeader: Record<string, string>,
  fetchFn: FetchFn = fetch,
  size = 250,
  types: string[] = []
): Promise<ExchangeSearchHit[]> {
  const body: Record<string, unknown> = {
    size,
    organizationId: [organizationId],
  };
  if (types.length > 0) body.types = types;

  let hits: PseasHit[] = [];
  try {
    const res = await fetchFn(`${baseUrl}/exchange/api/v2/pseas/_search`, {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { hits?: PseasHit[] };
    hits = data.hits ?? [];
  } catch {
    return [];
  }

  const byKey = new Map<string, ExchangeSearchHit>();
  for (const raw of hits) {
    const hit = mapPseasHit(raw);
    if (!hit) continue;
    // Only assets actually owned by this business group — an unscoped index can
    // leak provider/shared rows, and we must never offer to delete those.
    if (hit.organizationId && hit.organizationId !== organizationId) continue;
    const key = `${hit.groupId}:${hit.assetId}`;
    if (!byKey.has(key)) byKey.set(key, hit);
  }
  return Array.from(byKey.values());
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
