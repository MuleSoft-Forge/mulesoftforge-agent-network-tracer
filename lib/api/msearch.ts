import { logSearch } from "@/lib/api/log-search";

export interface MSearchOptions {
  size?: number;
  from?: number;
  /** @deprecated Ignored: timestamp sort caused ES fielddata failures on monitoring indices. */
  sortOrder?: "asc" | "desc";
  timeRangeMs?: number;
  /** @deprecated Routing is handled by the OSD client (x-active-org-id). */
  envId?: string;
}

export interface MSearchResult {
  total: number;
  hits: unknown[];
  raw: unknown;
  error?: "MONITORING_CENTER_PREMIUM_REQUIRED" | "MSEARCH_UNAVAILABLE";
  /** HTTP status when `error` is set (e.g. 404 for proxy users). */
  httpStatus?: number;
  /** ES `_shards.failed` when present — sorting on `timestamp` used to blow up shards (text field / no fielddata). */
  shardFailures?: number;
}

/**
 * Execute a log search against Anypoint Monitoring.
 *
 * Delegates to the Enhanced Log Search (OpenSearch Dashboards) client. The
 * legacy `/monitoring/api/logs/elasticsearch/_msearch` endpoint was retired in
 * the 2026 rollout; this shim keeps the old call signature and `MSearchResult`
 * shape so callers and hit parsers stay unchanged.
 */
export async function msearch(
  orgId: string,
  luceneQuery: string,
  opts: MSearchOptions = {},
  accessToken: string,
  baseUrl: string
): Promise<MSearchResult> {
  const { size = 500, from = 0, timeRangeMs = 30 * 24 * 3600 * 1000 } = opts;

  const result = await logSearch({
    orgId,
    accessToken,
    baseUrl,
    luceneQuery,
    size,
    from,
    timeRangeMs,
  });

  if (result.error === "LOG_SEARCH_UNAVAILABLE") {
    return { total: 0, hits: [], raw: result.raw, error: "MSEARCH_UNAVAILABLE", httpStatus: result.httpStatus };
  }

  return { total: result.total, hits: result.hits, raw: result.raw };
}
