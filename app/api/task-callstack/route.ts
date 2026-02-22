import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError, debugLog } from "@/lib/api-logger";
import { TaskCallstackRequestSchema } from "@/lib/schemas";
import { fetchObjectStoreData, getObjectStoreRegionFromDeployment, getMonitoringLogCategoriesFromDeployment } from "@/lib/object-store/client";
import { getOAuthConfig, AMC_COMMON_SCOPES_TO_TRY } from "@/lib/auth/config";
import type { ApiStatus } from "@/components/task-details/types";
import { requireAuth } from "@/lib/api/auth-middleware";
import { msearch } from "@/lib/api/msearch";
import { validationError } from "@/lib/api/error-responses";

export const dynamic = "force-dynamic";

/**
 * AMC 403: The token is allowed to list deployments but not to read deployment detail or
 * specs (and thus not logs). Mulesoft docs: scope "Read Applications" (read:applications)
 * allows GET /organizations/{{org}}/environments/{{envId}}/deployments/** — the org must
 * grant that scope for the Connected App so detail/specs/logs are allowed.
 */
function buildAmc403Message(apiErrorMessage: string, currentScopes: string): string {
  return `Application Manager API returned 403 Forbidden.

API Error: ${apiErrorMessage}

The token can list deployments but is not allowed to read deployment detail or specs (and thus not logs). Mulesoft docs: scope "Read Applications" (read:applications) allows GET .../organizations/{{org}}/environments/{{envId}}/deployments/**. Ensure your Anypoint org has granted the Connected App the Read Applications scope so deployment detail, specs, and logs are allowed.

To test different scopes:
1. Set ANYPOINT_SCOPES environment variable with the scope you want to test, e.g.:
   export ANYPOINT_SCOPES="profile read:exchange view:monitoring read:api_configuration read:api_policies manage:store_data <SCOPE_TO_TEST>"
2. Update your Connected App in Anypoint Platform to include that scope
3. Sign out and sign back in

Common scopes to try: ${AMC_COMMON_SCOPES_TO_TRY}
Current scopes being requested: ${currentScopes}`;
}

/** Deployment type from Runtime Manager: HY = Hybrid (on-prem/Runtime Fabric), CH = CloudHub, etc. */
type DeploymentTypeHint = "HY" | "CH" | string | undefined;

/**
 * Fetch deployment detail via Hybrid (Runtime Manager) API. Used for HY deployments where AMC v2 returns 400 (e.g. ProviderType.RR).
 * Returns monitoring categories from application config if present; no region (Hybrid is not CloudHub).
 */
async function fetchDeploymentDetailViaHybrid(
  orgId: string,
  envId: string,
  applicationId: string,
  accessToken: string,
  baseUrl: string
): Promise<{
  region?: string;
  monitoringSuggestions: ApiStatus["monitoringSuggestions"];
  deploymentApiStatus: "ok" | "403_forbidden";
}> {
  const url = `${baseUrl}/hybrid/api/v1/applications`;
  const res = await loggedFetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-ANYPNT-ORG-ID": orgId,
      "X-ANYPNT-ENV-ID": envId,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 403) {
      throw new Error(
        `Hybrid API: deployment detail required but forbidden (403). ${text.slice(0, 200)}`
      );
    }
    throw new Error(
      `Hybrid API: deployment detail failed: ${res.status} ${res.statusText}. ${text.slice(0, 200)}`
    );
  }
  const data = (await res.json()) as { data?: Array<Record<string, unknown>> } | Record<string, unknown>[];
  const list = Array.isArray(data) ? data : (data?.data ?? []);
  const app = list.find(
    (item: Record<string, unknown>) =>
      String(item.id ?? item.applicationId ?? "").toLowerCase() === applicationId.toLowerCase() ||
      (item as { applicationId?: string }).applicationId === applicationId
  ) as Record<string, unknown> | undefined;
  if (!app) {
    debugLog("[Hybrid] No application found for applicationId:", applicationId, "list length:", list.length);
    return {
      monitoringSuggestions: { brokerLogger: false, insecureLogging: false },
      deploymentApiStatus: "ok",
    };
  }
  const monitoringSuggestions = getMonitoringLogCategoriesFromDeployment(app);
  return { region: undefined, monitoringSuggestions, deploymentApiStatus: "ok" };
}

/**
 * Fetch deployment detail. Branches by deployment type: Hybrid (HY) uses Hybrid API; CloudHub/AMC uses AMC v2.
 * On AMC v2 400 with ProviderType.RR (unsupported), falls back to Hybrid API.
 * Returns object store region hint (AMC only) and monitoring log categories.
 */
async function fetchDeploymentDetail(
  orgId: string,
  envId: string,
  deploymentId: string,
  accessToken: string,
  baseUrl: string,
  options?: { deploymentType?: DeploymentTypeHint }
): Promise<{
  region?: string;
  monitoringSuggestions: ApiStatus["monitoringSuggestions"];
  deploymentApiStatus: "ok" | "403_forbidden";
}> {
  const deploymentType = options?.deploymentType;

  if (deploymentType === "HY") {
    debugLog("[fetchDeploymentDetail] HY detected, using Hybrid API for applicationId:", deploymentId);
    return fetchDeploymentDetailViaHybrid(orgId, envId, deploymentId, accessToken, baseUrl);
  }

  const url = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}`;
  const res = await loggedFetch(url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const is400RR =
      res.status === 400 &&
      (text.includes("ProviderType.RR") || text.includes("No enum constant"));
    if (is400RR) {
      debugLog("[fetchDeploymentDetail] AMC v2 400 (RR/Hybrid), falling back to Hybrid API");
      return fetchDeploymentDetailViaHybrid(orgId, envId, deploymentId, accessToken, baseUrl);
    }
    if (res.status === 403) {
      throw new Error(
        `Deployment detail required but forbidden (403). Ensure the Connected App has Read Applications scope. ${text.slice(0, 200)}`
      );
    }
    throw new Error(
      `Deployment detail required but failed: ${res.status} ${res.statusText}. ${text.slice(0, 200)}`
    );
  }
  const deployment = (await res.json()) as Record<string, unknown>;
  const region = getObjectStoreRegionFromDeployment(
    deployment as Parameters<typeof getObjectStoreRegionFromDeployment>[0]
  ) ?? undefined;
  const monitoringSuggestions = getMonitoringLogCategoriesFromDeployment(deployment);
  return { region, monitoringSuggestions, deploymentApiStatus: "ok" };
}


function classifyLog(logger: string, message: string): string {
  if (logger === "http-listener-config") {
    if (/^LISTENER\s*\n.*POST\s+\//m.test(message) || message.startsWith("LISTENER\nPOST"))
      return "INBOUND_REQUEST";
    if (message.includes("HTTP/1.1 200") || message.includes("HTTP/1.1 2"))
      return "FINAL_RESPONSE";
  }
  if (logger === "Loop") {
    if (message.includes("LLM selected tool")) return "LLM_TOOL_SELECTION";
    if (message.includes("Executed tool")) return "TOOL_EXECUTED";
    if (message.includes("No tool selected")) return "LLM_NO_TOOL";
  }
  if (logger === "INSECURE-LOGGING") {
    if (message.startsWith("Tool Input:")) return "TOOL_INPUT";
    if (message.startsWith("Sending A2A")) return "A2A_MESSAGE_SENT";
    if (message.startsWith("Output was:")) return "TOOL_OUTPUT";
  }
  if (logger.includes("a2a-http-client")) {
    if (message.includes("agent-card.json")) return "AGENT_DISCOVERY";
    if (/REQUESTER\s*\nPOST\s+\//m.test(message)) return "DOWNSTREAM_REQUEST";
    if (/REQUESTER\s*\nHTTP\/1\.1\s+\d/m.test(message)) return "DOWNSTREAM_RESPONSE";
    return "HTTP_CHUNK";
  }
  if (logger === "flex-gateway-envoy") return "GATEWAY";
  return "OTHER";
}

function parseFields(message: string) {
  const f: Record<string, unknown> = {};
  const m = (rx: RegExp) => (message.match(rx) || [])[1] || null;
  f.taskId = m(/taskId=([a-f0-9-]+)/);
  f.contextId = m(/contextId=([a-f0-9-]+)/);
  f.apiInstanceId = m(/apiInstanceId=(\d+)/);
  f.iteration = m(/iteration=(\d+)/);
  f.agent = m(/agent=(\S+)/);
  f.traceId = m(/traceparent: 00-([a-f0-9]{32})/);
  f.spanId = m(/traceparent: 00-[a-f0-9]{32}-([a-f0-9]{16})/);
  f.correlationId = m(/[Xx]-[Cc]orrelation-[Ii]d: ([a-f0-9-]+)/);
  f.tool = m(/(?:LLM selected tool|Executed tool) (\S+)/);
  // Extract embedded JSON
  if (message.startsWith("Tool Input:")) {
    const jsonMatch = message.match(/Tool Input: ([\s\S]+?)(?:\s+agent=|$)/);
    if (jsonMatch) {
      try {
        f.toolInputJson = JSON.parse(jsonMatch[1].trim());
      } catch {
        // ignore
      }
    }
  }
  if (message.startsWith("Output was:")) {
    const jsonMatch = message.match(/Output was: ([\s\S]+?)(?:\s+agent=|$)/);
    if (jsonMatch) {
      try {
        f.toolOutputJson = JSON.parse(jsonMatch[1].trim());
      } catch {
        // ignore
      }
    }
  }
  // Extract user message from LISTENER inbound
  const jsonRpcMatch = message.match(/\{"jsonrpc"[\s\S]*\}/);
  if (jsonRpcMatch) {
    try {
      const rpc = JSON.parse(jsonRpcMatch[0]);
      if (rpc.params && rpc.params.message) {
        const parts = rpc.params.message.parts || [];
        f.userMessage = parts.map((p: { text?: string }) => p.text || "").join(" ").trim();
        f.messageId = rpc.params.message.messageId || null;
      }
      if (rpc.result) {
        f.resultStatus = rpc.result.status && rpc.result.status.state;
        f.resultTaskId = rpc.result.id;
        f.resultContextId = rpc.result.contextId;
      }
    } catch {
      // ignore
    }
  }
  return f;
}

/**
 * Normalize timestamp from Elasticsearch/flex-gateway: may be ISO string or numeric string (epoch ms).
 * Returns a number (ms) for consistent duration math and UI formatting.
 */
function normalizeTimestamp(ts: string | number | null | undefined): number | string {
  if (ts == null) return "";
  if (typeof ts === "number" && !Number.isNaN(ts)) return ts;
  const str = String(ts);
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  return ts as string;
}

function summarizeLine(type: string, message: string, fields: Record<string, unknown>): string {
  switch (type) {
    case "INBOUND_REQUEST":
      return fields.userMessage ? `"${fields.userMessage}"` : "Inbound POST request";
    case "LLM_TOOL_SELECTION":
      return `LLM selected: ${((fields.tool as string) || "?").replace(/^[a-zA-Z0-9]+_/, "")}`;
    case "TOOL_INPUT":
      return fields.toolInputJson
        ? `Input: ${JSON.stringify(fields.toolInputJson).slice(0, 80)}`
        : "Tool input";
    case "A2A_MESSAGE_SENT": {
      const agentMatch = message.match(/to agent (\S+)/);
      return `A2A message to ${agentMatch ? agentMatch[1].replace(/^[a-zA-Z0-9]+_/, "") : "?"}`;
    }
    case "DOWNSTREAM_REQUEST": {
      const urlMatch = message.match(/POST\s+(\S+)/);
      return `POST ${urlMatch ? urlMatch[1].split("/").slice(-2).join("/") : "?"}`;
    }
    case "DOWNSTREAM_RESPONSE": {
      const statusMatch = message.match(/HTTP\/1\.1\s+(\d+)/);
      return `Response ${statusMatch ? statusMatch[1] : "?"}`;
    }
    case "TOOL_EXECUTED":
      return `Executed: ${((fields.tool as string) || "?").replace(/^[a-zA-Z0-9]+_/, "")}`;
    case "TOOL_OUTPUT":
      return fields.toolOutputJson
        ? `Output: ${JSON.stringify(fields.toolOutputJson).slice(0, 80)}`
        : "Tool output";
    case "FINAL_RESPONSE":
      return fields.resultStatus ? `Task ${fields.resultStatus}` : "Final response";
    case "AGENT_DISCOVERY": {
      const agMatch = message.match(/\/([^/]+)\/\.well-known/);
      return `Discover agent: ${agMatch ? agMatch[1] : "?"}`;
    }
    case "GATEWAY":
      return "Gateway log";
    case "HTTP_CHUNK":
      return "HTTP chunk";
    case "LLM_NO_TOOL":
      return "LLM reasoning (no tool selected)";
    default:
      return message.split("\n")[0].slice(0, 80);
  }
}

/** Trace span shape returned from observability spans:search and sent to the UI */
type TraceSpanRow = {
  traceId: string;
  spanId: string;
  name: string;
  kind: string;
  statusCode: string;
  httpStatusCode?: string;
  duration: number;
  endTime: number;
  entityId?: string;
  entityName?: string;
  entityType?: string;
  envId?: string;
  orgId?: string;
  orgName?: string;
  envName?: string;
};

/** Status of the Observability spans:search call for apiStatus. */
type TraceSpansStatus = "ok" | "403" | "skipped" | "error";

/**
 * Fetch OTEL trace spans for a trace from Anypoint Observability API.
 * Requires orgId, traceId, and envId. Uses timestamp BETWEEN for time range (API requirement).
 * Returns spans and status for API status table in task details.
 */
async function fetchTraceSpans(
  orgId: string,
  traceId: string,
  accessToken: string,
  baseUrl: string,
  envId: string,
  traceStartTime?: string | number,
  traceEndTime?: string | number
): Promise<{ spans: TraceSpanRow[]; status: TraceSpansStatus }> {
  if (!traceId || traceId.trim() === "" || !orgId || !envId || envId.trim() === "") {
    return { spans: [], status: "skipped" };
  }

  try {
    let startTimeMs: number;
    let endTimeMs: number;
    if (traceStartTime != null && traceEndTime != null) {
      const start = typeof traceStartTime === "number" ? traceStartTime : new Date(traceStartTime).getTime();
      const end = typeof traceEndTime === "number" ? traceEndTime : new Date(traceEndTime).getTime();
      const padding = 30 * 60 * 1000; // 30 minutes
      startTimeMs = Math.max(0, start - padding);
      endTimeMs = end + padding;
    } else {
      const now = Date.now();
      startTimeMs = now - 30 * 24 * 3600 * 1000; // 30 days
      endTimeMs = now;
    }

    const query = `SELECT "span_id" AS spanId, name, kind, "trace_id" AS traceId, "status_code" AS statusCode, "http.status_code" AS httpStatusCode, duration, "end_time_nano" AS endTime, "entity.id" AS entityId, "entity.name" AS entityName, "entity.type" AS entityType, "env.id" AS envId, "sub_org.id" AS orgId, "sub_org.name" AS orgName, "env.name" AS envName WHERE "sub_org.id" = '${orgId}' AND "env.id" = '${envId}' AND "trace_id" = '${traceId}' AND timestamp BETWEEN ${startTimeMs} AND ${endTimeMs} ORDER BY timestamp ASC LIMIT 500`;

    const url = `${baseUrl}/observability/api/v1/spans:search`;
    const res = await loggedFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      debugLog("[fetchTraceSpans] spans:search failed:", res.status);
      const status: TraceSpansStatus = res.status === 403 ? "403" : "error";
      return { spans: [], status };
    }

    const data = (await res.json()) as { data?: TraceSpanRow[] };
    const spans = (data.data ?? []).filter((span: TraceSpanRow): span is TraceSpanRow & { traceId: string; spanId: string } => Boolean(span.traceId && span.spanId));
    return { spans, status: "ok" };
  } catch (err) {
    debugLog("[fetchTraceSpans] error:", err);
    return { spans: [], status: "error" };
  }
}

/**
 * Parse runtime logs text for a given taskId and return entries + jobCard, or null if none.
 */
function parseRuntimeLogsToEntriesAndJobCard(
  logsText: string,
  taskId: string
): { entries: unknown[]; jobCard: unknown } | null {
  const taskIdPattern = taskId.replace(/-/g, "[-]");
  const lineTaskIdRegex = new RegExp(taskIdPattern, "gi");
  const logLines = logsText.split("\n").filter((line: string) => line.trim().length > 0);
  const entries: unknown[] = [];
  let entryIndex = 0;
  for (const line of logLines) {
    lineTaskIdRegex.lastIndex = 0;
    if (!lineTaskIdRegex.test(line)) continue;
    const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
    const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString();
    const loggerMatch = line.match(/\[[\w]+\]\s+(\S+)\s+(\S+)/);
    const logger = loggerMatch ? loggerMatch[1] : "";
    const level = loggerMatch ? loggerMatch[2] : "";
    const messageMatch = line.match(/^[\d-T:Z.]+\s+\w+\s+\[[\w]+\]\s+[\w-]+\s+[\w-]+\s+(.+)$/);
    const message = messageMatch ? messageMatch[1] : line;
    const type = classifyLog(logger, message);
    const fields = parseFields(message);
    const summary = summarizeLine(type, message, fields);
    entries.push({
      index: entryIndex++,
      type,
      summary,
      timestamp,
      logger,
      level,
      appId: "",
      workerId: "",
      fields,
      raw: { message, logger, timestamp, "log-level": level },
      _id: `runtime-${entryIndex}`,
      _index: "runtime",
    });
  }
  if (entries.length === 0) return null;
  const inbound = entries.find((e: unknown) => (e as { type?: string }).type === "INBOUND_REQUEST");
  const finalResp = entries.find((e: unknown) => (e as { type?: string }).type === "FINAL_RESPONSE");
  const toolSelections = entries.filter((e: unknown) => (e as { type?: string }).type === "LLM_TOOL_SELECTION");
  const toolExecutions = entries.filter((e: unknown) => (e as { type?: string }).type === "TOOL_EXECUTED");
  const firstEntry = entries[0] as { timestamp?: string | number };
  const lastEntry = entries[entries.length - 1] as { timestamp?: string | number };
  let duration: string | null = null;
  if (firstEntry && lastEntry) {
    const t1 = typeof firstEntry.timestamp === "number" ? firstEntry.timestamp : new Date(firstEntry.timestamp || "").getTime();
    const t2 = typeof lastEntry.timestamp === "number" ? lastEntry.timestamp : new Date(lastEntry.timestamp || "").getTime();
    duration = ((t2 - t1) / 1000).toFixed(1);
  }
  const maxIter = Math.max(0, ...entries.map((e: unknown) => parseInt(String((e as { fields?: { iteration?: string } }).fields?.iteration || "0"), 10)));
  const toolStrings = toolSelections
    .map((e: unknown) => (e as { fields?: { tool?: string } }).fields?.tool as string)
    .filter((t: string | undefined): t is string => typeof t === "string" && Boolean(t));
  const allTools: string[] = Array.from(new Set(toolStrings));
  const jobCard = {
    taskId,
    contextId: (entries.find((e: unknown) => (e as { fields?: { contextId?: string } }).fields?.contextId) as { fields?: { contextId?: string } } | undefined)?.fields?.contextId || "",
    traceId: "",
    broker: (entries.find((e: unknown) => (e as { fields?: { agent?: string } }).fields?.agent) as { fields?: { agent?: string } } | undefined)?.fields?.agent || "",
    apiInstanceId: (entries.find((e: unknown) => (e as { fields?: { apiInstanceId?: string } }).fields?.apiInstanceId) as { fields?: { apiInstanceId?: string } } | undefined)?.fields?.apiInstanceId || "",
    userMessage: inbound ? ((inbound as { fields?: { userMessage?: string } }).fields?.userMessage || "") : "",
    messageId: inbound ? ((inbound as { fields?: { messageId?: string } }).fields?.messageId || "") : "",
    outcome: finalResp ? ((finalResp as { fields?: { resultStatus?: string } }).fields?.resultStatus || "completed") : toolExecutions.length > 0 ? "completed" : "",
    startTime: firstEntry ? firstEntry.timestamp : "",
    endTime: lastEntry ? lastEntry.timestamp : "",
    duration,
    iterations: maxIter,
    toolsUsed: allTools.map((t: string) => t.replace(/^[a-zA-Z0-9]+_/, "")),
    totalEntries: entries.length,
    appId: "",
  };
  return { entries, jobCard };
}

/**
 * In no-entitlement mode we still have envId and often apiInstanceId; resolve deploymentId and try Object Store.
 * Returns objectStore payload and status for apiStatus. Uses Runtime Manager (and AMC if needed) to get deploymentId.
 */
async function fetchObjectStoreInNoEntitlementMode(
  orgId: string,
  envId: string,
  taskId: string,
  jobCard: { broker?: string; apiInstanceId?: string; appId?: string; contextId?: string },
  apiInstanceIdFromRequest: string | undefined,
  accessToken: string,
  baseUrl: string
): Promise<{
  objectStore: {
    available: boolean;
    objectStoreStatus?: "ok" | "403_forbidden" | "no_store" | "no_keys";
    sourcesUsed?: ("tasks" | "conversations")[];
    fromTasks?: unknown;
    fromConversations?: unknown;
    llmReasoning?: unknown;
    toolCallIds?: string[];
    downstreamContextIds?: unknown;
    errors?: string[];
    debug?: unknown;
  };
  objectStoreApiStatus: ApiStatus["objectStore"];
  monitoringSuggestions?: ApiStatus["monitoringSuggestions"];
}> {
  const brokerName = (jobCard.broker ?? "").trim();
  const apiInstanceId = (jobCard.apiInstanceId || apiInstanceIdFromRequest || "").trim();
  const appId = (jobCard.appId ?? "").trim();

  let deploymentId: string | null = null;
  let deploymentType: DeploymentTypeHint = undefined;
  if (appId) {
    const appIdMatch = appId.match(/^APP_([a-f0-9-]+)__/);
    if (appIdMatch) deploymentId = appIdMatch[1];
    else if (/^[a-f0-9-]{36}$/.test(appId)) deploymentId = appId;
  }
  if (!deploymentId && apiInstanceId) {
    try {
      const rmRes = await loggedFetch(
        `${baseUrl}/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiInstanceId}`,
        { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (rmRes.ok) {
        const apiInfo = (await rmRes.json()) as {
          deploymentId?: string | number;
          deployment?: { applicationId?: string; deploymentId?: string | null; type?: string };
          endpoint?: { deploymentType?: string };
          appId?: string;
        };
        const dep = apiInfo.deployment || {};
        deploymentType = dep.type ?? apiInfo.endpoint?.deploymentType;
        const rawId =
          apiInfo.deploymentId ??
          dep.deploymentId ??
          dep.applicationId ??
          apiInfo.deployment?.applicationId ??
          null;
        if (rawId != null) deploymentId = String(rawId).trim() || null;
        if (!deploymentId && apiInfo.appId) {
          const m = String(apiInfo.appId).match(/^APP_([a-f0-9-]+)__/);
          if (m) deploymentId = m[1];
        }
      } else {
        deploymentType = undefined;
      }
    } catch (e) {
      debugLog("[NO-ENTITLEMENT] Object Store: error resolving deploymentId from Runtime Manager", e);
      deploymentType = undefined;
    }
  } else {
    deploymentType = undefined;
  }

  if (!envId || !deploymentId) {
    throw new Error(
      "Deployment is required but could not be resolved. Ensure the API is deployed and visible in Runtime Manager (or pass apiInstanceId)."
    );
  }

  const deploymentDetail = await fetchDeploymentDetail(orgId, envId, deploymentId, accessToken, baseUrl, {
    deploymentType,
  });
  const objectStoreRegion = deploymentDetail.region;

  try {
    debugLog("[NO-ENTITLEMENT] Attempting Object Store fetch - orgId, envId, taskId, brokerName, deploymentId", orgId, envId, taskId, brokerName, deploymentId);
    const objectStoreData = await fetchObjectStoreData(
      orgId,
      envId,
      taskId,
      brokerName,
      deploymentId,
      accessToken,
      undefined,
      objectStoreRegion,
      jobCard.contextId
    );
    const status: ApiStatus["objectStore"] =
      objectStoreData.objectStoreStatus ??
      (objectStoreData.available ? "ok" : objectStoreData.errors?.some((e: string) => e.includes("403")) ? "403_forbidden" : "error");
    return {
      objectStore: {
        available: objectStoreData.available,
        objectStoreStatus: objectStoreData.objectStoreStatus,
        sourcesUsed: objectStoreData.sourcesUsed,
        fromTasks: objectStoreData.fromTasks,
        fromConversations: objectStoreData.fromConversations,
        llmReasoning: objectStoreData.llmReasoning,
        toolCallIds: objectStoreData.toolCallIds,
        downstreamContextIds: objectStoreData.downstreamContextIds,
        errors: objectStoreData.errors,
        debug: objectStoreData.debug,
      },
      objectStoreApiStatus: status,
      monitoringSuggestions: deploymentDetail.monitoringSuggestions,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    debugLog("[NO-ENTITLEMENT] Object Store fetch error:", msg);
    const objectStoreApiStatus: ApiStatus["objectStore"] = msg.includes("403") ? "403_forbidden" : "error";
    return {
      objectStore: { available: false, errors: [msg] },
      objectStoreApiStatus,
      monitoringSuggestions: deploymentDetail.monitoringSuggestions,
    };
  }
}

/**
 * No-entitlement mode: get task details from runtime logs (AMC deployments + logs/file).
 * When apiInstanceId and envId are set, tries the broker's deployment first (same as task list).
 */
async function getTaskDetailsFromRuntimeLogs(
  orgId: string,
  taskId: string,
  envId: string | null,
  accessToken: string,
  baseUrl: string,
  timeRangeMs: number,
  apiInstanceId?: string | null
): Promise<{ entries: unknown[]; jobCard: unknown } | null> {
  debugLog("[NO-ENTITLEMENT] Getting task details from runtime logs for taskId:", taskId);

  const now = Date.now();
  const startTime = now - timeRangeMs;
  const endTime = now;

  // Fast path: when we have the broker's apiInstanceId and envId, fetch from that deployment first (same as task list)
  if (envId && apiInstanceId) {
    try {
      const rmUrl = `${baseUrl}/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiInstanceId}`;
      const rmRes = await loggedFetch(rmUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (rmRes.ok) {
        const apiInfo = (await rmRes.json()) as {
          deploymentId?: string;
          deployment?: { applicationId?: string; deploymentId?: string | null };
          instanceLabel?: string;
          assetId?: string;
        };
        const dep = apiInfo.deployment || {};
        const deploymentIdToTry = dep.deploymentId ?? dep.applicationId ?? apiInfo.deploymentId;
        const brokerName = (apiInfo.instanceLabel || apiInfo.assetId || "").toLowerCase();

        let deploymentId: string | null = deploymentIdToTry || null;
        if (!deploymentId && brokerName) {
          const listRes = await loggedFetch(
            `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments`,
            { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (listRes.ok) {
            const listData = (await listRes.json()) as { items?: Array<{ id: string; name: string }> };
            const items = listData.items || [];
            const normalizedBroker = brokerName.replace(/-/g, "");
            for (const item of items) {
              const nameNorm = (item.name || "").toLowerCase().replace(/-/g, "");
              if (nameNorm === normalizedBroker || nameNorm.includes(normalizedBroker) || normalizedBroker.includes(nameNorm)) {
                deploymentId = item.id;
                debugLog("[NO-ENTITLEMENT] Matched broker deployment by name:", item.name, "->", item.id);
                break;
              }
            }
          }
        }
        if (deploymentId) {
          const detailRes = await loggedFetch(
            `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}`,
            { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (detailRes.ok) {
            const detail = (await detailRes.json()) as { desiredVersion?: string; replicas?: Array<{ id: string }> };
            const specId = detail.desiredVersion ?? detail.replicas?.[0]?.id;
            if (specId) {
              const searchParams = { startTime, endTime, length: 10000, descending: true };
              const logsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/specs/${specId}/logs/file?search=${encodeURIComponent(JSON.stringify(searchParams))}`;
              const logsRes = await loggedFetch(logsUrl, {
                method: "GET",
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              if (logsRes.ok) {
                const logsText = await logsRes.text();
                const taskIdPattern = taskId.replace(/-/g, "[-]");
                if (new RegExp(taskIdPattern, "gi").test(logsText)) {
                  const parsed = parseRuntimeLogsToEntriesAndJobCard(logsText, taskId);
                  if (parsed) {
                    debugLog("[NO-ENTITLEMENT] Task details from broker deployment");
                    return parsed;
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {
      debugLog("[NO-ENTITLEMENT] Broker deployment fast path failed:", e);
    }
  }

  // If envId not provided, get list of environments to try
  let environmentsToTry: Array<{ id: string; name: string }> = [];
  
  if (envId) {
    environmentsToTry = [{ id: envId, name: "" }];
  } else {
    try {
      const environmentsUrl = `${baseUrl}/accounts/api/organizations/${orgId}/environments`;
      const envsRes = await loggedFetch(environmentsUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (envsRes.ok) {
        const envsData = (await envsRes.json()) as { data?: Array<{ id: string; name: string; type?: string }> };
        const allEnvs = envsData.data || [];
        environmentsToTry = allEnvs.filter((e) => (e.type || "").toLowerCase() !== "design");
        debugLog("[NO-ENTITLEMENT] Found", environmentsToTry.length, "runtime environments to try (excluded Design)");
      } else {
        debugLog("[NO-ENTITLEMENT] Failed to fetch environments:", envsRes.status);
        return null;
      }
    } catch (error) {
      debugLog("[NO-ENTITLEMENT] Error fetching environments:", error);
      return null;
    }
  }

  if (environmentsToTry.length === 0) {
    debugLog("[NO-ENTITLEMENT] No environments to try");
    return null;
  }

  try {
    // Step 1: Try each environment to find deployments containing our taskId
    for (const env of environmentsToTry) {
      try {
        const deploymentsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`;
        const deploymentsRes = await loggedFetch(deploymentsUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!deploymentsRes.ok) {
          continue; // Try next environment
        }

        const deploymentsData = (await deploymentsRes.json()) as { items?: Array<{ id: string; name: string }> };
        const deployments = deploymentsData.items || [];
        debugLog("[NO-ENTITLEMENT] Found", deployments.length, "deployments in environment", env.id);

        // Step 2: For each deployment, get detail (for specId) then logs
        for (const deployment of deployments) {
          let specId: string | null = null;
          try {
            const deploymentDetailUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${deployment.id}`;
            const deploymentDetailRes = await loggedFetch(deploymentDetailUrl, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            });
            if (!deploymentDetailRes.ok) {
              continue;
            }
            const deploymentDetail = (await deploymentDetailRes.json()) as {
              desiredVersion?: string;
              replicas?: Array<{ id: string }>;
            };
            specId = deploymentDetail.desiredVersion ?? deploymentDetail.replicas?.[0]?.id ?? null;
          } catch {
            continue;
          }
          if (!specId) {
            continue;
          }

          try {
            // Fetch logs file for this deployment
            const searchParams = {
              startTime,
              endTime,
              length: 10000,
              descending: true,
            };
            const searchEncoded = encodeURIComponent(JSON.stringify(searchParams));
            const logsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${deployment.id}/specs/${specId}/logs/file?search=${searchEncoded}`;

            const logsRes = await loggedFetch(logsUrl, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            });

            if (!logsRes.ok) {
              continue; // Try next deployment
            }

            const logsText = await logsRes.text();
            
            const parsed = parseRuntimeLogsToEntriesAndJobCard(logsText, taskId);
            if (parsed) {
              debugLog("[NO-ENTITLEMENT] Found taskId in deployment:", deployment.id, "entries:", parsed.entries.length);
              return parsed;
            }
          } catch (error) {
            debugLog("[NO-ENTITLEMENT] Error parsing logs for deployment", deployment.id, ":", error);
            continue; // Try next deployment
          }
        }
      } catch (error) {
        debugLog("[NO-ENTITLEMENT] Error processing environment", env.id, ":", error);
        continue; // Try next environment
      }
    }

    debugLog("[NO-ENTITLEMENT] TaskId not found in any deployment logs");
    return null;
  } catch (error) {
    debugError("[NO-ENTITLEMENT] Error getting task details from runtime logs:", error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  // Authentication check
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  
  const { baseUrl, accessToken } = authResult;
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId");
  const taskId = searchParams.get("taskId");
  // Convert null to undefined for optional parameters (Zod expects undefined, not null)
  const apiInstanceId = searchParams.get("apiInstanceId") || undefined;
  const envId = searchParams.get("envId") || undefined;
  const skipTracesParam = searchParams.get("skipTraces") ?? undefined;

  // Validate query parameters with Zod
  const parseResult = TaskCallstackRequestSchema.safeParse({
    orgId,
    taskId,
    apiInstanceId,
    envId,
    skipTraces: skipTracesParam,
  });
  
  if (!parseResult.success) {
    return validationError(parseResult.error);
  }
  
  const { orgId: validatedOrgId, taskId: validatedTaskId, apiInstanceId: validatedApiInstanceId, envId: validatedEnvId, skipTraces: skipTracesRequested } = parseResult.data;

  const timeRange = 30 * 24 * 3600 * 1000;

  try {
    // Phase 1: search by taskId - filter by orgId first since we search all indices
    const phase1Query = `orgId=${validatedOrgId} AND "${validatedTaskId}"`;
    const phase1 = await msearch(validatedOrgId, phase1Query, { timeRangeMs: timeRange }, accessToken, baseUrl);
    
    // No-entitlement mode: get task details from runtime logs
    if (phase1.error === "MONITORING_CENTER_PREMIUM_REQUIRED") {
      debugLog("[NO-ENTITLEMENT] Premium required, getting task details from runtime logs");
      const runtimeLogsResult = await getTaskDetailsFromRuntimeLogs(
        validatedOrgId,
        validatedTaskId,
        validatedEnvId ?? null,
        accessToken,
        baseUrl,
        timeRange,
        validatedApiInstanceId ?? undefined
      );

      if (runtimeLogsResult) {
        debugLog("[NO-ENTITLEMENT] Task details from runtime logs");
        const jobCardFromRuntime = runtimeLogsResult.jobCard as Record<string, unknown>;
        try {
          const { objectStore, objectStoreApiStatus, monitoringSuggestions } =
            await fetchObjectStoreInNoEntitlementMode(
              validatedOrgId,
              validatedEnvId ?? "",
              validatedTaskId,
              {
                broker: jobCardFromRuntime.broker as string | undefined,
                apiInstanceId: jobCardFromRuntime.apiInstanceId as string | undefined,
                appId: jobCardFromRuntime.appId as string | undefined,
                contextId: jobCardFromRuntime.contextId as string | undefined,
              },
              validatedApiInstanceId ?? undefined,
              accessToken,
              baseUrl
            );
          const noEntitlementApiStatus: ApiStatus = {
            logSearch: "403_entitlement",
            objectStore: objectStoreApiStatus,
            deploymentApi: "ok",
            traceSpans: "skipped",
            monitoringSuggestions,
          };
          return NextResponse.json({
            jobCard: { ...jobCardFromRuntime, objectStore, apiStatus: noEntitlementApiStatus },
            entries: runtimeLogsResult.entries,
            traceSpans: [],
            rawQueries: { phase1: phase1Query, phase2: null, traceId: null },
            mode: "no-entitlement",
          });
        } catch (deploymentError) {
          const msg = deploymentError instanceof Error ? deploymentError.message : "Deployment required but failed";
          debugError("[NO-ENTITLEMENT] Deployment required but failed:", msg);
          return NextResponse.json(
            {
              error: "Deployment is required",
              message: msg,
              code: "DEPLOYMENT_REQUIRED",
            },
            { status: 503 }
          );
        }
      }

      return NextResponse.json(
        {
          error: "Monitoring Center Premium entitlement required",
          message: "Log Search - Advanced package or a Titanium subscription to Anypoint Platform Required - Elasticsearch log search APIs - Enhanced raw storage (up to 128TB based on configuration) - Advanced logs and traces - LLM reasoning logs (for Agent Broker monitoring)",
          code: "MONITORING_CENTER_PREMIUM_REQUIRED",
        },
        { status: 403 }
      );
    }

    // Extract trace_id from any entry with traceparent
    let traceId: string | null = null;
    for (const h of phase1.hits) {
      const hit = h as { _source?: { message?: string } };
      const m = ((hit._source?.message as string) || "").match(/traceparent: 00-([a-f0-9]{32})/);
      if (m) {
        traceId = m[1];
        break;
      }
    }

    // Phase 2: combined search if we found trace_id
    let allHits = phase1.hits;
    let phase2Query: string | null = null;
    if (traceId) {
      phase2Query = `orgId=${validatedOrgId} AND ("${traceId}" OR "${validatedTaskId}")`;
      const phase2 = await msearch(validatedOrgId, phase2Query, { timeRangeMs: timeRange }, accessToken, baseUrl);
      
      // No-entitlement mode: get task details from runtime logs
      if (phase2.error === "MONITORING_CENTER_PREMIUM_REQUIRED") {
        debugLog("[NO-ENTITLEMENT] Premium required in phase2, getting task details from runtime logs");
        const runtimeLogsResult = await getTaskDetailsFromRuntimeLogs(
          validatedOrgId,
          validatedTaskId,
          validatedEnvId ?? null,
          accessToken,
          baseUrl,
          timeRange,
          validatedApiInstanceId ?? undefined
        );

      if (runtimeLogsResult) {
        debugLog("[NO-ENTITLEMENT] Task details from runtime logs");
        const jobCardFromRuntime = runtimeLogsResult.jobCard as Record<string, unknown>;
        try {
          const { objectStore, objectStoreApiStatus, monitoringSuggestions } =
            await fetchObjectStoreInNoEntitlementMode(
              validatedOrgId,
              validatedEnvId ?? "",
              validatedTaskId,
              {
                broker: jobCardFromRuntime.broker as string | undefined,
                apiInstanceId: jobCardFromRuntime.apiInstanceId as string | undefined,
                appId: jobCardFromRuntime.appId as string | undefined,
                contextId: jobCardFromRuntime.contextId as string | undefined,
              },
              validatedApiInstanceId ?? undefined,
              accessToken,
              baseUrl
            );
          const noEntitlementApiStatus: ApiStatus = {
            logSearch: "403_entitlement",
            objectStore: objectStoreApiStatus,
            deploymentApi: "ok",
            traceSpans: "skipped",
            monitoringSuggestions,
          };
          return NextResponse.json({
            jobCard: { ...jobCardFromRuntime, objectStore, apiStatus: noEntitlementApiStatus },
            entries: runtimeLogsResult.entries,
            traceSpans: [],
            rawQueries: { phase1: phase1Query, phase2: phase2Query, traceId },
            mode: "no-entitlement",
          });
        } catch (deploymentError) {
          const msg = deploymentError instanceof Error ? deploymentError.message : "Deployment required but failed";
          debugError("[NO-ENTITLEMENT] Deployment required but failed:", msg);
          return NextResponse.json(
            { error: "Deployment is required", message: msg, code: "DEPLOYMENT_REQUIRED" },
            { status: 503 }
          );
        }
      }

      return NextResponse.json(
        {
          error: "Monitoring Center Premium entitlement required",
          message: "Log Search - Advanced package or a Titanium subscription to Anypoint Platform Required - Elasticsearch log search APIs - Enhanced raw storage (up to 128TB based on configuration) - Advanced logs and traces - LLM reasoning logs (for Agent Broker monitoring)",
          code: "MONITORING_CENTER_PREMIUM_REQUIRED",
        },
        { status: 403 }
      );
      }

      allHits = phase2.hits;
    }

    // Deduplicate by _id
    const seen = new Set<string>();
    const unique: unknown[] = [];
    for (const h of allHits) {
      const hit = h as { _id?: string };
      if (hit._id && !seen.has(hit._id)) {
        seen.add(hit._id);
        unique.push(h);
      }
    }

    // Sort by timestamp (handle numeric string = epoch ms from flex-gateway)
    unique.sort((a: unknown, b: unknown) => {
      const hitA = a as { _source?: { timestamp?: number | string } };
      const hitB = b as { _source?: { timestamp?: number | string } };
      const na = normalizeTimestamp(hitA._source?.timestamp);
      const nb = normalizeTimestamp(hitB._source?.timestamp);
      const ta = typeof na === "number" ? na : new Date(na).getTime();
      const tb = typeof nb === "number" ? nb : new Date(nb).getTime();
      return ta - tb;
    });

    // Classify and parse each entry (normalize timestamp: flex-gateway sends epoch ms as string)
    const entries = unique.map((h: unknown, i: number) => {
      const hit = h as { _source?: { message?: string; logger?: string; timestamp?: string | number; "log-level"?: string; appId?: string; workerId?: string; [key: string]: unknown }; _id?: string; _index?: string };
      const s = hit._source || {};
      const message = (s.message as string) || "";
      const logger = (s.logger as string) || "";
      const type = classifyLog(logger, message);
      const fields = parseFields(message);
      const summary = summarizeLine(type, message, fields);
      const rawTs = s.timestamp as string | number | undefined;
      const timestamp = normalizeTimestamp(rawTs);
      return {
        index: i,
        type,
        summary,
        timestamp: typeof timestamp === "number" ? timestamp : rawTs ?? "",
        logger,
        level: (s["log-level"] as string) || "",
        appId: (s.appId as string) || "",
        workerId: (s.workerId as string) || "",
        fields,
        raw: s,
        _id: hit._id,
        _index: hit._index,
      };
    });

    // Build Job Card from parsed entries
    const inbound = entries.find((e: typeof entries[0]) => e.type === "INBOUND_REQUEST");
    const finalResp = entries.find((e: typeof entries[0]) => e.type === "FINAL_RESPONSE");
    const toolSelections = entries.filter((e: typeof entries[0]) => e.type === "LLM_TOOL_SELECTION");
    const toolExecutions = entries.filter((e: typeof entries[0]) => e.type === "TOOL_EXECUTED");

    const firstEntry = entries[0];
    const lastEntry = entries[entries.length - 1];
    let duration: string | null = null;
    if (firstEntry && lastEntry) {
      const t1 =
        typeof firstEntry.timestamp === "number"
          ? firstEntry.timestamp
          : /^\d+$/.test(String(firstEntry.timestamp))
            ? parseInt(String(firstEntry.timestamp), 10)
            : new Date(firstEntry.timestamp).getTime();
      const t2 =
        typeof lastEntry.timestamp === "number"
          ? lastEntry.timestamp
          : /^\d+$/.test(String(lastEntry.timestamp))
            ? parseInt(String(lastEntry.timestamp), 10)
            : new Date(lastEntry.timestamp).getTime();
      if (!Number.isNaN(t1) && !Number.isNaN(t2)) {
        duration = ((t2 - t1) / 1000).toFixed(1);
      }
    }

    const maxIter = Math.max(0, ...entries.map((e: typeof entries[0]) => parseInt((e.fields.iteration as string) || "0", 10)));
    const toolStrings = toolSelections.map((e: typeof entries[0]) => e.fields.tool as string).filter((t: string | undefined): t is string => typeof t === "string" && Boolean(t));
    const allTools: string[] = Array.from(new Set(toolStrings));

    const brokerName: string = String((entries.find((e: typeof entries[0]) => e.fields.agent) || {}).fields?.agent ?? "");
    const appId = (entries.find((e: typeof entries[0]) => e.appId && !e.appId.startsWith("_")) || {}).appId || "";
    const apiInstanceId = (entries.find((e: typeof entries[0]) => e.fields.apiInstanceId) || {}).fields?.apiInstanceId || "";

    // Extract deployment ID from appId if it's in the format APP_{deploymentId}__...
    // Or try to get it from the appId directly if it's a deployment ID
    let deploymentId: string | null = null;
    if (appId) {
      const appIdMatch = appId.match(/^APP_([a-f0-9-]+)__/);
      if (appIdMatch) {
        deploymentId = appIdMatch[1];
      } else if (/^[a-f0-9-]{36}$/.test(appId)) {
        // appId might be the deployment ID itself
        deploymentId = appId;
      }
    }

    // Track deployment type for better error messages
    let deploymentType: string | undefined;
    
    // Track Application Manager API 403 error for UI display
    let applicationManager403Error: string | null = null;
    /** Deployment API (AMC) status for apiStatus table: not_used | ok | 403_forbidden */
    let deploymentApiStatus: "ok" | "403_forbidden" | "not_used" = "not_used";

    // If we don't have deploymentId yet, try to get it from API instance ID via Runtime Manager API
    if (!deploymentId && apiInstanceId && validatedEnvId) {
      try {
        debugLog(`[ObjectStore] Attempting to get deploymentId from API instance ID: ${apiInstanceId}`);
        const runtimeManagerUrl = `${baseUrl}/apimanager/api/v1/organizations/${validatedOrgId}/environments/${validatedEnvId}/apis/${apiInstanceId}`;
        const rmRes = await loggedFetch(runtimeManagerUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (rmRes.ok) {
          const apiInstanceInfo = (await rmRes.json()) as { 
            deploymentId?: string;
            deployment?: {
              id?: number;
              applicationId?: string;
              type?: string;
            };
            appId?: string;
            metadata?: { source?: string };
          };
          
          // Store deployment type for later use
          deploymentType = apiInstanceInfo.deployment?.type;
          
          // Log deployment type for debugging
          if (deploymentType) {
            debugLog(`[ObjectStore] Deployment type: ${deploymentType}`);
          }
          
          // For Hybrid deployments, Runtime Manager's applicationId is NOT the Object Store deploymentId
          // We need to use Application Manager API to get the correct deploymentId
          // For other deployment types, try Runtime Manager first
          if (deploymentType === "HY") {
            debugLog(`[ObjectStore] Hybrid deployment detected - will use Application Manager API for correct deploymentId`);
            // Fall through to Application Manager API lookup below
          } else if (apiInstanceInfo.deployment?.applicationId) {
            // For non-Hybrid deployments, try Runtime Manager's applicationId first
            deploymentId = apiInstanceInfo.deployment.applicationId;
            debugLog(`[ObjectStore] Found deploymentId from Runtime Manager API deployment.applicationId: ${deploymentId}`);
          } else if (apiInstanceInfo.deploymentId) {
            deploymentId = apiInstanceInfo.deploymentId;
            debugLog(`[ObjectStore] Found deploymentId from Runtime Manager API: ${deploymentId}`);
          } else if (apiInstanceInfo.appId) {
            // Try to extract from appId if it's in the format APP_{deploymentId}__...
            const appIdMatch = apiInstanceInfo.appId.match(/^APP_([a-f0-9-]+)__/);
            if (appIdMatch) {
              deploymentId = appIdMatch[1];
              debugLog(`[ObjectStore] Extracted deploymentId from Runtime Manager appId: ${deploymentId}`);
            }
          }
          
          // If we still don't have deploymentId (or it's Hybrid), try Application Manager API
          // Use appId from logs if available, otherwise try metadata.source
          if (!deploymentId && appId) {
            debugLog(`[ObjectStore] Looking up deployment by app name in Application Manager API: ${appId}`);
            const deploymentsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${validatedOrgId}/environments/${validatedEnvId}/deployments?name=${encodeURIComponent(appId)}`;
            const deploymentsRes = await loggedFetch(deploymentsUrl, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            });
            
            if (deploymentsRes.ok) {
              const deploymentsData = (await deploymentsRes.json()) as { items?: Array<{ id: string; name: string }> };
              const matchingDeployment = deploymentsData.items?.find((d: { name: string }) => d.name === appId);
              if (matchingDeployment) {
                deploymentId = matchingDeployment.id;
                debugLog(`[ObjectStore] Found deploymentId from Application Manager API by app name: ${deploymentId}`);
              } else {
                debugLog(`[ObjectStore] No deployment found with name: ${appId}`);
              }
            } else if (deploymentsRes.status === 403) {
              deploymentApiStatus = "403_forbidden";
              // Capture full error response - API might tell us what scope is needed
              const errorText = await deploymentsRes.text().catch(() => "");
              let errorJson: { message?: string; error?: string; scope?: string } = {};
              try {
                errorJson = JSON.parse(errorText);
              } catch {
                // Not JSON, use raw text
              }
              
              const apiErrorMessage = errorJson.message || errorJson.error || errorText || "No error details provided";
              const { getOAuthConfig } = await import("@/lib/auth/config");
              const currentScopes = getOAuthConfig().scopes;
              const errorMsg = buildAmc403Message(apiErrorMessage, currentScopes);
              debugError(`[ObjectStore] ${errorMsg}`);
              applicationManager403Error = errorMsg;
            } else {
              if (deploymentsRes.ok) deploymentApiStatus = "ok";
              debugLog(`[ObjectStore] Application Manager API returned status ${deploymentsRes.status}`);
            }
          } else if (!deploymentId && apiInstanceInfo.metadata?.source) {
            // Extract app name from metadata.source format: urn:gav:{orgId}:{appName}:{version}
            // Example: "urn:gav:eca25329-9592-4ff1-9054-1b08d103b991:maf-unite-the-hyperscalers:1.0.1"
            const sourceParts = apiInstanceInfo.metadata.source.split(":");
            if (sourceParts.length >= 4) {
              const appName = sourceParts[3]; // 4th segment is the app name
              debugLog(`[ObjectStore] Extracted app name from metadata.source: ${appName}`);
              
              // Now search deployments by name to find the deploymentId
              const deploymentsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${validatedOrgId}/environments/${validatedEnvId}/deployments?name=${encodeURIComponent(appName)}`;
              const deploymentsRes = await loggedFetch(deploymentsUrl, {
                method: "GET",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                },
              });
              
              if (deploymentsRes.ok) {
                const deploymentsData = (await deploymentsRes.json()) as { items?: Array<{ id: string; name: string }> };
                const matchingDeployment = deploymentsData.items?.find((d: { name: string }) => d.name === appName);
                if (matchingDeployment) {
                  deploymentId = matchingDeployment.id;
                  debugLog(`[ObjectStore] Found deploymentId from Application Manager API by app name: ${deploymentId}`);
                } else {
                  debugLog(`[ObjectStore] No deployment found with name: ${appName}`);
                }
              } else if (deploymentsRes.status === 403) {
                deploymentApiStatus = "403_forbidden";
                // Capture full error response - API might tell us what scope is needed
                const errorText = await deploymentsRes.text().catch(() => "");
                let errorJson: { message?: string; error?: string; scope?: string } = {};
                try {
                  errorJson = JSON.parse(errorText);
                } catch {
                  // Not JSON, use raw text
                }
                
                const apiErrorMessage = errorJson.message || errorJson.error || errorText || "No error details provided";
                const { getOAuthConfig } = await import("@/lib/auth/config");
                const currentScopes = getOAuthConfig().scopes;
                const errorMsg = buildAmc403Message(apiErrorMessage, currentScopes);
                debugError(`[ObjectStore] ${errorMsg}`);
                applicationManager403Error = errorMsg;
              } else {
                if (deploymentsRes.ok) deploymentApiStatus = "ok";
                debugLog(`[ObjectStore] Application Manager API returned status ${deploymentsRes.status}`);
              }
            }
          }
        } else {
          debugLog(`[ObjectStore] Runtime Manager API returned status ${rmRes.status} for API instance ${apiInstanceId}`);
        }
      } catch (error) {
        debugLog(`[ObjectStore] Error fetching deploymentId from Runtime Manager API:`, error);
        // Continue without deploymentId
      }
    }
    
    // If we still don't have deploymentId but have appId from logs, try Application Manager API directly
    if (!deploymentId && appId && validatedEnvId) {
      try {
        debugLog(`[ObjectStore] Attempting to get deploymentId from Application Manager API using appId: ${appId}`);
        const deploymentsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${validatedOrgId}/environments/${validatedEnvId}/deployments?name=${encodeURIComponent(appId)}`;
        const deploymentsRes = await loggedFetch(deploymentsUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        });
        
              if (deploymentsRes.ok) {
                const deploymentsData = (await deploymentsRes.json()) as { items?: Array<{ id: string; name: string; applicationId?: string | null }> };
                const matchingDeployment = deploymentsData.items?.find((d: { name: string }) => d.name === appId);
                if (matchingDeployment) {
                  deploymentId = matchingDeployment.id;
                  debugLog(`[ObjectStore] Found deploymentId from Application Manager API by app name: ${deploymentId}`);
                  // Also get deployment type if available
                  if (matchingDeployment.applicationId === null && !deploymentType) {
                    // If applicationId is null, it's likely a Hybrid deployment
                    deploymentType = "HY";
                  }
                } else {
                  debugLog(`[ObjectStore] No deployment found with name: ${appId}`);
                }
              } else if (deploymentsRes.status === 403) {
                deploymentApiStatus = "403_forbidden";
                // Capture full error response - API might tell us what scope is needed
                const errorText = await deploymentsRes.text().catch(() => "");
                let errorJson: { message?: string; error?: string; scope?: string } = {};
                try {
                  errorJson = JSON.parse(errorText);
                } catch {
                  // Not JSON, use raw text
                }
                
                const apiErrorMessage = errorJson.message || errorJson.error || errorText || "No error details provided";
                const currentScopes = getOAuthConfig().scopes;
                const errorMsg = buildAmc403Message(apiErrorMessage, currentScopes);
                debugError(`[ObjectStore] ${errorMsg}`);
                applicationManager403Error = errorMsg;
              } else {
                debugLog(`[ObjectStore] Application Manager API returned status ${deploymentsRes.status}`);
              }
      } catch (error) {
        debugLog(`[ObjectStore] Error fetching deploymentId from Application Manager API:`, error);
        // Continue without deploymentId
      }
    }

    // OPTIMIZATION: Fetch Object Store and trace spans in parallel since they're independent
    // Fetch Object Store data if we have envId and deployment ID (brokerName can be empty - we'll still get no_store/403/no_keys from client)
    let objectStoreData: {
      available: boolean;
      objectStoreStatus?: "ok" | "403_forbidden" | "no_store" | "no_keys";
      sourcesUsed?: ("tasks" | "conversations")[];
      fromTasks?: { steps: Array<{ step: string; content: string[] }>; rawReasoning: string[] };
      fromConversations?: { steps: Array<{ step: string; content: string[] }>; rawReasoning: string[] };
      llmReasoning?: {
        steps?: Array<{ step: string; content: string[] }>;
        rawReasoning?: string[];
      };
      toolCallIds?: string[];
      downstreamContextIds?: Array<{ agent: string; contextId: string; taskId: string }>;
      errors?: string[];
    } = { available: false };

    // Prepare Object Store fetch promise (returns result + optional monitoring from same deployment GET, no extra call)
    const objectStorePromise = (async (): Promise<{
      result: typeof objectStoreData;
      monitoringSuggestions?: ApiStatus["monitoringSuggestions"];
    }> => {
      if (validatedEnvId && deploymentId && accessToken) {
        let objectStoreRegion: string | undefined;
        let monitoringSuggestions: ApiStatus["monitoringSuggestions"];
        try {
          const deploymentDetail = await fetchDeploymentDetail(
            validatedOrgId,
            validatedEnvId,
            deploymentId,
            accessToken,
            baseUrl,
            { deploymentType }
          );
          objectStoreRegion = deploymentDetail.region;
          monitoringSuggestions = deploymentDetail.monitoringSuggestions;
          if (deploymentDetail.deploymentApiStatus) deploymentApiStatus = deploymentDetail.deploymentApiStatus;
          if (objectStoreRegion) debugLog(`[ObjectStore] Resolved region from deployment URLs: ${objectStoreRegion}`);
          const contextIdForStore = (entries.find((e: typeof entries[0]) => e.fields?.contextId) as typeof entries[0] | undefined)?.fields?.contextId as string | undefined;
          debugLog(`[ObjectStore] Attempting to fetch Object Store data - orgId: ${validatedOrgId}, envId: ${validatedEnvId}, taskId: ${validatedTaskId}, brokerName: ${brokerName}, deploymentId: ${deploymentId}, appId: ${appId}, deploymentType: ${deploymentType || "unknown"}, objectStoreRegion: ${objectStoreRegion ?? "(none)"}, contextId: ${contextIdForStore ?? "(none)"}`);
          const result = await fetchObjectStoreData(
            validatedOrgId,
            validatedEnvId,
            validatedTaskId,
            brokerName,
            deploymentId,
            accessToken,
            deploymentType,
            objectStoreRegion,
            contextIdForStore
          );
          if (result.available) {
            debugLog("[ObjectStore] Successfully fetched Object Store data");
          } else {
            const has403 = result.errors?.some((e: string) => e.includes("403"));
            if (has403) {
              debugError(`[ObjectStore] 403 Forbidden error detected - errors: ${JSON.stringify(result.errors)}`);
            } else {
              debugLog(`[ObjectStore] Object Store data not available - errors: ${JSON.stringify(result.errors)}`);
            }
          }
          return { result, monitoringSuggestions };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          // Deployment fetch is required; if it failed, fail the whole request (no partial success).
          if (
            errorMessage.includes("Deployment detail required") ||
            errorMessage.includes("Deployment is required")
          ) {
            throw error;
          }
          const is403 = errorMessage.includes("403");
          if (is403) {
            debugError(`[ObjectStore] 403 Forbidden error during fetch: ${errorMessage}`);
          } else {
            debugError(`[ObjectStore] Error fetching Object Store data: ${errorMessage}`);
          }
          return {
            result: {
              available: false,
              objectStoreStatus: (is403 ? "403_forbidden" : undefined) as "403_forbidden" | undefined,
              errors: [errorMessage],
            },
          };
        }
      } else {
        const skipReason = !validatedEnvId ? "missing envId" : !deploymentId ? "missing deploymentId" : !accessToken ? "missing accessToken" : "unknown";
        debugLog(
          `[ObjectStore] Skipping Object Store fetch - reason: ${skipReason}, envId: ${validatedEnvId ? validatedEnvId : "none"}, brokerName: ${brokerName || "none"}, deploymentId: ${deploymentId || "none"}, appId: ${appId || "none"}, apiInstanceId: ${apiInstanceId || "none"}`
        );
        const result: {
          available: boolean;
          objectStoreStatus?: "ok" | "403_forbidden" | "no_store" | "no_keys";
          errors?: string[];
        } = { available: false };
        if (!deploymentId) {
          result.errors = [];
          if (applicationManager403Error) {
            result.errors.push(applicationManager403Error);
          } else {
            result.errors.push(`Cannot fetch Object Store: ${skipReason}. appId="${appId}", apiInstanceId="${apiInstanceId}"`);
          }
        }
        return { result };
      }
    })();

    // Prepare trace spans fetch promise
    const traceSpansPromise = (async (): Promise<{ spans: TraceSpanRow[]; status: TraceSpansStatus }> => {
      if (!skipTracesRequested && traceId && validatedEnvId && validatedEnvId.trim() !== "" && accessToken) {
        return await fetchTraceSpans(
          validatedOrgId,
          traceId,
          accessToken,
          baseUrl,
          validatedEnvId,
          firstEntry?.timestamp,
          lastEntry?.timestamp
        );
      }
      return { spans: [], status: "skipped" };
    })();

    // Execute both fetches in parallel
    const [objectStorePayload, traceSpansResult] = await Promise.all([objectStorePromise, traceSpansPromise]);
    objectStoreData = objectStorePayload.result;
    const traceSpans = traceSpansResult.spans;
    const traceSpansStatus = traceSpansResult.status;

    // API status summary for task details (support / "app not working" diagnosis)
    const objectStoreStatus: ApiStatus["objectStore"] =
      objectStoreData.objectStoreStatus ??
      (objectStoreData.available
        ? "ok"
        : objectStoreData.errors?.some((e: string) => e.includes("403"))
          ? "403_forbidden"
          : objectStoreData.errors?.some(
                (e: string) =>
                  e.includes("Object Store not found") || e.includes("not found for deployment")
              )
            ? "no_store"
            : objectStoreData.errors?.some(
                  (e: string) =>
                    e.includes("Task value not found") ||
                    e.includes("Partition not found") ||
                    e.includes("No key found")
                )
              ? "no_keys"
              : objectStoreData.errors?.length
                ? "error"
                : "skipped");
    // Use only deployment/config-based suggestions for "Set" so we don't show "Set" when
    // the app merely emits logs with those logger/class names (e.g. INSECURE-LOGGING, broker Loop).
    const monitoringSuggestions: ApiStatus["monitoringSuggestions"] = {
      brokerLogger: objectStorePayload.monitoringSuggestions?.brokerLogger === true,
      insecureLogging: objectStorePayload.monitoringSuggestions?.insecureLogging === true,
    };
    const apiStatus: ApiStatus = {
      logSearch: "ok",
      objectStore: objectStoreStatus,
      deploymentApi: deploymentApiStatus,
      traceSpans: traceSpansStatus,
      monitoringSuggestions,
    };

    const jobCard = {
      taskId,
      contextId: (entries.find((e: typeof entries[0]) => e.fields.contextId) || {}).fields?.contextId || "",
      traceId: traceId || "",
      broker: brokerName,
      apiInstanceId: (entries.find((e: typeof entries[0]) => e.fields.apiInstanceId) || {}).fields?.apiInstanceId || "",
      userMessage: inbound ? ((inbound.fields.userMessage as string) || "") : "",
      messageId: inbound ? ((inbound.fields.messageId as string) || "") : "",
      outcome: finalResp
        ? ((finalResp.fields.resultStatus as string) || "completed")
        : toolExecutions.length > 0
          ? "completed"
          : "",
      startTime: firstEntry ? firstEntry.timestamp : "",
      endTime: lastEntry ? lastEntry.timestamp : "",
      duration,
      iterations: maxIter,
      toolsUsed: allTools.map((t: string) => t.replace(/^[a-zA-Z0-9]+_/, "")),
      totalEntries: entries.length,
      appId,
      objectStore: objectStoreData,
      apiStatus,
    };

    return NextResponse.json({
      jobCard,
      entries,
      traceSpans,
      rawQueries: { phase1: phase1Query, phase2: phase2Query, traceId },
    });
  } catch (error) {
    debugError("Task callstack API error:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch task call stack";
    const isDeploymentRequired =
      message.includes("Deployment detail required") || message.includes("Deployment is required");
    return NextResponse.json(
      {
        error: isDeploymentRequired ? "Deployment is required" : "Failed to fetch task call stack",
        message,
        ...(isDeploymentRequired ? { code: "DEPLOYMENT_REQUIRED" as const } : {}),
      },
      { status: isDeploymentRequired ? 503 : 500 }
    );
  }
}
