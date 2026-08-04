/**
 * Shared types for broker-task discovery.
 * Both strategies (msearch and runtime-logs) produce the same BrokerTask shape
 * so the route handler and UI don't care which path was used.
 */

/** Mutable accumulator used while parsing logs/hits. */
export interface BrokerTaskAccumulator {
  taskId: string;
  contextId: string;
  broker: string;
  firstTool: string;
  startTime: string;
  endTime: string | null;
  maxIteration: number;
  toolsUsed: Set<string>;
  appId: string;
  apiInstanceId: string;
  logCount: number;
  /** Synthetic error-only runs get "error"; normal runs are undefined. */
  status?: "error";
}

/** Serialised task returned to the client. */
export interface BrokerTask {
  taskId: string;
  contextId: string;
  broker: string;
  firstTool: string;
  startTime: string;
  endTime: string | null;
  duration: string | null;
  maxIteration: number;
  toolsUsed: string[];
  appId: string;
  apiInstanceId: string;
  logCount: number;
  status?: "error";
}

/** Single _msearch probe — totals + one-hit summary (no full document dump). */
export interface MsearchProbeSummary {
  lucene: string;
  total: number;
  returned: number;
  shardFailures?: number;
  error?: string;
  sampleSourceKeys?: string[];
  /** Truncated for safe inspection */
  messagePreview?: string;
  sampleAppId?: string;
  sampleApiInstanceId?: string | number;
}

/**
 * What Elasticsearch actually returned for org-wide / wildcard / filtered queries
 * (so you can tell “no data in index” vs “data exists but taskId parse failed” vs
 * “apiInstanceId filter too narrow”).
 */
export interface MsearchDiagnostics {
  timeRangeIso: { from: string; to: string };
  filteredQuery: MsearchProbeSummary & { hitsFetched: number };
  /** `orgId=<uuid>` only — any monitoring log for the org in the window */
  orgOnlyQuery?: MsearchProbeSummary;
  /** Lucene `*` — sample of any log in the time window (confirms the index is non-empty) */
  wildcardQuery?: MsearchProbeSummary;
  brokerAppPostFilter?: { brokerAppName?: string; beforeHits: number; afterHits: number };
  /** Distinct taskIds extracted from messages after post-filter (before apiInstanceId final filter) */
  uniqueTaskIdsParsed: number;
  /** Which Lucene strategies were used (e.g. ["apiInstanceId", "appId"]) */
  queriesUsed?: string[];
}

/** Unified result from either strategy. */
export interface BrokerTasksResult {
  tasks: BrokerTask[];
  source: "msearch" | "runtime-logs";
  totalLogs: number;
  mode?: "no-entitlement";
  msearchDiagnostics?: MsearchDiagnostics;
}

/** Convert accumulator → serialised task, computing duration. */
export function finaliseTasks(
  accumulators: BrokerTaskAccumulator[],
  filterApiInstanceId?: string
): BrokerTask[] {
  const filtered = filterApiInstanceId
    ? accumulators.filter(
        (t) => t.apiInstanceId === filterApiInstanceId || t.status === "error"
      )
    : accumulators;

  return filtered
    .map((t) => {
      let duration: string | null = null;
      if (t.startTime && t.endTime) {
        try {
          const s = new Date(t.startTime).getTime();
          const e = new Date(t.endTime).getTime();
          duration = ((e - s) / 1000).toFixed(1);
        } catch {
          /* ignore */
        }
      }
      return {
        taskId: t.taskId,
        contextId: t.contextId,
        broker: t.broker,
        firstTool: t.firstTool,
        startTime: t.startTime,
        endTime: t.endTime,
        duration,
        maxIteration: t.maxIteration,
        toolsUsed: Array.from(t.toolsUsed),
        appId: t.appId,
        apiInstanceId: t.apiInstanceId,
        logCount: t.logCount,
        ...(t.status ? { status: t.status } : {}),
      };
    })
    .sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""));
}
