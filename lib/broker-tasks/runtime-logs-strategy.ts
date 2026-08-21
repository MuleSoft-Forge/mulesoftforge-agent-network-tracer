/**
 * Strategy B: Discover broker tasks via AMC GET /logs (Runtime Manager + Application Manager).
 * Used when the org does NOT have Monitoring Center Premium (_msearch unavailable).
 *
 * This module is ONLY about AMC deployment resolution + GET /logs + text parsing.
 * It does not call _msearch. Keep it that way so fixes here don't break the msearch path.
 */

import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";
import { buildAmcLogsUrl } from "@/lib/api/amc-logs";
import { deploymentNameCandidates } from "@/lib/broker-context/amc-deployment-match";
import { isHyperscaleDeploymentType } from "@/lib/broker-context/log-search-ids";
import { measurePhase, type PhaseTimer } from "@/lib/api/timing";
import { chooseSpecIdAtOrBefore, type AmcSpecDescriptor } from "@/lib/broker-tasks/amc-spec-selection";
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
  /** Broker route segment(s) for HY/Flex shared-gateway log matching. */
  brokerRouteSegments?: string[];
  /** HY/RR/RF — assign apiInstanceId when logs match route but omit apiInstanceId. */
  deploymentType?: string;
  /** When true, org has Log Search — do not tag responses as no-entitlement. */
  logSearchEntitled?: boolean;
  /** Optional timer for upstream call counters. */
  timer?: PhaseTimer;
}

export async function fetchTasksViaRuntimeLogs(
  params: RuntimeLogsStrategyParams
): Promise<BrokerTasksResult> {
  const {
    orgId,
    apiInstanceId,
    accessToken,
    baseUrl,
    timeRangeMs,
    envId,
    brokerAppName,
    brokerRouteSegments,
    deploymentType,
    logSearchEntitled = false,
    timer,
  } = params;
  const routeSegments = [...new Set((brokerRouteSegments ?? []).filter((s) => s.length > 0))];
  const relaxApiInstanceFromMessage = isHyperscaleDeploymentType(deploymentType);
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
    const environments = await measurePhase(timer, "rl-list-envs", () =>
      listRuntimeEnvironments(baseUrl, orgId, accessToken)
    );
    timer?.count("runtimeEnvironmentsProbed", environments.length);

    // When the caller already knows the environment, probe only that one.
    // `tryEnvironmentApproaches` opens by resolving the API instance in the
    // environment it is given and returns immediately when that 404s — and an
    // API instance exists in exactly one environment. Fanning out therefore
    // spends a round trip per environment that provably cannot contribute.
    // It also tries more deployment-name candidates than a lookup by app name
    // alone, so it subsumes the app-name fast path this replaced.
    const knownEnvId = envId && environments.some((e) => e.id === envId) ? envId : null;
    if (knownEnvId) {
      const tasks = await measurePhase(timer, "rl-known-env", () =>
        tryEnvironmentApproaches(
          baseUrl,
          orgId,
          knownEnvId,
          apiInstanceId,
          accessToken,
          brokerAppName,
          logWindow,
          routeSegments,
          relaxApiInstanceFromMessage,
          timer
        )
      );
      const inWindow = filterAccumulators(tasks);
      if (inWindow.length > 0) {
        timer?.note("rlOutcome", "known-env");
        timer?.count("rlTasks", inWindow.length);
        return { tasks: finaliseTasks(inWindow), source: "runtime-logs", totalLogs: 0, mode: resultMode };
      }
    }

    // Resolve deployment via Runtime Manager
    const apiInstanceInfo = await measurePhase(timer, "rl-rm-resolve", () =>
      resolveDeploymentFromRM(baseUrl, orgId, environments, apiInstanceId, accessToken)
    );

    const allTasks: Record<string, BrokerTaskAccumulator> = {};

    // Try the RM-resolved deployment first
    if (apiInstanceInfo?.deploymentId && apiInstanceInfo?.targetEnvId) {
      const tasks = await measurePhase(timer, "rl-rm-deployment", () =>
        fetchAndParseLogs(
          baseUrl,
          orgId,
          apiInstanceInfo.targetEnvId,
          apiInstanceInfo.deploymentId,
          apiInstanceId,
          accessToken,
          logWindow,
          routeSegments,
          relaxApiInstanceFromMessage
        )
      );
      mergeTasks(allTasks, tasks);
    }

    // A broker lives in exactly one environment, but which one is not known
    // until API Manager answers, so every environment has to be probed. Probing
    // them concurrently turns an N-environment serial walk (each iteration
    // several dependent AMC round trips) into roughly one environment's latency.
    if (Object.keys(allTasks).length === 0) {
      const remainingEnvs = environments.filter((env) => env.id !== knownEnvId);
      const perEnvResults = await measurePhase(timer, "rl-env-fanout", () =>
        Promise.all(
          remainingEnvs.map((env) =>
            tryEnvironmentApproaches(
              baseUrl,
              orgId,
              env.id,
              apiInstanceId,
              accessToken,
              brokerAppName,
              logWindow,
              routeSegments,
              relaxApiInstanceFromMessage
            )
          )
        )
      );
      for (const envTasks of perEnvResults) mergeTasks(allTasks, envTasks);
      timer?.note("rlOutcome", "env-fanout");
    }

    const inWindow = filterAccumulators(Object.values(allTasks));
    timer?.count("rlTasks", inWindow.length);
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

/**
 * Probe every environment concurrently and keep the first match in environment
 * order, which is the same result the previous serial scan produced but at one
 * round trip of latency instead of N.
 */
async function resolveDeploymentFromRM(
  baseUrl: string,
  orgId: string,
  environments: EnvInfo[],
  apiInstanceId: string,
  accessToken: string
): Promise<{ deploymentId: string; targetEnvId: string } | null> {
  const candidates = await Promise.all(
    environments.map(async (env) => {
      try {
        const url = `${baseUrl}/apimanager/api/v1/organizations/${orgId}/environments/${env.id}/apis/${apiInstanceId}`;
        const res = await loggedFetch(url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) return null;
        const body = (await res.json()) as {
          deploymentId?: string;
          deployment?: { deploymentId?: string | null; applicationId?: string };
        };
        const deploymentId = body.deploymentId ?? body.deployment?.deploymentId ?? body.deployment?.applicationId;
        return deploymentId ? { deploymentId, targetEnvId: env.id } : null;
      } catch {
        return null;
      }
    })
  );

  const match = candidates.find((c) => c !== null) ?? null;
  if (match) {
    debugLog("[RUNTIME-LOGS] RM resolved deployment:", match.deploymentId, "env:", match.targetEnvId);
  }
  return match;
}

async function resolveSpecId(
  baseUrl: string,
  orgId: string,
  envId: string,
  deploymentId: string,
  accessToken: string,
  window: AmcLogWindow
): Promise<string | null> {
  const specsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/specs`;
  const specsRes = await loggedFetch(specsUrl, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
  if (specsRes.ok) {
    const specs = (await specsRes.json()) as AmcSpecDescriptor[];
    const specId = chooseSpecIdAtOrBefore(specs ?? [], window.endTime);
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
  window: AmcLogWindow,
  brokerRouteSegments: string[] = [],
  relaxApiInstanceFromMessage = false
): Promise<BrokerTaskAccumulator[]> {
  const specId = await resolveSpecId(baseUrl, orgId, envId, deploymentId, accessToken, window);
  if (!specId) return [];
  const logsText = await fetchLogsFromAmc(baseUrl, orgId, envId, deploymentId, specId, accessToken, window);
  if (!logsText) return [];
  return parseLogsForTasks(
    logsText,
    apiInstanceId,
    brokerRouteSegments,
    relaxApiInstanceFromMessage
  );
}

/**
 * Merge parsed accumulators into a target map, combining counters for taskIds
 * seen in more than one source.
 */
function mergeTasks(
  target: Record<string, BrokerTaskAccumulator>,
  incoming: BrokerTaskAccumulator[]
): void {
  for (const task of incoming) {
    const existing = target[task.taskId];
    if (!existing) {
      target[task.taskId] = task;
      continue;
    }
    existing.logCount += task.logCount;
    if (task.maxIteration > existing.maxIteration) existing.maxIteration = task.maxIteration;
    task.toolsUsed.forEach((tool) => existing.toolsUsed.add(tool));
    if (!existing.firstTool && task.firstTool) existing.firstTool = task.firstTool;
  }
}

/**
 * Returns the tasks found for a single environment. Deliberately returns rather
 * than mutating shared state so callers can run environments concurrently.
 */
async function tryEnvironmentApproaches(
  baseUrl: string,
  orgId: string,
  envId: string,
  apiInstanceId: string,
  accessToken: string,
  brokerAppName: string | undefined,
  window: AmcLogWindow,
  brokerRouteSegments: string[] = [],
  relaxApiInstanceFromMessage = false,
  /** Set only for the single known-environment probe; the fan-out runs
   *  concurrently and would interleave its stages into one another's. */
  timer?: PhaseTimer
): Promise<BrokerTaskAccumulator[]> {
  const found: BrokerTaskAccumulator[] = [];
  const stage = (reached: string): void => timer?.note("rlKnownEnvStage", reached);
  stage("start");
  try {
    const rmUrl = `${baseUrl}/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiInstanceId}`;
    const rmRes = await measurePhase(timer, "rl-ke-apim", () =>
      loggedFetch(rmUrl, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } })
    );
    if (!rmRes.ok) {
      stage(`apim-${rmRes.status}`);
      return found;
    }

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
    const amcLookupNames = deploymentNameCandidates(brokerAppName, apiInfo.assetId, apiInfo.instanceLabel);

    const deploymentIdToTry = deploymentIdFromDeployment || applicationId || apiInfo.deploymentId || targetId;
    if (!deploymentIdToTry) {
      stage("no-deployment-id");
      return found;
    }

    interface Approach {
      name: string;
      deploymentId: string;
      specId?: string;
      getSpecs: boolean;
    }
    const approaches: Approach[] = [];

    if (brokerAppName) {
      try {
        await measurePhase(timer, "rl-ke-amc-list", async () => {
          for (const candidate of amcLookupNames) {
            const listUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments?name=${encodeURIComponent(candidate)}`;
            const listRes = await loggedFetch(listUrl, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
            if (!listRes.ok) continue;
            const listData = (await listRes.json()) as { items?: Array<{ id: string; name: string }> };
            if (listData.items?.length === 1) {
              approaches.push({ name: "amc-by-app-name", deploymentId: listData.items[0].id, getSpecs: true });
              break;
            }
          }
        });
        timer?.count("rlKnownEnvNameLookups", amcLookupNames.length);
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

    if (approaches.length === 0) stage("no-approaches");
    timer?.count("rlKnownEnvApproaches", approaches.length);

    for (const approach of approaches) {
      try {
        let specId: string | null = approach.specId ?? null;
        if (approach.getSpecs) {
          specId = await measurePhase(timer, "rl-ke-specs", () =>
            resolveSpecId(baseUrl, orgId, envId, approach.deploymentId, accessToken, window)
          );
          if (!specId) {
            stage("no-spec-id");
            continue;
          }
        }
        if (!specId) continue;

        const logsText = await measurePhase(timer, "rl-ke-logs", () =>
          fetchLogsFromAmc(baseUrl, orgId, envId, approach.deploymentId, specId as string, accessToken, window)
        );
        if (!logsText) {
          stage("no-logs");
          continue;
        }
        timer?.count("rlKnownEnvLogChars", logsText.length);

        const parsedTasks = parseLogsForTasks(
          logsText,
          apiInstanceId,
          brokerRouteSegments,
          relaxApiInstanceFromMessage
        );
        found.push(...parsedTasks);
        if (parsedTasks.length > 0) {
          debugLog(`[RUNTIME-LOGS] Approach "${approach.name}": found ${parsedTasks.length} tasks`);
          stage("tasks");
          break;
        }
        stage("logs-no-tasks");
      } catch {
        continue;
      }
    }
  } catch {
    /* ignore env */
  }
  return found;
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

function lineMatchesBrokerScope(
  line: string,
  targetApiInstanceId: string,
  apiInstanceRegex: RegExp,
  jsonApiInstanceRegex: RegExp,
  brokerRouteSegments: string[]
): boolean {
  if (apiInstanceRegex.test(line)) {
    apiInstanceRegex.lastIndex = 0;
    return true;
  }
  if (jsonApiInstanceRegex.test(line)) {
    jsonApiInstanceRegex.lastIndex = 0;
    return true;
  }
  apiInstanceRegex.lastIndex = 0;
  jsonApiInstanceRegex.lastIndex = 0;
  return brokerRouteSegments.some((segment) => line.includes(segment));
}

/** Exported for tests — pure over `logsText`, no I/O. */
export function parseLogsForTasks(
  logsText: string,
  targetApiInstanceId: string,
  brokerRouteSegments: string[] = [],
  relaxApiInstanceFromMessage = false
): BrokerTaskAccumulator[] {
  const tasks: Record<string, BrokerTaskAccumulator> = {};
  const logLines = logsText.split("\n").filter((line: string) => line.trim().length > 0);
  debugLog("[RUNTIME-LOGS] Parsing", logLines.length, "log lines");

  // These are used with `String.match` to read their capture group, so they must
  // NOT carry the `g` flag: a global regex makes `match` return the list of whole
  // matches instead, which turned `[1]` into "the second occurrence, prefix
  // included" — e.g. a line mentioning two task ids yielded the literal
  // `taskId=<id>` as a task id, inventing a bogus row in the task list.
  const taskIdRegex = /(?:taskId|task_id|task-id)[=:]"?([a-f0-9-]+)"?/i;
  const apiInstanceRegex = new RegExp(
    `(?:apiInstanceId|api_instance_id|api-instance-id)[=:]"?${targetApiInstanceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?`,
    "gi"
  );
  const contextIdRegex = /(?:contextId|context_id|context-id)[=:]"?([a-f0-9-]+)"?/i;
  const agentRegex = /(?:agent|broker)[=:]"??(\S+)"?/i;
  const toolRegex = /(?:LLM selected tool|Executed tool|tool selected|tool executed|using tool)[=:]"??(\S+)"?/i;
  const iterationRegex = /(?:iteration|iter)[=:]"??(\d+)"?/i;
  const jsonTaskIdRegex = /"taskId"\s*:\s*"([a-f0-9-]+)"/i;
  const jsonApiInstanceRegex = new RegExp(
    `"apiInstanceId"\\s*:\\s*"${targetApiInstanceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
    "gi"
  );

  const unmatchedErrors: Array<{ msg: string; ts: string }> = [];

  for (const line of logLines) {
    const scopedToBroker = lineMatchesBrokerScope(
      line,
      targetApiInstanceId,
      apiInstanceRegex,
      jsonApiInstanceRegex,
      brokerRouteSegments
    );
    if (!scopedToBroker) {
      if (BROKER_ERROR_PATTERNS.some(re => re.test(line))) {
        const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
        unmatchedErrors.push({
          msg: line,
          ts: tsMatch ? tsMatch[1] : new Date().toISOString(),
        });
      }
      continue;
    }

    let taskIdMatch = line.match(taskIdRegex);
    if (!taskIdMatch) {
      taskIdMatch = line.match(jsonTaskIdRegex);
      if (!taskIdMatch) continue;
    }

    const taskId = taskIdMatch[1] ?? "";
    if (!taskId || taskId.length < 8) continue;

    if (!tasks[taskId]) {
      const contextMatch = line.match(contextIdRegex);
      const agentMatch = line.match(agentRegex);
      const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
      tasks[taskId] = {
        taskId,
        contextId: contextMatch?.[1] ?? "",
        broker: agentMatch?.[1] ?? "",
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

    if (
      !task.apiInstanceId &&
      relaxApiInstanceFromMessage &&
      brokerRouteSegments.some((segment) => line.includes(segment))
    ) {
      task.apiInstanceId = targetApiInstanceId;
    }

    const ctxMatch = line.match(contextIdRegex);
    if (ctxMatch?.[1] && !task.contextId) task.contextId = ctxMatch[1];

    const agtMatch = line.match(agentRegex);
    if (agtMatch?.[1] && !task.broker) task.broker = agtMatch[1];

    const iterMatch = line.match(iterationRegex);
    if (iterMatch?.[1]) {
      const it = parseInt(iterMatch[1], 10);
      if (Number.isFinite(it) && it > task.maxIteration) task.maxIteration = it;
    }

    const toolMatch = line.match(toolRegex);
    if (toolMatch?.[1]) {
      const tool = toolMatch[1];
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
