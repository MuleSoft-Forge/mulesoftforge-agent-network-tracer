import { loggedFetch, debugLog } from "@/lib/api-logger";

export interface MSearchOptions {
  size?: number;
  from?: number;
  /** @deprecated Ignored: timestamp sort caused ES fielddata failures on monitoring indices. */
  sortOrder?: "asc" | "desc";
  timeRangeMs?: number;
}

export interface MSearchResult {
  total: number;
  hits: unknown[];
  raw: unknown;
  error?: "MONITORING_CENTER_PREMIUM_REQUIRED";
  /** ES `_shards.failed` when present — sorting on `timestamp` used to blow up shards (text field / no fielddata). */
  shardFailures?: number;
}

/**
 * Execute Elasticsearch _msearch query via Anypoint Monitoring API
 */
export async function msearch(
  orgId: string,
  luceneQuery: string,
  opts: MSearchOptions = {},
  accessToken: string,
  baseUrl: string
): Promise<MSearchResult> {
  const { size = 500, from = 0, timeRangeMs = 30 * 24 * 3600 * 1000 } = opts;
  const now = Date.now();
  // Anypoint's API doesn't support wildcard patterns in _msearch index field
  // Use empty array to search all indices, then filter by orgId in the query
  //
  // Do NOT sort on `timestamp`: many monitoring indices map it as text → fielddata errors on
  // hundreds of shards → empty `hits` even when docs match. Callers paginate with `from`/`size`;
  // order is unstable across pages but broker-task discovery tolerates that for typical volumes.
  const ndjson = [
    JSON.stringify({ index: [], ignore_unavailable: true, preference: now }),
    JSON.stringify({
      version: true,
      size,
      from,
      _source: { excludes: [] },
      stored_fields: ["*"],
      docvalue_fields: ["timestamp"],
    }),
    JSON.stringify({
      filter: [
        {
          range: {
            timestamp: {
              gte: now - timeRangeMs,
              lte: now,
              format: "epoch_millis",
            },
          },
        },
      ],
      query: [{ query: luceneQuery, language: "lucene" }],
    }),
  ].join("\n") + "\n";

  const url = `${baseUrl}/monitoring/api/logs/elasticsearch/_msearch`;
  const res = await loggedFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-ndjson",
    },
    body: ndjson,
  });

  if (!res.ok) {
    const text = await res.text();
    // Check for Monitoring Center Premium entitlement error first
    if (res.status === 403 && text.includes("Monitoring Center Premium")) {
      // Don't log this as an error - it's an expected entitlement issue
      return { total: 0, hits: [], raw: {}, error: "MONITORING_CENTER_PREMIUM_REQUIRED" };
    }
    throw new Error(`_msearch ${res.status}: ${text.slice(0, 200)}`);
  }

  const raw = await res.json();
  const r = (raw.responses || [])[0] || {};
  const shards = r._shards as { failed?: number; total?: number; successful?: number } | undefined;
  const shardFailures = typeof shards?.failed === "number" ? shards.failed : 0;
  if (shardFailures > 0) {
    debugLog(
      `[msearch] Elasticsearch partial failure: _shards.failed=${shardFailures} total=${shards?.total} successful=${shards?.successful} (check ENABLE_API_LOGGING for full body)`
    );
  }
  const hits = (r.hits && r.hits.hits) || [];
  const totalRaw = r.hits && r.hits.total;
  const total =
    typeof totalRaw === "number"
      ? totalRaw
      : totalRaw && typeof totalRaw === "object" && typeof totalRaw.value === "number"
        ? totalRaw.value
        : 0;
  return { total, hits, raw, ...(shardFailures > 0 ? { shardFailures } : {}) };
}
