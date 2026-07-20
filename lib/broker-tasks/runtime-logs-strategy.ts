/**
 * Strategy B: Discover broker tasks via AMC GET /logs (Runtime Manager + Application Manager).
 * Used when the org does NOT have Monitoring Center Premium (_msearch unavailable).
 *
 * This module is ONLY about AMC deployment resolution + GET /logs + text parsing.
 * It does not call _msearch. Keep it that way so fixes here don't break the msearch path.
 */

import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";
import { buildAmcLogsUrl } from "@/lib/api/amc-logs";
import type { BrokerTaskAccumulator, BrokerTasksResult } from "./types";
import { finaliseTasks } from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RuntimeLogsStrategyParams {
  orgId: string;
  apiInstanceId: string;
  accessToken: string;
  baseUrl: string;
  timeRangeMs: number;
  envId?: string;
  brokerAppName?: string;
  /** Resolved AMC deployment id (skips name lookup when set). */
  brokerDeploymentId?: string;
  /** When true, org has Log Search — do not tag responses as no-entitlement. */
  logSearchEntitled?: boolean;
}

export async function fetchTasksViaRuntimeLogs(
  params: RuntimeLogsStrategyParams
): Promise<BrokerTasksResult> {
  const { orgId, apiInstanceId, accessToken, baseUrl, timeRangeMs, envId, brokerAppName, logSearchEntitled = false } = params;
  const resultMode = logSearchEntitled ? undefined : ("no-entitlement" as const);
  debugLog("[RUNTIME-LOGS] Starting for apiInstanceId:", apiInstanceId);

  const endTime = Date.now();
  const cutoffMs = endTime - timeRangeMs;
  const logWindow: AmcLogWindow = { startTime: cutoffMs, endTime };
  const withinWindow = (startTime: string): boolean => {
    if (!startTime) return true; // unknown → keep; better than dropping silently
    const t = new Date(startTime).getTime();
    return Number.isFinite(t) ? t >= cutoffMs : true;
  };
  const filterAccumulators = (acc: BrokerTaskAccumulator[]): BrokerTaskAccumulator[] => {
    const before = acc.length;
    const out = acc.filter((t) => withinWindow(t.startTime));
    if (before !== out.length) {
      debugLog(
        `[RUNTIME-LOGS] Filtered ${before - out.length}/${before} tasks outside time window (timeRangeMs=${timeRangeMs})`
      );
    }
    return out;
  };

  try {
    const environments = await listRuntimeEnvironments(baseUrl, orgId, accessToken);

    // Fast path: if we have the AMC app name + envId, try that deployment directly
    if (brokerAppName && envId && environments.some((e) => e.id === envId)) {
      const tasks = await tryDeploymentByName(baseUrl, orgId, envId, brokerAppName, apiInstanceId, accessToken, logWindow);
      const inWindow = filterAccumulators(tasks);
      if (inWindow.length > 0) {
        return { tasks: finaliseTasks(inWindow), source: "runtime-logs", totalLogs: 0, mode: resultMode };
      }
    }

    // Resolve deployment via Runtime Manager
    const apiInstanceInfo = await resolveDeploymentFromRM(baseUrl, orgId, environments, apiInstanceId, accessToken);

    const allTasks: Record<string, BrokerTaskAccumulator> = {};

    // Try the RM-resolved deployment first
    if (apiInstanceInfo?.deploymentId && apiInstanceInfo?.targetEnvId) {
      const tasks = await fetchAndParseLogs(baseUrl, orgId, apiInstanceInfo.targetEnvId, apiInstanceInfo.deploymentId, apiInstanceId, accessToken, logWindow);
      for (const t of tasks) allTasks[t.taskId] = t;
    }

    // Walk environments with multiple approaches (app-name match, RM detail, etc.)
    for (const env of environments) {
      await tryEnvironmentApproaches(baseUrl, orgId, env.id, apiInstanceId, accessToken, brokerAppName, allTasks, logWindow);
    }

    const inWindow = filterAccumulators(Object.values(allTasks));
    if (inWindow.length === 0) {
      debugLog("[RUNTIME-LOGS] No tasks found within time window");
      return { tasks: [], source: "runtime-logs", totalLogs: 0, mode: resultMode };
    }

    const tasks = finaliseTasks(inWindow);
    debugLog("[RUNTIME-LOGS] Returning", tasks.length, "tasks");
    return { tasks, source: "runtime-logs", totalLogs: 0, mode: resultMode };
  } catch (error) {
    debugError("[RUNTIME-LOGS] Error:", error);
    return { tasks: [], source: "runtime-logs", totalLogs: 0, mode: resultMode };
  }
}

// ---------------------------------------------------------------------------
// AMC log fetching
// ---------------------------------------------------------------------------

const AMC_LOGS_MAX_LENGTH = 1000;

interface AmcLogWindow {
  startTime: number;
  endTime: number;
}

interface AmcLogEntry {
  docId?: string;
  timestamp?: number;
  message?: string;
  replicaId?: string;
  logLevel?: string;
  context?: unknown;
}

async function fetchLogsFromAmc(
  baseUrl: string,
  orgId: string,
  envId: string,
  deploymentId: string,
  specId: string,
  accessToken: string,
  window: AmcLogWindow,
  length: number = AMC_LOGS_MAX_LENGTH
): Promise<string> {
  const safeLength = Math.min(Math.max(1, length), AMC_LOGS_MAX_LENGTH);
  const logsUrl = buildAmcLogsUrl({
    baseUrl,
    organizationId: orgId,
    environmentId: envId,
    deploymentId,
    specificationId: specId,
    search: {
      length: safeLength,
      startTime: window.startTime,
      endTime: window.endTime,
      descending: true,
    },
  });
  const res = await loggedFetch(logsUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    debugLog("[RUNTIME-LOGS] GET /logs failed:", res.status);
    return "";
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const entries = (await res.json()) as AmcLogEntry[];
    if (!Array.isArray(entries)) return "";
    debugLog("[RUNTIME-LOGS] GET /logs returned", entries.length, "JSON log entries");
    return entries
      .map((e) => {
        const ts = e.timestamp != null ? new Date(e.timestamp).toISOString() : "";
        return `${ts} ${e.message ?? ""}`.trim();
      })
      .filter((line) => line.length > 0)
      .join("\n");
  }
  return res.text();
}

// ---------------------------------------------------------------------------
// Environment + deployment resolution helpers
// ---------------------------------------------------------------------------

interface EnvInfo {
  id: string;
  name: string;
  type?: string;
}

async function listRuntimeEnvironments(baseUrl: string, orgId: string, accessToken: string): Promise<EnvInfo[]> {
  const url = `${baseUrl}/accounts/api/organizations/${orgId}/environments`;
  const res = await loggedFetch(url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    debugLog("[RUNTIME-LOGS] Failed to fetch environments:", res.status);
    return [];
  }
  const data = (await res.json()) as { data?: EnvInfo[] };
  const all = data.data || [];
  const runtime = all.filter((e) => (e.type || "").toLowerCase() !== "design");
  debugLog("[RUNTIME-LOGS] Found", runtime.length, "runtime environments");
  return runtime;
}

async function resolveDeploymentFromRM(
  baseUrl: string,
  orgId: string,
  environments: EnvInfo[],
  apiInstanceId: string,
  accessToken: string
): Promise<{ deploymentId: string; targetEnvId: string } | null> {
  for (const env of environments) {
    try {
      const url = `${baseUrl}/apimanager/api/v1/organizations/${orgId}/environments/${env.id}/apis/${apiInstanceId}`;
      const res = await loggedFetch(url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        deploymentId?: string;
        deployment?: { deploymentId?: string | null; applicationId?: string };
      };
      const deploymentId = body.deploymentId ?? body.deployment?.deploymentId ?? body.deployment?.applicationId;
      if (deploymentId) {
        debugLog("[RUNTIME-LOGS] RM resolved deployment:", deploymentId, "env:", env.id);
        return { deploymentId, targetEnvId: env.id };
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function resolveSpecId(baseUrl: string, orgId: string, envId: string, deploymentId: string, accessToken: string): Promise<string | null> {
  const specsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/specs`;
  const specsRes = await loggedFetch(specsUrl, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
  if (specsRes.ok) {
    const specs = (await specsRes.json()) as Array<{ version?: string; id?: string }>;
    const specId = specs?.length ? (specs[0].version ?? specs[0].id ?? null) : null;
    if (specId) return specId;
  }
  const depUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}`;
  const depRes = await loggedFetch(depUrl, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
  if (depRes.ok) {
    const dep = (await depRes.json()) as { desiredVersion?: string; replicas?: Array<{ id: string }> };
    return dep.desiredVersion ?? dep.replicas?.[0]?.id ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deployment-level fetch + parse
// ---------------------------------------------------------------------------

async function fetchAndParseLogs(
  baseUrl: string,
  orgId: string,
  envId: string,
  deploymentId: string,
  apiInstanceId: string,
  accessToken: string,
  window: AmcLogWindow
): Promise<BrokerTaskAccumulator[]> {
  const specId = await resolveSpecId(baseUrl, orgId, envId, deploymentId, accessToken);
  if (!specId) return [];
  const logsText = await fetchLogsFromAmc(baseUrl, orgId, envId, deploymentId, specId, accessToken, window);
  if (!logsText) return [];
  return parseLogsForTasks(logsText, apiInstanceId);
}

async function tryDeploymentByName(
  baseUrl: string,
  orgId: string,
  envId: string,
  appName: string,
  apiInstanceId: string,
  accessToken: string,
  window: AmcLogWindow
): Promise<BrokerTaskAccumulator[]> {
  try {
    const listUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments?name=${encodeURIComponent(appName)}`;
    const listRes = await loggedFetch(listUrl, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
    if (!listRes.ok) return [];
    const listData = (await listRes.json()) as { items?: Array<{ id: string; name: string }> };
    const items = listData.items ?? [];
    if (items.length !== 1) return [];
    debugLog("[RUNTIME-LOGS] Matched AMC deployment by name:", items[0].name, "->", items[0].id);
    return fetchAndParseLogs(baseUrl, orgId, envId, items[0].id, apiInstanceId, accessToken, window);
  } catch {
    return [];
  }
}

async function tryEnvironmentApproaches(
  baseUrl: string,
  orgId: string,
  envId: string,
  apiInstanceId: string,
  accessToken: string,
  brokerAppName: string | undefined,
  allTasks: Record<string, BrokerTaskAccumulator>,
  window: AmcLogWindow
): Promise<void> {
  try {
    const rmUrl = `${baseUrl}/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiInstanceId}`;
    const rmRes = await loggedFetch(rmUrl, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
    if (!rmRes.ok) return;

    const apiInfo = (await rmRes.json()) as {
      assetId?: string;
      instanceLabel?: string;
      deployment?: { applicationId?: string; deploymentId?: string | null; targetId?: string };
      deploymentId?: string;
      targetId?: string;
    };

    const deploymentInfo = apiInfo.deployment || {};
    const applicationId = deploymentInfo.applicationId;
    const deploymentIdFromDeployment = deploymentInfo.deploymentId;
    const targetId = deploymentInfo.targetId || apiInfo.targetId;
    const brokerName = (apiInfo.instanceLabel || apiInfo.assetId || "").toLowerCase();

    const deploymentIdToTry = deploymentIdFromDeployment || applicationId || apiInfo.deploymentId || targetId;
    if (!deploymentIdToTry) return;

    interface Approach {
      name: string;
      deploymentId: string;
      specId?: string;
      getSpecs: boolean;
    }
    const approaches: Approach[] = [];

    if (brokerAppName) {
      try {
        const listUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments?name=${encodeURIComponent(brokerAppName)}`;
        const listRes = await loggedFetch(listUrl, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
        if (listRes.ok) {
          const listData = (await listRes.json()) as { items?: Array<{ id: string; name: string }> };
          if (listData.items?.length === 1) {
            approaches.push({ name: "amc-by-app-name", deploymentId: listData.items[0].id, getSpecs: true });
          }
        }
      } catch { /* ignore */ }
    }

    if (brokerName && !brokerAppName) {
      try {
        const listUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments`;
        const listRes = await loggedFetch(listUrl, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
        if (listRes.ok) {
          const listData = (await listRes.json()) as { items?: Array<{ id: string; name: string }> };
          const items = listData.items || [];
          const normalizedBroker = brokerName.replace(/-/g, "");
          for (const item of items) {
            const nameNorm = (item.name || "").toLowerCase().replace(/-and-/gi, "-").replace(/-/g, "");
            const nameNormWithAnd = (item.name || "").toLowerCase().replace(/-/g, "");
            if (
              nameNorm === normalizedBroker ||
              nameNormWithAnd.includes(normalizedBroker) ||
              normalizedBroker.includes(nameNorm) ||
              (item.name || "").toLowerCase().replace(/-and-/gi, "-") === brokerName
            ) {
              approaches.push({ name: "amc-by-name", deploymentId: item.id, getSpecs: true });
              break;
            }
          }
        }
      } catch { /* ignore */ }
    }

    if (applicationId || deploymentIdToTry) {
      approaches.push({ name: "specs-then-logs", deploymentId: deploymentIdToTry, getSpecs: true });
    }
    if (applicationId && deploymentIdToTry === applicationId) {
      approaches.push({ name: "applicationId-as-both", deploymentId: applicationId, specId: applicationId, getSpecs: false });
    }

    for (const approach of approaches) {
      try {
        let specId: string | null = approach.specId ?? null;
        if (approach.getSpecs) {
          specId = await resolveSpecId(baseUrl, orgId, envId, approach.deploymentId, accessToken);
          if (!specId) continue;
        }
        if (!specId) continue;

        const logsText = await fetchLogsFromAmc(baseUrl, orgId, envId, approach.deploymentId, specId, accessToken, window);
        if (!logsText) continue;

        const parsedTasks = parseLogsForTasks(logsText, apiInstanceId);
        for (const task of parsedTasks) {
          if (!allTasks[task.taskId]) {
            allTasks[task.taskId] = task;
          } else {
            const existing = allTasks[task.taskId];
            existing.logCount += task.logCount;
            if (task.maxIteration > existing.maxIteration) existing.maxIteration = task.maxIteration;
            task.toolsUsed.forEach((tool: string) => existing.toolsUsed.add(tool));
            if (!existing.firstTool && task.firstTool) existing.firstTool = task.firstTool;
          }
        }
        if (parsedTasks.length > 0) {
          debugLog(`[RUNTIME-LOGS] Approach "${approach.name}": found ${parsedTasks.length} tasks`);
          break;
        }
      } catch {
        continue;
      }
    }
  } catch {
    /* ignore env */
  }
}

// ---------------------------------------------------------------------------
// Log text → task accumulators
// ---------------------------------------------------------------------------

const BROKER_ERROR_PATTERNS = [
  /task-listener.*failed to send response/i,
  /AGENTS-BROKER:TOOL_ERROR/i,
  /MonoDeferContextual/,
  /Did not observe any item or terminal signal/,
];

function parseLogsForTasks(logsText: string, targetApiInstanceId: string): BrokerTaskAccumulator[] {
  const tasks: Record<string, BrokerTaskAccumulator> = {};
  const logLines = logsText.split("\n").filter((line: string) => line.trim().length > 0);
  debugLog("[RUNTIME-LOGS] Parsing", logLines.length, "log lines");

  const taskIdRegex = /(?:taskId|task_id|task-id)[=:]"?([a-f0-9-]+)"?/gi;
  const apiInstanceRegex = new RegExp(
    `(?:apiInstanceId|api_instance_id|api-instance-id)[=:]"?${targetApiInstanceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?`,
    "gi"
  );
  const contextIdRegex = /(?:contextId|context_id|context-id)[=:]"?([a-f0-9-]+)"?/gi;
  const agentRegex = /(?:agent|broker)[=:]"??(\S+)"?/gi;
  const toolRegex = /(?:LLM selected tool|Executed tool|tool selected|tool executed|using tool)[=:]"??(\S+)"?/gi;
  const iterationRegex = /(?:iteration|iter)[=:]"??(\d+)"?/gi;
  const jsonTaskIdRegex = /"taskId"\s*:\s*"([a-f0-9-]+)"/gi;
  const jsonApiInstanceRegex = new RegExp(
    `"apiInstanceId"\\s*:\\s*"${targetApiInstanceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    "gi"
  );

  const unmatchedErrors: Array<{ msg: string; ts: string }> = [];

  for (const line of logLines) {
    let apiInstanceMatch = apiInstanceRegex.test(line);
    if (!apiInstanceMatch) {
      apiInstanceMatch = jsonApiInstanceRegex.test(line);
      if (!apiInstanceMatch) {
        if (BROKER_ERROR_PATTERNS.some(re => re.test(line))) {
          const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
          unmatchedErrors.push({
            msg: line,
            ts: tsMatch ? tsMatch[1] : new Date().toISOString(),
          });
        }
        continue;
      }
      jsonApiInstanceRegex.lastIndex = 0;
    }
    apiInstanceRegex.lastIndex = 0;

    let taskIdMatch = line.match(taskIdRegex);
    if (!taskIdMatch) {
      taskIdMatch = line.match(jsonTaskIdRegex);
      if (!taskIdMatch) continue;
    }

    let taskId = "";
    if (taskIdMatch && taskIdMatch[1]) {
      taskId = taskIdMatch[1];
    } else if (taskIdMatch && taskIdMatch[0]) {
      taskId = taskIdMatch[0].replace(/(?:taskId|task_id|task-id)[=:]"?/i, "").replace(/"$/, "");
    }
    if (!taskId || taskId.length < 8) continue;

    if (!tasks[taskId]) {
      const contextMatch = line.match(contextIdRegex);
      const agentMatch = line.match(agentRegex);
      const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
      tasks[taskId] = {
        taskId,
        contextId: contextMatch ? contextMatch[0].replace("contextId=", "") : "",
        broker: agentMatch ? agentMatch[0].replace("agent=", "") : "",
        firstTool: "",
        startTime: timestampMatch ? timestampMatch[1] : new Date().toISOString(),
        endTime: null,
        maxIteration: 0,
        toolsUsed: new Set(),
        appId: "",
        apiInstanceId: targetApiInstanceId,
        logCount: 0,
      };
    }

    const task = tasks[taskId];
    task.logCount++;

    const ctxMatch = line.match(contextIdRegex);
    if (ctxMatch && !task.contextId) task.contextId = ctxMatch[0].replace("contextId=", "");

    const agtMatch = line.match(agentRegex);
    if (agtMatch && !task.broker) task.broker = agtMatch[0].replace("agent=", "");

    const iterMatch = line.match(iterationRegex);
    if (iterMatch) {
      const it = parseInt(iterMatch[0].replace("iteration=", ""), 10);
      if (it > task.maxIteration) task.maxIteration = it;
    }

    const toolMatch = line.match(toolRegex);
    if (toolMatch) {
      const tool = toolMatch[0].replace(/(?:LLM selected tool|Executed tool) /, "");
      task.toolsUsed.add(tool);
      if (!task.firstTool) task.firstTool = tool;
    }

    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
    if (tsMatch) {
      const timestamp = tsMatch[1];
      if (!task.startTime || timestamp < task.startTime) task.startTime = timestamp;
      if (line.includes("Executed tool") || line.includes("HTTP/1.1 2")) {
        if (!task.endTime || timestamp > task.endTime) task.endTime = timestamp;
      }
    }
  }

  if (unmatchedErrors.length > 0) {
    const errorTasks = groupBrokerErrors(unmatchedErrors, targetApiInstanceId);
    for (const et of errorTasks) {
      if (!tasks[et.taskId]) tasks[et.taskId] = et;
    }
    debugLog(`[RUNTIME-LOGS] Found ${errorTasks.length} error-only broker run(s) without taskId`);
  }

  debugLog("[RUNTIME-LOGS] Parsed", Object.keys(tasks).length, "tasks from", logLines.length, "lines");
  return Object.values(tasks);
}

function groupBrokerErrors(
  errors: Array<{ msg: string; ts: string }>,
  fallbackApiInstanceId: string
): BrokerTaskAccumulator[] {
  if (errors.length === 0) return [];
  errors.sort((a, b) => a.ts.localeCompare(b.ts));

  const groups: Array<typeof errors> = [];
  let current = [errors[0]];
  for (let i = 1; i < errors.length; i++) {
    const gap = new Date(errors[i].ts).getTime() - new Date(errors[i - 1].ts).getTime();
    if (gap <= 5_000) {
      current.push(errors[i]);
    } else {
      groups.push(current);
      current = [errors[i]];
    }
  }
  groups.push(current);

  return groups.map((g) => {
    const syntheticId = `err-${new Date(g[0].ts).getTime()}`;
    const firstMsg = g[0].msg;
    const errorSnippet = firstMsg.length > 120 ? firstMsg.slice(0, 120) + "…" : firstMsg;
    return {
      taskId: syntheticId,
      contextId: "",
      broker: "broker (error)",
      firstTool: `ERROR: ${errorSnippet}`,
      startTime: g[0].ts,
      endTime: g[g.length - 1].ts,
      maxIteration: 0,
      toolsUsed: new Set<string>(),
      appId: "",
      apiInstanceId: fallbackApiInstanceId,
      logCount: g.length,
      status: "error" as const,
    };
  });
}
