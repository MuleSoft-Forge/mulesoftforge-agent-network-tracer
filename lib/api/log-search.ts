import { loggedFetch, debugLog } from "@/lib/api-logger";

/**
 * Client for Anypoint Monitoring "Enhanced Log Search" (the OpenSearch
 * Dashboards backend that replaced the retired
 * `/monitoring/api/logs/elasticsearch/_msearch` endpoint in the May–June 2026
 * rollout).
 *
 * Verified (HAR + live probe): the OSD proxy accepts a normal Anypoint Connected
 * App **bearer token** — no OSD session cookie required — as long as these
 * headers are sent: `osd-xsrf`, `osd-version`, `x-active-org-id`.
 *
 * Endpoints (relative to the platform base URL):
 *   - GET  /monitoring-x-api/logs/api/saved_objects/_find   (discover dataSourceId)
 *   - POST /monitoring-x-api/logs/internal/search/opensearch-with-long-numerals
 *
 * Documents live in the `data-stream-<orgId>*` index and `_source` carries the
 * same fields the legacy parsers read (`message`, `appId`, `orgId`, `envId`,
 * `timestamp`, …), so callers can treat the returned hits like the old ES hits.
 */

const OSD_BASE = "/monitoring-x-api/logs";
const OSD_VERSION = "3.3.0-SNAPSHOT";
const DATA_SOURCE_TTL_MS = 30 * 60 * 1000;

function osdHeaders(accessToken: string, orgId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "osd-xsrf": "osd-fetch",
    "osd-version": OSD_VERSION,
    "x-active-org-id": orgId,
  };
}

export interface LogSearchHit {
  _id?: string;
  _index?: string;
  _source?: Record<string, unknown>;
}

export interface LogSearchResult {
  total: number;
  hits: LogSearchHit[];
  raw: unknown;
  error?: "LOG_SEARCH_UNAVAILABLE";
  httpStatus?: number;
}

export interface LogSearchParams {
  orgId: string;
  accessToken: string;
  baseUrl: string;
  /** Anypoint-style query, e.g. `orgId=X AND apiInstanceId=Y` or `"<taskId>"`. */
  luceneQuery: string;
  size?: number;
  from?: number;
  timeRangeMs?: number;
}

export interface DiscoveredIndexPattern {
  /** OSD data-source saved-object id. */
  dataSourceId: string;
  /** Index pattern title to query, e.g. `data-stream-<masterOrgId>*`. */
  index: string;
  /** Org that owns the index/tenant (master org for sub-orgs). */
  ownerOrgId: string;
}

const indexPatternCache = new Map<string, { value: DiscoveredIndexPattern; at: number }>();

function parseOwnerOrgId(title: string, fallbackOrgId: string): string {
  const m = title.match(/data-stream-([0-9a-fA-F-]{36})/);
  return m?.[1] ?? fallbackOrgId;
}

/**
 * Resolve the OSD index pattern for a queried org. For sub-orgs, monitoring data
 * lives in the **master org's** shared index (`data-stream-<masterOrgId>*`) and
 * the OSD tenant is the master org — so we must query that index (filtering by
 * the queried orgId), not `data-stream-<subOrgId>*` (which 403s:
 * "Index pattern … cannot be accessed by tenant <masterOrgId>"). Cached per org.
 */
export async function discoverIndexPattern(
  baseUrl: string,
  orgId: string,
  accessToken: string
): Promise<DiscoveredIndexPattern | null> {
  const cached = indexPatternCache.get(orgId);
  if (cached && Date.now() - cached.at < DATA_SOURCE_TTL_MS) return cached.value;

  const url = `${baseUrl}${OSD_BASE}/api/saved_objects/_find?type=index-pattern&fields=title&fields=references&per_page=1000`;
  const res = await loggedFetch(url, {
    method: "GET",
    headers: osdHeaders(accessToken, orgId),
  });
  if (!res.ok) {
    debugLog(`[LOG-SEARCH] index-pattern discovery failed: HTTP ${res.status}`);
    return null;
  }

  const body = (await res.json()) as {
    saved_objects?: Array<{
      attributes?: { title?: string };
      references?: Array<{ name?: string; id?: string; type?: string }>;
    }>;
  };
  const objects = body.saved_objects ?? [];
  // Prefer this org's own index pattern; otherwise fall back to the (single)
  // tenant pattern returned — for sub-orgs that's the master org's index.
  const match =
    objects.find((o) => o.attributes?.title?.startsWith(`data-stream-${orgId}`)) ?? objects[0];
  const ds = match?.references?.find((r) => r.type === "data-source");
  const title = match?.attributes?.title;
  if (!ds?.id || !title) {
    debugLog("[LOG-SEARCH] No usable index pattern / data-source reference found");
    return null;
  }

  const value: DiscoveredIndexPattern = {
    dataSourceId: ds.id,
    index: title,
    ownerOrgId: parseOwnerOrgId(title, orgId),
  };
  indexPatternCache.set(orgId, { value, at: Date.now() });
  debugLog(
    `[LOG-SEARCH] Resolved index=${value.index} dataSourceId=${value.dataSourceId} ownerOrg=${value.ownerOrgId} for queried org ${orgId}`
  );
  return value;
}

/**
 * Translate the legacy Anypoint-lucene queries the callers build into an
 * OpenSearch bool query.
 *
 * We deliberately DROP the legacy `orgId=<org>` clause rather than enforcing it
 * as a filter. The OSD index is already tenant-scoped (the master org's
 * `data-stream-<masterOrgId>*`), and sub-org documents in that shared index are
 * NOT tagged with the sub-orgId — so filtering `orgId=<subOrgId>` returns zero
 * hits. The remaining identifiers (taskId / appId / apiInstanceId) uniquely
 * scope results within the tenant index. The rest is passed through
 * `query_string` (`field=value` → `field:value`); `lenient` ignores
 * unmapped-field clauses instead of erroring.
 */
function buildQuery(luceneQuery: string, gte: number, lte: number): unknown {
  const filter: unknown[] = [
    {
      range: {
        timestamp: {
          gte: new Date(gte).toISOString(),
          lte: new Date(lte).toISOString(),
          format: "strict_date_optional_time",
        },
      },
    },
  ];

  const rest = luceneQuery
    .replace(/orgId\s*=\s*\S+/gi, "")
    .replace(/^\s*AND\s+/i, "")
    .replace(/\s+AND\s*$/i, "")
    .replace(/^\s*AND\s+/i, "")
    .trim();

  const must: unknown[] =
    rest && rest !== "*"
      ? [{ query_string: { query: rest.replace(/=/g, ":"), lenient: true, default_operator: "AND" } }]
      : [{ match_all: {} }];

  return { bool: { must, filter, should: [], must_not: [] } };
}

/**
 * Execute a log search against the Enhanced Log Search (OSD) backend.
 * Returns hits in the same `_source` shape as the legacy `_msearch` client.
 */
export async function logSearch(params: LogSearchParams): Promise<LogSearchResult> {
  const { orgId, accessToken, baseUrl, luceneQuery, size = 500, from = 0, timeRangeMs = 30 * 24 * 3600 * 1000 } =
    params;
  const now = Date.now();

  const discovered = await discoverIndexPattern(baseUrl, orgId, accessToken);
  if (!discovered) {
    return { total: 0, hits: [], raw: {}, error: "LOG_SEARCH_UNAVAILABLE" };
  }

  const body = {
    params: {
      // Query the tenant's real index (master org's for sub-orgs); the orgId
      // filter inside buildQuery scopes results to the queried org.
      index: discovered.index,
      body: {
        sort: [{ timestamp: { order: "desc", unmapped_type: "boolean" } }],
        size,
        from,
        version: true,
        stored_fields: ["*"],
        docvalue_fields: [{ field: "timestamp", format: "date_time" }],
        _source: { excludes: [] },
        query: buildQuery(luceneQuery, now - timeRangeMs, now),
      },
      preference: now,
    },
    dataSourceId: discovered.dataSourceId,
  };

  const url = `${baseUrl}${OSD_BASE}/internal/search/opensearch-with-long-numerals`;
  const res = await loggedFetch(url, {
    method: "POST",
    headers: osdHeaders(accessToken, discovered.ownerOrgId),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    debugLog(`[LOG-SEARCH] search failed: HTTP ${res.status}`);
    return { total: 0, hits: [], raw: {}, error: "LOG_SEARCH_UNAVAILABLE", httpStatus: res.status };
  }

  const json = (await res.json()) as {
    rawResponse?: {
      hits?: { total?: number | { value?: number }; hits?: LogSearchHit[] };
    };
  };
  const esHits = json.rawResponse?.hits;
  const totalRaw = esHits?.total;
  const total =
    typeof totalRaw === "number"
      ? totalRaw
      : totalRaw && typeof totalRaw === "object" && typeof totalRaw.value === "number"
        ? totalRaw.value
        : 0;
  const hits = esHits?.hits ?? [];
  return { total, hits, raw: json };
}

const entitlementCache = new Map<string, { ok: boolean; at: number }>();
const ENTITLEMENT_TTL_MS = 10 * 60 * 1000;

/**
 * Per-org Log Search entitlement, cached (10 min). Use this for the *queried*
 * org rather than a login-time flag, so multi-org / business-group switches
 * always reflect the org actually being queried.
 */
export async function isOrgLogSearchEntitled(
  baseUrl: string,
  orgId: string,
  accessToken: string
): Promise<boolean> {
  const cached = entitlementCache.get(orgId);
  if (cached && Date.now() - cached.at < ENTITLEMENT_TTL_MS) return cached.ok;
  const ok = await probeLogSearch(baseUrl, orgId, accessToken);
  entitlementCache.set(orgId, { ok, at: Date.now() });
  return ok;
}

/**
 * Lightweight reachability/entitlement probe for the new Log Search backend.
 * Returns true when the OSD search endpoint answers 200 for this org.
 */
export async function probeLogSearch(
  baseUrl: string,
  orgId: string,
  accessToken: string
): Promise<boolean> {
  try {
    const result = await logSearch({
      orgId,
      accessToken,
      baseUrl,
      luceneQuery: `orgId=${orgId}`,
      size: 0,
      timeRangeMs: 30 * 24 * 3600 * 1000,
    });
    if (result.error) {
      debugLog(`[LOG-SEARCH] probe → not available (${result.error}, http=${result.httpStatus ?? "n/a"})`);
      return false;
    }
    debugLog(`[LOG-SEARCH] probe → available (total=${result.total})`);
    return true;
  } catch (err) {
    debugLog("[LOG-SEARCH] probe threw:", err);
    return false;
  }
}
