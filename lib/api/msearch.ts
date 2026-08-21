import { logSearch } from "@/lib/api/log-search";

export interface MSearchOptions {
  size?: number;
  from?: number;
  /** @deprecated Ignored: timestamp sort caused ES fielddata failures on monitoring indices. */
  sortOrder?: "asc" | "desc";
  timeRangeMs?: number;
  /**
   * Anypoint environment id. Applied as a shard-side `envId` filter — see
   * {@link LogSearchParams.envId}. Org routing is separate and still handled by
   * the OSD client via `x-active-org-id`.
   */
  envId?: string;
  /** Restrict `_source` to these fields — see {@link LogSearchParams.sourceFields}. */
  sourceFields?: string[];
}

/** The only `_source` fields the broker-task and callstack parsers read. */
export const TASK_PARSE_SOURCE_FIELDS = ["timestamp", "message", "appId", "logger"] as const;

/**
 * Server-side prefilter for log lines that can yield a task id.
 *
 * The broker's graph runtime logs snake_case `task_id=<uuid>` (verified live:
 * 2,049 lines from `module_graph_runtime.core.graph.executor` in 30 days) while
 * the Flex gateway logs the A2A JSON-RPC body containing `taskId`. Searching
 * only for `taskId` therefore missed every broker line, which is why the
 * strategy used to page unfiltered app logs and throw ~99.9% of them away.
 *
 * Keep this in sync with the `task` / `jsonTask` patterns the hit parser uses.
 */
export const TASK_BEARING_MESSAGE_CLAUSE = 'message: ("taskId" OR "task_id")';

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
  const { size = 500, from = 0, timeRangeMs = 30 * 24 * 3600 * 1000, sourceFields, envId } = opts;

  const result = await logSearch({
    orgId,
    accessToken,
    baseUrl,
    luceneQuery,
    size,
    from,
    timeRangeMs,
    sourceFields,
    envId,
  });

  if (result.error === "LOG_SEARCH_UNAVAILABLE") {
    return { total: 0, hits: [], raw: result.raw, error: "MSEARCH_UNAVAILABLE", httpStatus: result.httpStatus };
  }

  return { total: result.total, hits: result.hits, raw: result.raw };
}
