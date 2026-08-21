/**
 * Strategy A: Discover broker tasks via Anypoint Monitoring _msearch (Elasticsearch).
 * Requires Monitoring Center Premium entitlement.
 *
 * This module is ONLY about _msearch. It does not touch AMC /logs, Runtime Manager,
 * or deployment resolution. Keep it that way so fixes here don't break the runtime-logs path.
 */

import { debugLog } from "@/lib/api-logger";
import { isHyperscaleDeploymentType, logSearchAppIdCandidates } from "@/lib/broker-context/log-search-ids";
import { msearch, TASK_BEARING_MESSAGE_CLAUSE, TASK_PARSE_SOURCE_FIELDS } from "@/lib/api/msearch";
import type { MSearchResult } from "@/lib/api/msearch";
import type { PhaseTimer } from "@/lib/api/timing";
import type {
  BrokerTaskAccumulator,
  BrokerTasksResult,
  MsearchDiagnostics,
  MsearchProbeSummary,
} from "./types";
import { finaliseTasks } from "./types";

export interface MSearchStrategyParams {
  orgId: string;
  apiInstanceId: string;
  accessToken: string;
  baseUrl: string;
  timeRangeMs: number;
  /** Anypoint environment id — routes the _msearch query (X-ANYPNT-ENV-ID). */
  envId?: string;
  /** If set, only hits whose _source.appId matches are kept (post-filter). */
  brokerAppName?: string;
  /** Additional appId values for Log Search queries and post-filter (e.g. Flex targetId). */
  logAppIds?: string[];
  /** Broker route path segments for message-scoped queries on shared gateways. */
  brokerRouteSegments?: string[];
  /** HY/RR/RF — broker logs often omit apiInstanceId in message text. */
  deploymentType?: string;
  /** Run org-wide + wildcard probes and attach `msearchDiagnostics` (extra _msearch calls). */
  includeDiagnostics?: boolean;
  /** Optional timer for upstream call/hit counters. */
  timer?: PhaseTimer;
}

const PAGE_SIZE = 1000;

/**
 * Paging budget. Task discovery reads log *lines* to reconstruct a list of
 * distinct tasks, so cost grows with log volume rather than with the number of
 * tasks shown. Draining the full result set was never correct either — the old
 * 20-page-per-query ceiling silently truncated busy windows regardless — so we
 * spend a bounded budget across all queries and tell the operator when it runs
 * out instead of pretending the answer is complete.
 */
const MAX_PAGES_PER_QUERY = 4;
const MAX_TOTAL_HITS = 8000;

/**
 * Server-side prefilter for the broker error lines that have no task id. These
 * become synthetic "broker (error)" runs, so they must be fetched even when the
 * window holds no task-bearing lines — but they are rare, so one page is plenty.
 * The client-side {@link BROKER_ERROR_PATTERNS} regexes still decide the final
 * match; this clause only stops us paging whole applications to find them.
 */
const ERROR_BEARING_MESSAGE_CLAUSE =
  'message: ("TOOL_ERROR" OR "task-listener" OR "MonoDeferContextual")';

/** `field: ("a" OR "b")` — quoted so values with `_`, `-` or `.` stay single terms. */
function anyOf(field: string, values: string[]): string {
  const quoted = values.map((v) => `"${v.replace(/"/g, '\\"')}"`);
  return `${field}: (${quoted.join(" OR ")})`;
}

export interface TaskQuery {
  label: string;
  lucene: string;
  /** Error-scan queries are capped at one page; task queries get the full budget. */
  maxPages: number;
  /** Only task queries contribute to the reported document total. */
  countsTowardTotal: boolean;
}

/**
 * Build the log-search queries for one broker. Exported for tests — pure, no I/O.
 *
 * Every task query carries {@link TASK_BEARING_MESSAGE_CLAUSE}, which is what
 * makes them cheap: the appIds involved hold tens of thousands of startup and
 * access lines and only a couple of thousand that name a task. Measured on a
 * live 3-day window, the broker's appId alone matched 4,943 documents versus 25
 * once the clause was added.
 */
export function buildTaskQueries(params: {
  orgId: string;
  apiInstanceId: string;
  /** Candidate appIds, already de-duplicated (broker app, Flex target, gateway). */
  appIdFilters: string[];
  /** Broker route path segments, for shared gateways that omit the appId. */
  routeSegments: string[];
}): TaskQuery[] {
  const { orgId, apiInstanceId, appIdFilters, routeSegments } = params;
  const queries: TaskQuery[] = [];

  if (appIdFilters.length > 0) {
    // One OR'd query rather than one per candidate. We generate hyphen/underscore
    // variants and Flex target ids speculatively and most match nothing, so
    // issuing them separately spent a whole round trip per guess.
    queries.push({
      label: `appIds(${appIdFilters.length})`,
      lucene: `orgId=${orgId} AND ${anyOf("appId", appIdFilters)} AND ${TASK_BEARING_MESSAGE_CLAUSE}`,
      maxPages: MAX_PAGES_PER_QUERY,
      countsTowardTotal: true,
    });
  }

  // `apiInstanceId` is not a mapped field on the monitoring index, so querying it
  // as a field always returned zero. The broker prints it *inside* the message
  // (`… agent_id=… apiInstanceId=21047554`) where it is an indexed token, so this
  // still finds the broker's own task lines when appId resolution failed.
  queries.push({
    label: `messageApiInstance:${apiInstanceId}`,
    lucene: `orgId=${orgId} AND message: "${apiInstanceId}" AND ${TASK_BEARING_MESSAGE_CLAUSE}`,
    maxPages: MAX_PAGES_PER_QUERY,
    countsTowardTotal: true,
  });

  for (const segment of routeSegments) {
    queries.push({
      label: `messageRoute:${segment}`,
      lucene: `orgId=${orgId} AND message:*${segment}* AND ${TASK_BEARING_MESSAGE_CLAUSE}`,
      maxPages: MAX_PAGES_PER_QUERY,
      countsTowardTotal: true,
    });
  }

  if (appIdFilters.length > 0) {
    queries.push({
      label: "brokerErrors",
      lucene: `orgId=${orgId} AND ${anyOf("appId", appIdFilters)} AND ${ERROR_BEARING_MESSAGE_CLAUSE}`,
      maxPages: 1,
      countsTowardTotal: false,
    });
  }

  return queries;
}

function msearchSignalsFallback(result: MSearchResult): boolean {
  return (
    result.error === "MONITORING_CENTER_PREMIUM_REQUIRED" ||
    result.error === "MSEARCH_UNAVAILABLE"
  );
}

function probeSummary(lucene: string, result: MSearchResult): MsearchProbeSummary {
  if (result.error) {
    return { lucene, total: 0, returned: 0, error: result.error };
  }
  const first = result.hits[0] as { _source?: Record<string, unknown> } | undefined;
  const src = first?._source;
  const msg = src?.message;
  return {
    lucene,
    total: result.total,
    returned: result.hits.length,
    ...(typeof result.shardFailures === "number" && result.shardFailures > 0
      ? { shardFailures: result.shardFailures }
      : {}),
    ...(src && { sampleSourceKeys: Object.keys(src) }),
    ...(typeof msg === "string" ? { messagePreview: msg.slice(0, 400) } : {}),
    ...(src?.appId != null ? { sampleAppId: String(src.appId) } : {}),
    ...(src?.apiInstanceId != null ? { sampleApiInstanceId: src.apiInstanceId as string | number } : {}),
  };
}

/** Summary for the paginated filtered query (sample fields from first hit). */
function summarizeFilteredQuery(
  lucene: string,
  esTotal: number,
  hitsFetched: number,
  hits: unknown[]
): MsearchProbeSummary & { hitsFetched: number } {
  const first = hits[0] as { _source?: Record<string, unknown> } | undefined;
  const src = first?._source;
  const msg = src?.message;
  return {
    lucene,
    total: esTotal,
    returned: hits.length,
    hitsFetched,
    ...(src && { sampleSourceKeys: Object.keys(src) }),
    ...(typeof msg === "string" ? { messagePreview: msg.slice(0, 400) } : {}),
    ...(src?.appId != null ? { sampleAppId: String(src.appId) } : {}),
    ...(src?.apiInstanceId != null ? { sampleApiInstanceId: src.apiInstanceId as string | number } : {}),
  };
}

/**
 * Returns `null` when the org lacks Monitoring Center Premium (caller should fall back to runtime-logs).
 */
export async function fetchTasksViaMSearch(
  params: MSearchStrategyParams
): Promise<BrokerTasksResult | null> {
  const {
    orgId,
    apiInstanceId,
    accessToken,
    baseUrl,
    timeRangeMs,
    envId,
    brokerAppName,
    logAppIds,
    brokerRouteSegments,
    deploymentType,
    includeDiagnostics,
    timer,
  } = params;

  const relaxApiInstanceFromMessage = isHyperscaleDeploymentType(deploymentType);
  const routeSegments = [
    ...new Set((brokerRouteSegments ?? []).filter((s) => s.length > 0)),
  ];

  const now = Date.now();
  const gte = now - timeRangeMs;
  debugLog(`[MSEARCH] baseUrl=${baseUrl} token=${accessToken.slice(0, 8)}… timeRange=${timeRangeMs}ms (${new Date(gte).toISOString()} → ${new Date(now).toISOString()})`);

  let orgOnlyQuery: MsearchProbeSummary | undefined;
  let wildcardQuery: MsearchProbeSummary | undefined;

  if (includeDiagnostics) {
    const orgQ = `orgId=${orgId}`;
    const orgRes = await msearch(orgId, orgQ, { size: 3, from: 0, timeRangeMs, envId }, accessToken, baseUrl);
    if (msearchSignalsFallback(orgRes)) {
      debugLog(`[MSEARCH] ${orgRes.error} — signalling fallback`);
      return null;
    }
    orgOnlyQuery = probeSummary(orgQ, orgRes);
    debugLog(
      `[MSEARCH] DIAG org-only: total=${orgOnlyQuery.total} returned=${orgOnlyQuery.returned} keys=${(orgOnlyQuery.sampleSourceKeys ?? []).join(",")}`
    );

    const wildRes = await msearch(orgId, "*", { size: 3, from: 0, timeRangeMs, envId }, accessToken, baseUrl);
    if (msearchSignalsFallback(wildRes)) {
      debugLog(`[MSEARCH] ${wildRes.error} (wildcard probe) — signalling fallback`);
      return null;
    }
    wildcardQuery = probeSummary("*", wildRes);
    debugLog(
      `[MSEARCH] DIAG wildcard *: total=${wildcardQuery.total} returned=${wildcardQuery.returned} keys=${(wildcardQuery.sampleSourceKeys ?? []).join(",")}`
    );
  }

  // A2A requests and responses for Flex-routed APIs are recorded under the
  // gateway's API-version appId, not the broker deployment/target appId.
  const gatewayApiAppId = `_api_version_${apiInstanceId}`;
  // Do not normalize the gateway appId: replacing its underscores produces
  // `-api-version-…`, an invalid/unrelated value that can cause OSD to reject
  // the query and discard otherwise valid gateway hits.
  const appIdFilters = [
    ...new Set([
      ...logSearchAppIdCandidates(...(logAppIds ?? []), ...(brokerAppName ? [brokerAppName] : [])),
      gatewayApiAppId,
    ]),
  ];

  const queries = buildTaskQueries({ orgId, apiInstanceId, appIdFilters, routeSegments });

  // Pre-flight: one `size: 0` count of task-bearing lines for this org+env. Every
  // task query is this clause plus further restrictions, so a zero here proves all
  // of them are empty and we can skip straight to the error scan. That turns the
  // no-tasks case from ~10s of paging into a single sub-second call.
  const preflight = await msearch(
    orgId,
    `orgId=${orgId} AND ${TASK_BEARING_MESSAGE_CLAUSE}`,
    { size: 0, from: 0, timeRangeMs, envId },
    accessToken,
    baseUrl
  );
  timer?.count("logSearchCalls");
  if (msearchSignalsFallback(preflight)) {
    debugLog(`[MSEARCH] ${preflight.error} on pre-flight — signalling fallback`);
    return null;
  }
  const taskLinesInWindow = preflight.total;
  timer?.note("logSearchTaskLines", String(taskLinesInWindow));
  debugLog(`[MSEARCH] Pre-flight: ${taskLinesInWindow} task-bearing line(s) in window`);

  const seenDocIds = new Set<string>();
  const allHits: unknown[] = [];
  let totalFromApi = 0;
  let primaryLucene = queries[0].lucene;
  let budgetExhausted = false;

  for (const q of queries) {
    if (taskLinesInWindow === 0 && q.countsTowardTotal) {
      debugLog(`[MSEARCH] Skipping ${q.label} — pre-flight found no task lines in window`);
      continue;
    }
    debugLog(`[MSEARCH] Query (${q.label}): ${q.lucene}`);
    for (let page = 0; page < q.maxPages; page++) {
      if (allHits.length >= MAX_TOTAL_HITS) {
        budgetExhausted = true;
        break;
      }
      const from = page * PAGE_SIZE;
      const pageResult = await msearch(
        orgId,
        q.lucene,
        { size: PAGE_SIZE, from, timeRangeMs, envId, sourceFields: [...TASK_PARSE_SOURCE_FIELDS] },
        accessToken,
        baseUrl
      );
      timer?.count("logSearchCalls");

      if (msearchSignalsFallback(pageResult)) {
        // A malformed or unsupported auxiliary field query must not throw away
        // task hits collected by earlier queries (notably FLEX_API gateway
        // records under `_api_version_<apiInstanceId>`).
        debugLog(`[MSEARCH] ${pageResult.error} for ${q.label} — skipping query`);
        break;
      }

      if (page === 0 && q.countsTowardTotal) totalFromApi += pageResult.total;
      const hits = pageResult.hits ?? [];
      let newCount = 0;
      for (const h of hits) {
        const docId = (h as { _id?: string })._id ?? "";
        if (docId && seenDocIds.has(docId)) continue;
        if (docId) seenDocIds.add(docId);
        allHits.push(h);
        newCount++;
      }
      timer?.count("logSearchHits", hits.length);

      if (page === 0) {
        const shardNote =
          typeof pageResult.shardFailures === "number" && pageResult.shardFailures > 0
            ? `, shardFailures=${pageResult.shardFailures}`
            : "";
        debugLog(`[MSEARCH] (${q.label}) Page 0: ${hits.length} hits (${newCount} new), total=${pageResult.total}${shardNote}`);
      }

      if (hits.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= pageResult.total) break;
      debugLog(`[MSEARCH] (${q.label}) Page ${page + 1}: ${newCount} new, ${allHits.length} cumulative`);
    }
    if (budgetExhausted) {
      debugLog(
        `[MSEARCH] Hit the ${MAX_TOTAL_HITS}-document budget; stopping after query "${q.label}". Narrow the time range for older tasks.`
      );
      break;
    }
  }

  primaryLucene = queries.map(q => q.lucene).join(" | ");
  const filteredQuerySummary = summarizeFilteredQuery(primaryLucene, totalFromApi, allHits.length, allHits);
  debugLog(
    `[MSEARCH] Combined: ${allHits.length} unique hits from ${queries.length} queries`
  );

  // Post-filter: keep only broker-app hits when we have a name.
  // Gateway proxy logs (appId=_api_version_*) are noise for task discovery.
  const appIdFilterSet = new Set(appIdFilters);
  const hitsToUse = allHits.filter((h: unknown) => {
    const src = (h as { _source?: { appId?: string; message?: string } })._source;
    const appId = String(src?.appId ?? "");
    const msg = String(src?.message ?? "");
    if (appIdFilterSet.size === 0) return true;
    if (appIdFilterSet.has(appId)) return true;
    if (routeSegments.some((segment) => msg.includes(segment))) return true;
    if (msg.includes(`apiInstanceId=${apiInstanceId}`)) return true;
    return false;
  });

  if (appIdFilterSet.size > 0 && hitsToUse.length !== allHits.length) {
    debugLog(
      `[MSEARCH] Post-filtered by appId in [${[...appIdFilterSet].join(", ")}]: ${allHits.length} -> ${hitsToUse.length}`
    );
  }

  const accumulators = parseHitsToAccumulators(
    hitsToUse,
    apiInstanceId,
    routeSegments,
    relaxApiInstanceFromMessage
  );
  const uniqueTaskIdsParsed = Object.keys(accumulators).length;
  const tasks = finaliseTasks(Object.values(accumulators), apiInstanceId);

  debugLog(`[MSEARCH] ${uniqueTaskIdsParsed} unique taskIds, ${tasks.length} after apiInstanceId filter`);

  const msearchDiagnostics: MsearchDiagnostics | undefined = includeDiagnostics
    ? {
        timeRangeIso: { from: new Date(gte).toISOString(), to: new Date(now).toISOString() },
        filteredQuery: filteredQuerySummary,
        orgOnlyQuery,
        wildcardQuery,
        ...(appIdFilterSet.size > 0
          ? {
              brokerAppPostFilter: {
                brokerAppName: brokerAppName ?? [...appIdFilterSet].join("|"),
                beforeHits: allHits.length,
                afterHits: hitsToUse.length,
              },
            }
          : {}),
        uniqueTaskIdsParsed,
        queriesUsed: queries.map(q => q.label),
      }
    : undefined;

  if (includeDiagnostics && msearchDiagnostics) {
    debugLog(`[MSEARCH] DIAG JSON: ${JSON.stringify(msearchDiagnostics)}`);
  }

  return {
    tasks,
    source: "msearch",
    totalLogs: totalFromApi,
    ...(msearchDiagnostics ? { msearchDiagnostics } : {}),
  };
}

// ---------------------------------------------------------------------------
// Internal: parse ES hits into task accumulators
// ---------------------------------------------------------------------------

const RE = {
  task: /(?:taskId|task_id)=([a-f0-9-]+)/,
  jsonTask: /"(?:taskId|task_id)"\s*:\s*"([a-f0-9-]+)"/,
  ctx: /(?:contextId|context_id)=([a-f0-9-]+)/,
  jsonCtx: /"(?:contextId|context_id)"\s*:\s*"([a-f0-9-]+)"/,
  agent: /(?:agent_id|agent)=(\S+)/,
  tool: /(?:LLM selected tool|Executed tool) (\S+)/,
  iter: /iteration=(\d+)/,
  apiInstance: /apiInstanceId=(\d+)/,
};

const BROKER_ERROR_PATTERNS = [
  /task-listener.*failed to send response/i,
  /AGENTS-BROKER:TOOL_ERROR/i,
  /MonoDeferContextual/,
  /Did not observe any item or terminal signal/,
];

function isBrokerErrorHit(msg: string): boolean {
  return BROKER_ERROR_PATTERNS.some(re => re.test(msg));
}

/**
 * Groups consecutive error hits (within 5 s of each other) into a single
 * synthetic "failed task" entry, so the UI shows them as broker runs.
 */
function groupErrorHits(
  hits: Array<{ msg: string; ts: string; appId: string }>,
  fallbackApiInstanceId: string
): Record<string, BrokerTaskAccumulator> {
  if (hits.length === 0) return {};

  hits.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const groups: Array<typeof hits> = [];
  let current = [hits[0]];
  for (let i = 1; i < hits.length; i++) {
    const gap = new Date(hits[i].ts).getTime() - new Date(hits[i - 1].ts).getTime();
    if (gap <= 5_000) {
      current.push(hits[i]);
    } else {
      groups.push(current);
      current = [hits[i]];
    }
  }
  groups.push(current);

  const result: Record<string, BrokerTaskAccumulator> = {};
  for (const g of groups) {
    const syntheticId = `err-${new Date(g[0].ts).getTime()}`;
    const firstMsg = g[0].msg;
    const errorSnippet = firstMsg.length > 120 ? firstMsg.slice(0, 120) + "…" : firstMsg;
    result[syntheticId] = {
      taskId: syntheticId,
      contextId: "",
      broker: "broker (error)",
      firstTool: `ERROR: ${errorSnippet}`,
      startTime: g[0].ts,
      endTime: g[g.length - 1].ts,
      maxIteration: 0,
      toolsUsed: new Set(),
      appId: g[0].appId,
      apiInstanceId: fallbackApiInstanceId,
      logCount: g.length,
      status: "error",
    };
  }
  return result;
}

function messageMatchesBrokerRoute(message: string, routeSegments: string[]): boolean {
  return routeSegments.some((segment) => message.includes(segment));
}

function resolveTaskApiInstanceId(
  message: string,
  appId: string,
  parsedFromMessage: string,
  fallbackApiInstanceId: string,
  routeSegments: string[],
  relaxWhenRouted: boolean
): string {
  if (parsedFromMessage) return parsedFromMessage;
  if (appId === `_api_version_${fallbackApiInstanceId}`) return fallbackApiInstanceId;
  if (relaxWhenRouted && messageMatchesBrokerRoute(message, routeSegments)) {
    return fallbackApiInstanceId;
  }
  return "";
}

function parseHitsToAccumulators(
  hits: unknown[],
  fallbackApiInstanceId: string,
  routeSegments: string[],
  relaxApiInstanceFromMessage: boolean
): Record<string, BrokerTaskAccumulator> {
  const tasks: Record<string, BrokerTaskAccumulator> = {};
  const unmatchedErrors: Array<{ msg: string; ts: string; appId: string }> = [];

  for (const h of hits) {
    const hit = h as { _source?: { message?: string; timestamp?: string; appId?: string } };
    const msg = (hit._source?.message as string) || "";
    const appId = (hit._source?.appId as string) || "";
    const tid = (msg.match(RE.task) || msg.match(RE.jsonTask) || [])[1];

    if (!tid) {
      if (isBrokerErrorHit(msg)) {
        unmatchedErrors.push({
          msg,
          ts: (hit._source?.timestamp as string) || new Date().toISOString(),
          appId: (hit._source?.appId as string) || "",
        });
      }
      continue;
    }

    if (!tasks[tid]) {
      const parsedApiInstance = (msg.match(RE.apiInstance) || [])[1] || "";
      tasks[tid] = {
        taskId: tid,
        contextId: (msg.match(RE.ctx) || msg.match(RE.jsonCtx) || [])[1] || "",
        broker: (msg.match(RE.agent) || [])[1] || "",
        firstTool: "",
        startTime: (hit._source?.timestamp as string) || "",
        endTime: null,
        maxIteration: 0,
        toolsUsed: new Set(),
        appId,
        apiInstanceId: resolveTaskApiInstanceId(
          msg,
          appId,
          parsedApiInstance,
          fallbackApiInstanceId,
          routeSegments,
          relaxApiInstanceFromMessage
        ),
        logCount: 0,
      };
    }

    const task = tasks[tid];
    task.logCount++;

    const ctx = (msg.match(RE.ctx) || msg.match(RE.jsonCtx) || [])[1];
    if (ctx && !task.contextId) task.contextId = ctx;

    const agt = (msg.match(RE.agent) || [])[1];
    if (agt && !task.broker) task.broker = agt;

    const apiInst = (msg.match(RE.apiInstance) || [])[1];
    if (apiInst && !task.apiInstanceId) {
      task.apiInstanceId = apiInst;
    } else if (
      !task.apiInstanceId &&
      relaxApiInstanceFromMessage &&
      messageMatchesBrokerRoute(msg, routeSegments)
    ) {
      task.apiInstanceId = fallbackApiInstanceId;
    }

    const it = parseInt((msg.match(RE.iter) || [])[1] || "0", 10);
    if (it > task.maxIteration) task.maxIteration = it;

    const tool = (msg.match(RE.tool) || [])[1];
    if (tool) {
      task.toolsUsed.add(tool);
      if (!task.firstTool || (it === 1 && msg.includes("LLM selected tool"))) {
        task.firstTool = tool;
      }
    }

    const timestamp = (hit._source?.timestamp as string) || "";
    if (timestamp) {
      if (!task.startTime || timestamp < task.startTime) task.startTime = timestamp;
      if (msg.includes("Executed tool") || msg.includes("FINAL_RESPONSE") || msg.includes("HTTP/1.1 2")) {
        if (!task.endTime || timestamp > task.endTime) task.endTime = timestamp;
      }
    }

    if (appId && !task.appId) task.appId = appId;
  }

  const errorTasks = groupErrorHits(unmatchedErrors, fallbackApiInstanceId);
  if (Object.keys(errorTasks).length > 0) {
    debugLog(`[MSEARCH] Found ${Object.keys(errorTasks).length} error-only broker run(s) without taskId`);
  }

  return { ...tasks, ...errorTasks };
}
