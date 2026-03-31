/**
 * Strategy A: Discover broker tasks via Anypoint Monitoring _msearch (Elasticsearch).
 * Requires Monitoring Center Premium entitlement.
 *
 * This module is ONLY about _msearch. It does not touch AMC /logs, Runtime Manager,
 * or deployment resolution. Keep it that way so fixes here don't break the runtime-logs path.
 */

import { debugLog } from "@/lib/api-logger";
import { msearch } from "@/lib/api/msearch";
import type { BrokerTaskAccumulator, BrokerTask, BrokerTasksResult } from "./types";
import { finaliseTasks } from "./types";

export interface MSearchStrategyParams {
  orgId: string;
  apiInstanceId: string;
  accessToken: string;
  baseUrl: string;
  timeRangeMs: number;
  /** If set, only hits whose _source.appId matches are kept (post-filter). */
  brokerAppName?: string;
}

/**
 * Returns `null` when the org lacks Monitoring Center Premium (caller should fall back to runtime-logs).
 */
export async function fetchTasksViaMSearch(
  params: MSearchStrategyParams
): Promise<BrokerTasksResult | null> {
  const { orgId, apiInstanceId, accessToken, baseUrl, timeRangeMs, brokerAppName } = params;

  const luceneQuery = `orgId=${orgId} AND taskId= AND apiInstanceId=${apiInstanceId}`;
  const now = Date.now();
  const gte = now - timeRangeMs;
  debugLog(`[MSEARCH] Query: ${luceneQuery}`);
  debugLog(`[MSEARCH] baseUrl=${baseUrl} token=${accessToken.slice(0, 8)}… timeRange=${timeRangeMs}ms (${new Date(gte).toISOString()} → ${new Date(now).toISOString()})`);

  const PAGE_SIZE = 1000;
  const MAX_PAGES = 20;
  const allHits: unknown[] = [];
  let totalFromApi = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const pageResult = await msearch(orgId, luceneQuery, { size: PAGE_SIZE, from, timeRangeMs }, accessToken, baseUrl);

    if (pageResult.error === "MONITORING_CENTER_PREMIUM_REQUIRED") {
      debugLog("[MSEARCH] Monitoring Center Premium required — signalling fallback");
      return null;
    }

    totalFromApi = pageResult.total;
    const hits = pageResult.hits ?? [];
    allHits.push(...hits);

    if (page === 0) {
      const shardNote =
        typeof pageResult.shardFailures === "number" && pageResult.shardFailures > 0
          ? `, shardFailures=${pageResult.shardFailures}`
          : "";
      debugLog(`[MSEARCH] Page 0: ${hits.length} hits, total=${totalFromApi}${shardNote}`);
    }

    if (hits.length < PAGE_SIZE || allHits.length >= totalFromApi) break;
    debugLog(`[MSEARCH] Page ${page + 1}: ${allHits.length}/${totalFromApi} hits so far`);
  }

  const hitsToUse =
    brokerAppName !== undefined
      ? allHits.filter((h: unknown) => {
          const src = (h as { _source?: { appId?: string } })._source;
          return (src?.appId as string) === brokerAppName;
        })
      : allHits;

  if (brokerAppName && hitsToUse.length !== allHits.length) {
    debugLog(`[MSEARCH] Post-filtered by appId=${brokerAppName}: ${allHits.length} -> ${hitsToUse.length}`);
  }

  const accumulators = parseHitsToAccumulators(hitsToUse);
  const tasks = finaliseTasks(Object.values(accumulators), apiInstanceId);

  debugLog(`[MSEARCH] ${Object.keys(accumulators).length} unique taskIds, ${tasks.length} after apiInstanceId filter`);

  return {
    tasks,
    source: "msearch",
    totalLogs: totalFromApi,
  };
}

// ---------------------------------------------------------------------------
// Internal: parse ES hits into task accumulators
// ---------------------------------------------------------------------------

const RE = {
  task: /taskId=([a-f0-9-]+)/,
  ctx: /contextId=([a-f0-9-]+)/,
  agent: /agent=(\S+)/,
  tool: /(?:LLM selected tool|Executed tool) (\S+)/,
  iter: /iteration=(\d+)/,
  apiInstance: /apiInstanceId=(\d+)/,
};

function parseHitsToAccumulators(hits: unknown[]): Record<string, BrokerTaskAccumulator> {
  const tasks: Record<string, BrokerTaskAccumulator> = {};

  for (const h of hits) {
    const hit = h as { _source?: { message?: string; timestamp?: string; appId?: string } };
    const msg = (hit._source?.message as string) || "";
    const tid = (msg.match(RE.task) || [])[1];
    if (!tid) continue;

    if (!tasks[tid]) {
      tasks[tid] = {
        taskId: tid,
        contextId: (msg.match(RE.ctx) || [])[1] || "",
        broker: (msg.match(RE.agent) || [])[1] || "",
        firstTool: "",
        startTime: (hit._source?.timestamp as string) || "",
        endTime: null,
        maxIteration: 0,
        toolsUsed: new Set(),
        appId: (hit._source?.appId as string) || "",
        apiInstanceId: (msg.match(RE.apiInstance) || [])[1] || "",
        logCount: 0,
      };
    }

    const task = tasks[tid];
    task.logCount++;

    const ctx = (msg.match(RE.ctx) || [])[1];
    if (ctx && !task.contextId) task.contextId = ctx;

    const agt = (msg.match(RE.agent) || [])[1];
    if (agt && !task.broker) task.broker = agt;

    const apiInst = (msg.match(RE.apiInstance) || [])[1];
    if (apiInst && !task.apiInstanceId) task.apiInstanceId = apiInst;

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

    const appId = (hit._source?.appId as string) || "";
    if (appId && !task.appId) task.appId = appId;
  }

  return tasks;
}
