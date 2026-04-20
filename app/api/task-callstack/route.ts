import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError, debugLog } from "@/lib/api-logger";
import { TaskCallstackRequestSchema } from "@/lib/schemas";
import { fetchObjectStoreData, getObjectStoreRegionFromDeployment, getMonitoringLogCategoriesFromDeployment } from "@/lib/object-store/client";
import { getOAuthConfig, AMC_COMMON_SCOPES_TO_TRY } from "@/lib/auth/config";
import type { ApiStatus } from "@/components/task-details/types";
import { requireAuth } from "@/lib/api/auth-middleware";
import { msearch } from "@/lib/api/msearch";
import { validationError } from "@/lib/api/error-responses";
import { resolveDeploymentContext, type TaskCallstackState } from "@/lib/deployment-context/resolvers";

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
} | null> {
  debugLog("[fetchDeploymentDetailViaHybrid] ========== START ==========");
  debugLog(`[fetchDeploymentDetailViaHybrid] Input parameters:`);
  debugLog(`[fetchDeploymentDetailViaHybrid]   - orgId: ${orgId}`);
  debugLog(`[fetchDeploymentDetailViaHybrid]   - envId: ${envId}`);
  debugLog(`[fetchDeploymentDetailViaHybrid]   - applicationId: ${applicationId}`);
  debugLog(`[fetchDeploymentDetailViaHybrid]   - baseUrl: ${baseUrl}`);
  
  const url = `${baseUrl}/hybrid/api/v1/applications`;
  debugLog(`[fetchDeploymentDetailViaHybrid] Calling Hybrid API: ${url}`);
  debugLog(`[fetchDeploymentDetailViaHybrid] Headers: X-ANYPNT-ORG-ID=${orgId}, X-ANYPNT-ENV-ID=${envId}`);
  const res = await loggedFetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-ANYPNT-ORG-ID": orgId,
      "X-ANYPNT-ENV-ID": envId,
    },
  });
  debugLog(`[fetchDeploymentDetailViaHybrid] Hybrid API response: status=${res.status}, ok=${res.ok}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    debugLog(`[fetchDeploymentDetailViaHybrid] Hybrid API error: ${text.slice(0, 200)}`);
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
  debugLog(`[fetchDeploymentDetailViaHybrid] Hybrid API returned ${list.length} applications`);
  debugLog(`[fetchDeploymentDetailViaHybrid] Searching for applicationId: ${applicationId}`);
  const app = list.find(
    (item: Record<string, unknown>) =>
      String(item.id ?? item.applicationId ?? "").toLowerCase() === applicationId.toLowerCase() ||
      (item as { applicationId?: string }).applicationId === applicationId
  ) as Record<string, unknown> | undefined;
  if (!app) {
    debugLog(`[fetchDeploymentDetailViaHybrid] ✗ No application found for applicationId: ${applicationId}, list length: ${list.length}`);
    debugLog(`[fetchDeploymentDetailViaHybrid] Available application IDs: ${list.map((item: Record<string, unknown>) => item.id ?? item.applicationId ?? "unknown").join(", ")}`);
    debugLog(`[fetchDeploymentDetailViaHybrid] Decision: Hybrid API returned empty, this might be a CloudHub deployment misclassified as HY`);
    debugLog(`[fetchDeploymentDetailViaHybrid] Returning null to trigger AMC API fallback`);
    debugLog("[fetchDeploymentDetailViaHybrid] ========== END (NOT FOUND - WILL FALLBACK) ==========");
    return null;
  }
  debugLog(`[fetchDeploymentDetailViaHybrid] ✓ Found application: id=${app.id ?? "undefined"}, applicationId=${(app as { applicationId?: string }).applicationId ?? "undefined"}`);
  debugLog(`[fetchDeploymentDetailViaHybrid] Note: Hybrid deployments do not have CloudHub URLs, so region will be undefined`);
  debugLog(`[fetchDeploymentDetailViaHybrid] Calling getMonitoringLogCategoriesFromDeployment with Hybrid application object...`);
  const monitoringSuggestions = getMonitoringLogCategoriesFromDeployment(app);
  debugLog(`[fetchDeploymentDetailViaHybrid] getMonitoringLogCategoriesFromDeployment returned: brokerLogger=${monitoringSuggestions.brokerLogger}, insecureLogging=${monitoringSuggestions.insecureLogging}`);
  debugLog("[fetchDeploymentDetailViaHybrid] ========== END (SUCCESS) ==========");
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
  options?: { deploymentType?: DeploymentTypeHint; appNameFromMetadata?: string }
): Promise<{
  region?: string;
  monitoringSuggestions: ApiStatus["monitoringSuggestions"];
  deploymentApiStatus: "ok" | "403_forbidden";
}> {
  debugLog("[fetchDeploymentDetail] ========== START ==========");
  debugLog(`[fetchDeploymentDetail] Input parameters:`);
  debugLog(`[fetchDeploymentDetail]   - orgId: ${orgId}`);
  debugLog(`[fetchDeploymentDetail]   - envId: ${envId}`);
  debugLog(`[fetchDeploymentDetail]   - deploymentId: ${deploymentId}`);
  debugLog(`[fetchDeploymentDetail]   - baseUrl: ${baseUrl}`);
  debugLog(`[fetchDeploymentDetail]   - deploymentType: ${options?.deploymentType ?? "undefined"}`);
  
  const deploymentType = options?.deploymentType;

  if (deploymentType === "HY") {
    debugLog(`[fetchDeploymentDetail] Decision: deploymentType is HY, trying Hybrid API first`);
    debugLog(`[fetchDeploymentDetail] Calling fetchDeploymentDetailViaHybrid...`);
    const hybridResult = await fetchDeploymentDetailViaHybrid(orgId, envId, deploymentId, accessToken, baseUrl);
    
    // If Hybrid API returns null (application not found), fallback to AMC API
    // This handles cases where deployment is misclassified as HY but is actually CloudHub
    if (hybridResult === null) {
      debugLog(`[fetchDeploymentDetail] Decision: Hybrid API returned null (application not found), falling back to AMC API`);
      debugLog(`[fetchDeploymentDetail] This deployment might be CloudHub (MC) misclassified as Hybrid`);
      // Fall through to AMC API below
    } else {
      debugLog(`[fetchDeploymentDetail] Hybrid API found application: region=${hybridResult.region ?? "undefined"}, deploymentApiStatus=${hybridResult.deploymentApiStatus}`);
      debugLog("[fetchDeploymentDetail] ========== END (HYBRID) ==========");
      return hybridResult;
    }
  }
  
  debugLog(`[fetchDeploymentDetail] Decision: deploymentType is not HY (or undefined), using AMC API`);

  const url = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}`;
  debugLog(`[fetchDeploymentDetail] Calling AMC API: ${url}`);
  const res = await loggedFetch(url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
  debugLog(`[fetchDeploymentDetail] AMC API response: status=${res.status}, ok=${res.ok}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    debugLog(`[fetchDeploymentDetail] AMC API error response: ${text.slice(0, 200)}`);
    const is400RR =
      res.status === 400 &&
      (text.includes("ProviderType.RR") || text.includes("No enum constant"));
    if (is400RR) {
      debugLog(`[fetchDeploymentDetail] Decision: 400 with RR/Hybrid error, falling back to Hybrid API`);
      const result = await fetchDeploymentDetailViaHybrid(orgId, envId, deploymentId, accessToken, baseUrl);
      if (result === null && options?.appNameFromMetadata) {
        debugLog(`[fetchDeploymentDetail] Hybrid returned null; trying AMC list by app name then GET by id: name=${options.appNameFromMetadata}`);
        const listUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments?name=${encodeURIComponent(options.appNameFromMetadata)}`;
        const listRes = await loggedFetch(listUrl, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
        if (listRes.ok) {
          const listData = (await listRes.json()) as { items?: Array<{ id: string; name: string }> };
          const items = listData.items ?? [];
          const match = items.find((d: { name: string }) => d.name === options!.appNameFromMetadata);
          if (match) {
            debugLog(`[fetchDeploymentDetail] AMC list by name found deployment id=${match.id}, fetching full detail for region and monitoringSuggestions`);
            const getUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${match.id}`;
            const getRes = await loggedFetch(getUrl, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
            if (getRes.ok) {
              const deployment = (await getRes.json()) as Record<string, unknown>;
              const region = getObjectStoreRegionFromDeployment(deployment as Parameters<typeof getObjectStoreRegionFromDeployment>[0]) ?? undefined;
              const monitoringSuggestions = getMonitoringLogCategoriesFromDeployment(deployment);
              debugLog(`[fetchDeploymentDetail] AMC GET by id (from name): region=${region ?? "undefined"}, brokerLogger=${monitoringSuggestions.brokerLogger}, insecureLogging=${monitoringSuggestions.insecureLogging}`);
              return { region, monitoringSuggestions, deploymentApiStatus: "ok" as const };
            }
          }
        }
      }
      if (result === null) {
        debugLog(`[fetchDeploymentDetail] Hybrid API fallback returned null; returning safe object (region undefined) so caller does not read .region on null`);
        return { region: undefined, monitoringSuggestions: { brokerLogger: false, insecureLogging: false }, deploymentApiStatus: "ok" as const };
      }
      debugLog(`[fetchDeploymentDetail] Hybrid API fallback returned: region=${result.region ?? "undefined"}`);
      debugLog("[fetchDeploymentDetail] ========== END (HYBRID FALLBACK) ==========");
      return result;
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
  debugLog(`[fetchDeploymentDetail] AMC API succeeded, parsing response...`);
  const deployment = (await res.json()) as Record<string, unknown>;
  const dep = deployment as { id?: string; name?: string; application?: { configuration?: Record<string, unknown> } };
  debugLog(`[KEY_FACTS] AMC GET deployment: id=${dep.id ?? "undefined"}, name=${dep.name ?? "undefined"}`);
  const loggingConfig = dep.application?.configuration?.["mule.agent.logging.service"];
  debugLog(`[KEY_FACTS] AMC GET deployment: application.configuration["mule.agent.logging.service"]=${loggingConfig ? JSON.stringify(loggingConfig) : "undefined"}`);
  debugLog(`[fetchDeploymentDetail] Deployment JSON keys: ${Object.keys(deployment).join(", ")}`);
  debugLog(`[fetchDeploymentDetail] Deployment structure check:`);
  debugLog(`[fetchDeploymentDetail]   - has target: ${!!(deployment as { target?: unknown }).target}`);
  debugLog(`[fetchDeploymentDetail]   - has target.deploymentSettings: ${!!((deployment as { target?: { deploymentSettings?: unknown } }).target?.deploymentSettings)}`);
  debugLog(`[fetchDeploymentDetail]   - has target.deploymentSettings.http: ${!!((deployment as { target?: { deploymentSettings?: { http?: unknown } } }).target?.deploymentSettings?.http)}`);
  debugLog(`[fetchDeploymentDetail]   - has target.deploymentSettings.http.inbound: ${!!((deployment as { target?: { deploymentSettings?: { http?: { inbound?: unknown } } } }).target?.deploymentSettings?.http?.inbound)}`);
  const inbound = ((deployment as { target?: { deploymentSettings?: { http?: { inbound?: { internalUrl?: string; endpoints?: Array<{ url?: string }> } } } } }).target?.deploymentSettings?.http?.inbound);
  debugLog(`[fetchDeploymentDetail]   - inbound.internalUrl: ${inbound?.internalUrl ?? "undefined"}`);
  debugLog(`[fetchDeploymentDetail]   - inbound.endpoints: ${inbound?.endpoints ? `${inbound.endpoints.length} items` : "undefined"}`);
  
  debugLog(`[fetchDeploymentDetail] Calling getObjectStoreRegionFromDeployment...`);
  const region = getObjectStoreRegionFromDeployment(
    deployment as Parameters<typeof getObjectStoreRegionFromDeployment>[0]
  ) ?? undefined;
  if (region) {
    debugLog(`[fetchDeploymentDetail] ✓ Region detection successful: ${region}`);
  } else {
    debugLog(`[fetchDeploymentDetail] ✗ Region detection failed (returned null/undefined)`);
  }
  debugLog(`[fetchDeploymentDetail] Calling getMonitoringLogCategoriesFromDeployment with AMC deployment object...`);
  const monitoringSuggestions = getMonitoringLogCategoriesFromDeployment(deployment);
  debugLog(`[fetchDeploymentDetail] getMonitoringLogCategoriesFromDeployment returned: brokerLogger=${monitoringSuggestions.brokerLogger}, insecureLogging=${monitoringSuggestions.insecureLogging}`);
  debugLog("[fetchDeploymentDetail] ========== END (AMC) ==========");
  return { region, monitoringSuggestions, deploymentApiStatus: "ok" };
}


function classifyLog(logger: string, message: string): string {
  if (logger === "http-listener-config") {
    if (/^LISTENER\s*\n.*POST\s+\//m.test(message) || message.startsWith("LISTENER\nPOST"))
      return "INBOUND_REQUEST";
    if (message.includes("HTTP/1.1 200") || message.includes("HTTP/1.1 2"))
      return "FINAL_RESPONSE";
  }
  if (logger === "Loop" || !logger) {
    if (message.includes("LLM selected tool")) return "LLM_TOOL_SELECTION";
    if (message.includes("Executed tool")) return "TOOL_EXECUTED";
    if (message.includes("No tool selected")) return "LLM_NO_TOOL";
  }
  if (logger === "INSECURE-LOGGING" || !logger) {
    if (/(?:^|\s)Tool Input:/m.test(message)) return "TOOL_INPUT";
    if (/(?:^|\s)Sending A2A/m.test(message)) return "A2A_MESSAGE_SENT";
    if (/(?:^|\s)Output was:/m.test(message)) return "TOOL_OUTPUT";
  }
  if (logger.includes("a2a-http-client") || (!logger && /REQUESTER\s*\n/m.test(message))) {
    if (message.includes("agent-card.json")) return "AGENT_DISCOVERY";
    if (/REQUESTER\s*\nPOST\s+\//m.test(message)) return "DOWNSTREAM_REQUEST";
    if (/REQUESTER\s*\nHTTP\/1\.1\s+\d/m.test(message)) return "DOWNSTREAM_RESPONSE";
    return "HTTP_CHUNK";
  }
  if (!logger) {
    if (/^LISTENER\s*\n.*POST\s+\//m.test(message) || message.startsWith("LISTENER\nPOST"))
      return "INBOUND_REQUEST";
    if (message.includes("HTTP/1.1 200") || message.includes("HTTP/1.1 2"))
      return "FINAL_RESPONSE";
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
        ? `Input: ${JSON.stringify(fields.toolInputJson).slice(0, 200)}${JSON.stringify(fields.toolInputJson).length > 200 ? "..." : ""}`
        : "Tool input";
    case "A2A_MESSAGE_SENT": {
      const agentMatch = message.match(/to agent (\S+)/);
      const agentName = agentMatch ? agentMatch[1].replace(/^[a-zA-Z0-9]+_/, "") : "?";
      // Extract message content after "to agent X:" - look for JSON or text content
      const afterAgent = message.split(/to agent \S+/i)[1] || "";
      // Try to find JSON in the message (common in A2A messages)
      const jsonMatch = afterAgent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const jsonStr = JSON.stringify(parsed);
          return `A2A message to ${agentName}: ${jsonStr.slice(0, 200)}${jsonStr.length > 200 ? "..." : ""}`;
        } catch {
          // Not valid JSON, use raw text
        }
      }
      // Fallback: show text content after agent name
      const textPreview = afterAgent.trim().slice(0, 200);
      return `A2A message to ${agentName}${textPreview ? `: ${textPreview}${afterAgent.trim().length > 200 ? "..." : ""}` : ""}`;
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
        ? `Output: ${JSON.stringify(fields.toolOutputJson).slice(0, 200)}${JSON.stringify(fields.toolOutputJson).length > 200 ? "..." : ""}`
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
      // For INSECURE-LOGGING entries that don't match specific patterns, preserve logger name in summary
      const defaultSummary = message.split("\n")[0].slice(0, 200);
      return defaultSummary;
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
  traceEndTime?: string | number,
  entityName?: string
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

    // Build WHERE clause: always filter by orgId, envId, traceId, and time range
    // Optionally filter by entityName (appId) if provided to restrict to broker app spans
    let whereClause = `"sub_org.id" = '${orgId}' AND "env.id" = '${envId}' AND "trace_id" = '${traceId}' AND timestamp BETWEEN ${startTimeMs} AND ${endTimeMs}`;
    if (entityName && entityName.trim() !== "") {
      whereClause += ` AND "entity.name" = '${entityName.trim()}'`;
      debugLog(`[fetchTraceSpans] Filtering by entityName (appId): ${entityName}`);
    }
    
    const query = `SELECT "span_id" AS spanId, name, kind, "trace_id" AS traceId, "status_code" AS statusCode, "http.status_code" AS httpStatusCode, duration, "end_time_nano" AS endTime, "entity.id" AS entityId, "entity.name" AS entityName, "entity.type" AS entityType, "env.id" AS envId, "sub_org.id" AS orgId, "sub_org.name" AS orgName, "env.name" AS envName WHERE ${whereClause} ORDER BY timestamp ASC LIMIT 500`;

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
    debugLog(`[fetchTraceSpans] Fetched ${spans.length} spans${entityName ? ` (filtered by entityName: ${entityName})` : ""}`);
    return { spans, status: "ok" };
  } catch (err) {
    debugLog("[fetchTraceSpans] error:", err);
    return { spans: [], status: "error" };
  }
}

/**

 * Search for traceId by correlationId in Observability API.
 * Returns the first traceId found, or null if none.
 */
async function searchTraceIdByCorrelationId(
  orgId: string,
  envId: string,
  correlationId: string,
  accessToken: string,
  baseUrl: string,
  startTime?: string | number,
  endTime?: string | number
): Promise<string | null> {
  if (!correlationId || correlationId.trim() === "" || !orgId || !envId || envId.trim() === "") {
    return null;
  }

  try {
    let startTimeMs: number;
    let endTimeMs: number;
    if (startTime != null && endTime != null) {
      const start = typeof startTime === "number" ? startTime : new Date(startTime).getTime();
      const end = typeof endTime === "number" ? endTime : new Date(endTime).getTime();
      const padding = 30 * 60 * 1000; // 30 minutes
      startTimeMs = Math.max(0, start - padding);
      endTimeMs = end + padding;
    } else {
      const now = Date.now();
      startTimeMs = now - 30 * 24 * 3600 * 1000; // 30 days
      endTimeMs = now;
    }

    // Search for traces by correlationId
    const whereClause = `"sub_org.id" = '${orgId}' AND "env.id" = '${envId}' AND "correlation.id" = '${correlationId.trim()}' AND timestamp BETWEEN ${startTimeMs} AND ${endTimeMs}`;
    const query = `SELECT "trace_id" AS traceId WHERE ${whereClause} ORDER BY timestamp ASC LIMIT 1`;
    
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
      debugLog(`[searchTraceIdByCorrelationId] spans:search failed: ${res.status}`);
        return null;
      }

    const data = (await res.json()) as { data?: Array<{ traceId?: string }> };
    const spans = data.data ?? [];
    if (spans.length > 0 && spans[0].traceId) {
      const foundTraceId = spans[0].traceId;
      debugLog(`[searchTraceIdByCorrelationId] ✓ Found traceId: ${foundTraceId} for correlationId: ${correlationId}`);
      return foundTraceId;
    }
    
    debugLog(`[searchTraceIdByCorrelationId] ✗ No traceId found for correlationId: ${correlationId}`);
    return null;
  } catch (err) {
    debugLog(`[searchTraceIdByCorrelationId] error:`, err);
      return null;
    }
  }

/**
 * Search for trace spans by entity.name (broker app), envId, and time period.
 * Then scope to the ONE trace that matches this task's time window (so we don't mix multiple broker calls).
 */
async function searchTracesByEntityAndTime(
  orgId: string,
  envId: string,
  entityName: string,
  accessToken: string,
  baseUrl: string,
  startTime: string | number,
  endTime: string | number,
  /** Task's exact time window (ms) - we pick the trace that overlaps this the most */
  taskStartMs: number,
  taskEndMs: number
): Promise<{ spans: TraceSpanRow[]; status: TraceSpansStatus; traceId: string | null }> {
  if (!entityName || entityName.trim() === "" || !orgId || !envId || envId.trim() === "") {
    return { spans: [], status: "skipped", traceId: null };
  }

  try {
    const start = typeof startTime === "number" ? startTime : new Date(startTime).getTime();
    const end = typeof endTime === "number" ? endTime : new Date(endTime).getTime();
    const padding = 30 * 60 * 1000; // 30 minutes
    const startTimeMs = Math.max(0, start - padding);
    const endTimeMs = end + padding;

    // Search for traces by entity.name (broker app), envId, and time period
    const whereClause = `"sub_org.id" = '${orgId}' AND "env.id" = '${envId}' AND "entity.name" = '${entityName.trim()}' AND timestamp BETWEEN ${startTimeMs} AND ${endTimeMs}`;
    const query = `SELECT "span_id" AS spanId, name, kind, "trace_id" AS traceId, "status_code" AS statusCode, "http.status_code" AS httpStatusCode, duration, "end_time_nano" AS endTime, "entity.id" AS entityId, "entity.name" AS entityName, "entity.type" AS entityType, "env.id" AS envId, "sub_org.id" AS orgId, "sub_org.name" AS orgName, "env.name" AS envName WHERE ${whereClause} ORDER BY timestamp ASC LIMIT 500`;
    
    debugLog(`[searchTracesByEntityAndTime] Searching for traces: entityName="${entityName}", envId="${envId}", timeRange=${startTimeMs}-${endTimeMs}`);
    
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
      debugLog(`[searchTracesByEntityAndTime] spans:search failed: ${res.status}`);
      const status: TraceSpansStatus = res.status === 403 ? "403" : "error";
      return { spans: [], status, traceId: null };
    }

    const data = (await res.json()) as { data?: TraceSpanRow[] };
    const allSpans = (data.data ?? []).filter((span: TraceSpanRow): span is TraceSpanRow & { traceId: string; spanId: string } => Boolean(span.traceId && span.spanId));
    
    const uniqueTraceIds = new Set(allSpans.map(s => s.traceId));
    debugLog(`[searchTracesByEntityAndTime] ✓ Found ${allSpans.length} spans across ${uniqueTraceIds.size} unique traces for entityName="${entityName}"`);

    if (allSpans.length === 0) {
      return { spans: [], status: "ok", traceId: null };
    }

    // Pick the ONE trace that best matches this task's time window (avoid mixing multiple broker calls)
    // endTime is in nanoseconds; duration is in nanoseconds
    const overlapByTrace = new Map<string, number>();
    for (const span of allSpans) {
      const spanEndMs = span.endTime / 1e6;
      const spanStartMs = spanEndMs - (span.duration || 0) / 1e6;
      const overlapStart = Math.max(spanStartMs, taskStartMs);
      const overlapEnd = Math.min(spanEndMs, taskEndMs);
      const overlapMs = Math.max(0, overlapEnd - overlapStart);
      const tid = span.traceId;
      overlapByTrace.set(tid, (overlapByTrace.get(tid) || 0) + overlapMs);
    }

    let bestTraceId: string | null = null;
    let bestOverlap = 0;
    for (const [tid, overlap] of overlapByTrace) {
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestTraceId = tid;
      }
    }

    if (!bestTraceId) {
      return { spans: [], status: "ok", traceId: null };
    }

    const spansForTask = allSpans.filter(s => s.traceId === bestTraceId);
    debugLog(`[searchTracesByEntityAndTime] Scoped to single trace traceId="${bestTraceId}" (overlap=${bestOverlap}ms), ${spansForTask.length} spans`);
    return { spans: spansForTask, status: "ok", traceId: bestTraceId };
  } catch (err) {
    debugLog(`[searchTracesByEntityAndTime] error:`, err);
    return { spans: [], status: "error", traceId: null };
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
    // Full format: "2026-... INFO [thread] com.logger LEVEL message..."
    const fullFormatMatch = line.match(/^[\d-T:Z.]+\s+\w+\s+\[[\w-]+\]\s+([\w.-]+)\s+([\w-]+)\s+([\s\S]+)$/);
    // JSON API format: "2026-... message..." (no logger/level prefix)
    const logger = fullFormatMatch ? fullFormatMatch[1] : "";
    const level = fullFormatMatch ? fullFormatMatch[2] : "";
    const message = fullFormatMatch
      ? fullFormatMatch[3]
      : (timestampMatch ? line.slice(timestampMatch[0].length).trimStart() : line);
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
  // Derive max iteration from parsed log fields (iteration=N in log messages)
  const maxIter = Math.max(
    1,
    ...(entries as Array<{ fields?: { iteration?: string } }>)
      .map((e) => {
        const iterStr = e.fields?.iteration;
        return iterStr ? parseInt(iterStr, 10) : 0;
      })
      .filter((n: number) => !isNaN(n) && n > 0)
  );
            const firstEntry = entries[0] as { timestamp?: string | number };
            const lastEntry = entries[entries.length - 1] as { timestamp?: string | number };
            let duration: string | null = null;
            if (firstEntry && lastEntry) {
              const t1 = typeof firstEntry.timestamp === "number" ? firstEntry.timestamp : new Date(firstEntry.timestamp || "").getTime();
              const t2 = typeof lastEntry.timestamp === "number" ? lastEntry.timestamp : new Date(lastEntry.timestamp || "").getTime();
              duration = ((t2 - t1) / 1000).toFixed(1);
            }
  // maxIter already calculated above from parsed log fields
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
  jobCard: { broker?: string; apiInstanceId?: string; appId?: string; contextId?: string; startTime?: string | number },
  apiInstanceIdFromRequest: string | undefined,
  accessToken: string,
  baseUrl: string,
  resolvedDeploymentId?: string | null
): Promise<{
  objectStore: {
    available: boolean;
    objectStoreStatus?: "ok" | "403_forbidden" | "no_store" | "no_keys";
    fromTasks?: unknown;
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

  let deploymentId: string | null = resolvedDeploymentId ?? null;
  let deploymentType: DeploymentTypeHint = undefined;

  if (deploymentId) {
    debugLog("[NO-ENTITLEMENT] Object Store: using pre-resolved deploymentId:", deploymentId);
  } else {
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
      jobCard.startTime
    );
    const status: ApiStatus["objectStore"] =
      objectStoreData.objectStoreStatus ??
      (objectStoreData.available ? "ok" : objectStoreData.errors?.some((e: string) => e.includes("403")) ? "403_forbidden" : "error");
    return {
      objectStore: {
        available: objectStoreData.available,
        objectStoreStatus: objectStoreData.objectStoreStatus,
        fromTasks: objectStoreData.fromTasks,
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

  // Fast path: resolve the broker's AMC deployment via metadata.source (app name) → AMC ?name= lookup.
  // This avoids scanning all deployments in the environment.
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
          metadata?: { source?: string };
        };

        // Parse app name from metadata.source (e.g. "urn:gav:orgId:agent-network-employee-onboarding:1.0.3")
        const metadataSource = apiInfo.metadata?.source;
        const sourceParts = metadataSource?.split(":") ?? [];
        const appNameFromSource = sourceParts.length >= 4 ? sourceParts[3] : null;

        let deploymentId: string | null = null;

        // Preferred: resolve via AMC ?name= (gets the CloudHub deployment that has logs + Object Store)
        if (appNameFromSource) {
          const listUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments?name=${encodeURIComponent(appNameFromSource)}`;
          const listRes = await loggedFetch(listUrl, {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (listRes.ok) {
            const listData = (await listRes.json()) as { items?: Array<{ id: string; name: string }> };
            const match = (listData.items ?? []).find((d) => d.name === appNameFromSource);
            if (match) {
              deploymentId = match.id;
              debugLog("[NO-ENTITLEMENT] Fast path: resolved AMC deployment by app name:", appNameFromSource, "->", deploymentId);
            }
          }
        }

        // Fallback: try RM deployment IDs directly (works for non-HY deployments)
        if (!deploymentId) {
          const dep = apiInfo.deployment || {};
          const rmDeploymentId = dep.deploymentId ?? dep.applicationId ?? apiInfo.deploymentId ?? null;
          if (rmDeploymentId) {
            deploymentId = rmDeploymentId;
            debugLog("[NO-ENTITLEMENT] Fast path: using RM deploymentId:", deploymentId);
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
              const safeLength = 1000;
              const logsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/specs/${specId}/logs?length=${safeLength}&descending=true`;
              const logsRes = await loggedFetch(logsUrl, {
                method: "GET",
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              if (logsRes.ok) {
                const contentType = logsRes.headers.get("content-type") || "";
                let logsText: string;
                if (contentType.includes("application/json")) {
                  const entries = (await logsRes.json()) as Array<{ timestamp?: number; message?: string }>;
                  logsText = Array.isArray(entries)
                    ? entries
                        .map((e) => `${e.timestamp != null ? new Date(e.timestamp).toISOString() : ""} ${e.message ?? ""}`.trim())
                        .filter((l) => l.length > 0)
                        .join("\n")
                    : "";
                } else {
                  logsText = await logsRes.text();
                }
                if (logsText.includes(taskId)) {
                  const parsed = parseRuntimeLogsToEntriesAndJobCard(logsText, taskId);
                  if (parsed) {
                    debugLog("[NO-ENTITLEMENT] Fast path: found task in broker deployment", deploymentId);
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
            const safeLength = 1000;
            const logsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments/${deployment.id}/specs/${specId}/logs?length=${safeLength}&descending=true`;

            const logsRes = await loggedFetch(logsUrl, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            });

            if (!logsRes.ok) {
              continue;
            }

            const contentType = logsRes.headers.get("content-type") || "";
            let logsText: string;
            if (contentType.includes("application/json")) {
              const entries = (await logsRes.json()) as Array<{ timestamp?: number; message?: string }>;
              logsText = Array.isArray(entries)
                ? entries
                    .map((e) => `${e.timestamp != null ? new Date(e.timestamp).toISOString() : ""} ${e.message ?? ""}`.trim())
                    .filter((l) => l.length > 0)
                    .join("\n")
                : "";
            } else {
              logsText = await logsRes.text();
            }

            if (!logsText.includes(taskId)) {
              continue;
            }
            
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
  debugLog("=".repeat(80));
  debugLog("[TASK-CALLSTACK] ========== START GET REQUEST ==========");
  debugLog(`[TASK-CALLSTACK] Request URL: ${request.url}`);
  debugLog(`[TASK-CALLSTACK] Request method: ${request.method}`);
  
  // Authentication check
  debugLog("[TASK-CALLSTACK] Step 1: Authenticating request...");
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) {
    debugLog(`[TASK-CALLSTACK] Authentication failed: ${authResult.status}`);
    return authResult;
  }
  debugLog("[TASK-CALLSTACK] ✓ Authentication successful");
  
  const { baseUrl, accessToken, session } = authResult;
  const hasMsearch = session.monitoringCenterEnabled === true;
  debugLog(`[TASK-CALLSTACK] baseUrl: ${baseUrl}`);
  debugLog(`[TASK-CALLSTACK] accessToken: ${accessToken ? "present" : "missing"} (${accessToken?.length || 0} chars)`);
  debugLog(`[TASK-CALLSTACK] monitoringCenterEnabled: ${hasMsearch}`);
  
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId");
  const taskId = searchParams.get("taskId");
  // Convert null to undefined for optional parameters (Zod expects undefined, not null)
  const apiInstanceId = searchParams.get("apiInstanceId") || undefined;
  const envId = searchParams.get("envId") || undefined;
  const skipTracesParam = searchParams.get("skipTraces") ?? undefined;

  debugLog("[TASK-CALLSTACK] Step 2: Extracting query parameters...");
  debugLog(`[TASK-CALLSTACK] Raw orgId: ${orgId ?? "null"}`);
  debugLog(`[TASK-CALLSTACK] Raw taskId: ${taskId ?? "null"}`);
  debugLog(`[TASK-CALLSTACK] Raw apiInstanceId: ${apiInstanceId ?? "undefined"}`);
  debugLog(`[TASK-CALLSTACK] Raw envId: ${envId ?? "undefined"}`);
  debugLog(`[TASK-CALLSTACK] Raw skipTraces: ${skipTracesParam ?? "undefined"}`);

  // Validate query parameters with Zod
  debugLog("[TASK-CALLSTACK] Step 3: Validating parameters with Zod schema...");
  const parseResult = TaskCallstackRequestSchema.safeParse({
    orgId,
    taskId,
    apiInstanceId,
    envId,
    skipTraces: skipTracesParam,
  });
  
  if (!parseResult.success) {
    debugLog(`[TASK-CALLSTACK] ✗ Validation failed: ${JSON.stringify(parseResult.error.format())}`);
    return validationError(parseResult.error);
  }
  debugLog("[TASK-CALLSTACK] ✓ Validation successful");
  
  const { orgId: validatedOrgId, taskId: validatedTaskId, apiInstanceId: validatedApiInstanceId, envId: validatedEnvId, skipTraces: skipTracesRequested } = parseResult.data;
  debugLog(`[TASK-CALLSTACK] Validated orgId: ${validatedOrgId}`);
  debugLog(`[TASK-CALLSTACK] Validated taskId: ${validatedTaskId}`);
  debugLog(`[TASK-CALLSTACK] Validated apiInstanceId: ${validatedApiInstanceId ?? "undefined"}`);
  debugLog(`[TASK-CALLSTACK] Validated envId: ${validatedEnvId ?? "undefined"}`);
  debugLog(`[TASK-CALLSTACK] Validated skipTraces: ${skipTracesRequested ?? false}`);

  const timeRange = 30 * 24 * 3600 * 1000;
  debugLog(`[TASK-CALLSTACK] Time range: ${timeRange}ms (30 days)`);

  try {
    // Phase 1: search by taskId — only when org has Log Search (productSKU === 1)
    let phase1Query = `orgId=${validatedOrgId} AND "${validatedTaskId}"`;
    const phase1 = hasMsearch
      ? await (async () => {
          debugLog("[TASK-CALLSTACK] Step 4: Phase 1 - Searching logs by taskId...");
          debugLog(`[TASK-CALLSTACK] Phase 1 query: ${phase1Query}`);
          debugLog(`[TASK-CALLSTACK] Phase 1 timeRange: ${timeRange}ms`);
          const result = await msearch(validatedOrgId, phase1Query, { timeRangeMs: timeRange }, accessToken, baseUrl);
          debugLog(`[TASK-CALLSTACK] Phase 1 result: ${result.hits?.length || 0} hits, error: ${result.error || "none"}`);
          if (result.hits?.length > 0) {
            const first = result.hits[0] as { _source?: { appId?: string; [key: string]: unknown } };
            const src = first._source || {};
            const firstAppId = (src.appId as string) || "undefined";
            const firstApiInstanceId = (src.apiInstanceId as string) || (typeof src.fields === "object" && src.fields && typeof (src.fields as Record<string, unknown>).apiInstanceId === "string" ? (src.fields as Record<string, unknown>).apiInstanceId : "undefined");
            debugLog(`[KEY_FACTS] msearch Phase 1: hitCount=${result.hits.length}, firstHit.appId=${firstAppId}, firstHit.apiInstanceId=${String(firstApiInstanceId)}`);
          }
          return result;
        })()
      : { total: 0, hits: [] as unknown[], raw: {}, error: "MONITORING_CENTER_PREMIUM_REQUIRED" as const };

    if (!hasMsearch) {
      debugLog("[TASK-CALLSTACK] Skipping msearch (monitoringCenterEnabled=false, productSKU !== 1)");
    }
    
    // No-entitlement mode: get task details from runtime logs
    if (phase1.error === "MONITORING_CENTER_PREMIUM_REQUIRED") {
      debugLog("[TASK-CALLSTACK] Decision: Premium required, entering no-entitlement mode");
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
        let jobCardFromRuntime = runtimeLogsResult.jobCard as Record<string, unknown>;
        // No-Entitlement Sync: Use same resolver pipeline for consistency
        let noEntDeploymentApiStatus: ApiStatus["deploymentApi"] = "not_used";
        let noEntAmc403Error: string | null = null;
        let resolvedDeploymentIdFromPipeline: string | null = null;
        if (validatedApiInstanceId && validatedEnvId) {
          try {
            const noEntState: TaskCallstackState = {
              orgId: validatedOrgId,
              taskId: validatedTaskId,
              apiInstanceId: validatedApiInstanceId,
              envId: validatedEnvId,
              skipTraces: true,
              accessToken,
              baseUrl,
              entries: runtimeLogsResult.entries,
              brokerName: (jobCardFromRuntime.broker as string) || "",
              appId: (jobCardFromRuntime.appId as string) || "",
              apiInstanceIdFromLogs: (jobCardFromRuntime.apiInstanceId as string) || "",
              deploymentContext: {
                id: null,
                type: undefined,
                resolvedName: undefined,
                source: "none",
                amc403Error: null,
                deploymentApiStatus: "not_used",
              },
              traceId: null,
              errors: [],
            };
            const resolvedNoEntState = await resolveDeploymentContext(noEntState);
            resolvedDeploymentIdFromPipeline = resolvedNoEntState.deploymentContext.id;
            if (resolvedNoEntState.deploymentContext.resolvedName) {
              jobCardFromRuntime = { ...jobCardFromRuntime, appId: resolvedNoEntState.deploymentContext.resolvedName };
              debugLog("[NO-ENTITLEMENT] Overrode jobCard.appId with resolved broker app:", resolvedNoEntState.deploymentContext.resolvedName);
            }
            if (resolvedDeploymentIdFromPipeline) {
              debugLog("[NO-ENTITLEMENT] Resolved deploymentId from pipeline:", resolvedDeploymentIdFromPipeline, "(source:", resolvedNoEntState.deploymentContext.source, ")");
            }
            // Extract deploymentApiStatus from resolved state (immutable)
            noEntDeploymentApiStatus = resolvedNoEntState.deploymentContext.deploymentApiStatus;
            noEntAmc403Error = resolvedNoEntState.deploymentContext.amc403Error;
            debugLog(`[NO-ENTITLEMENT] Resolved deploymentApiStatus: ${noEntDeploymentApiStatus}, amc403Error: ${noEntAmc403Error ? "present" : "none"}`);
          } catch (e) {
            debugLog("[NO-ENTITLEMENT] Broker resolution failed, using runtime appId:", e);
          }
        }
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
                startTime: jobCardFromRuntime.startTime as string | number | undefined,
              },
              validatedApiInstanceId ?? undefined,
              accessToken,
              baseUrl,
              resolvedDeploymentIdFromPipeline
            );
          // Error Transparency: Use deploymentApiStatus from resolved state (preserves 403 from Resolver 3)
          const noEntitlementApiStatus: ApiStatus = {
            logSearch: "403_entitlement",
            objectStore: objectStoreApiStatus,
            deploymentApi: noEntDeploymentApiStatus,
            traceSpans: "skipped",
            monitoringSuggestions,
          };
          if (noEntAmc403Error) {
            debugLog(`[NO-ENTITLEMENT] AMC 403 Error preserved: ${noEntAmc403Error.substring(0, 200)}...`);
          }
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
    debugLog("[TASK-CALLSTACK] Step 5: Extracting traceId from phase 1 hits...");
    let traceId: string | null = null;
    debugLog(`[TASK-CALLSTACK] Phase 1 hits count: ${phase1.hits.length}`);
    for (let i = 0; i < phase1.hits.length; i++) {
      const h = phase1.hits[i];
      const hit = h as { _source?: { message?: string } };
      const message = (hit._source?.message as string) || "";
      debugLog(`[TASK-CALLSTACK] Hit ${i}: checking for traceparent in message (length: ${message.length})`);
      const m = message.match(/traceparent: 00-([a-f0-9]{32})/);
      if (m) {
        traceId = m[1];
        debugLog(`[TASK-CALLSTACK] ✓ Found traceId: ${traceId}`);
        break;
      }
    }
    if (!traceId) {
      debugLog(`[TASK-CALLSTACK] ✗ No traceId found in phase 1 hits`);
      // Fallback: Try to find traceId by correlationId from phase1 hits
      debugLog("[TASK-CALLSTACK] Fallback: Searching for traceId by correlationId...");
      let correlationId: string | null = null;
      let firstTimestamp: string | number | undefined;
      let lastTimestamp: string | number | undefined;
      
      // Extract correlationId from phase1 hits
      for (let i = 0; i < phase1.hits.length; i++) {
        const h = phase1.hits[i];
        const hit = h as { _source?: { message?: string; timestamp?: string | number } };
        const message = (hit._source?.message as string) || "";
        const timestamp = hit._source?.timestamp;
        
        // Extract correlationId from message
        const corrMatch = message.match(/[Xx]-[Cc]orrelation-[Ii]d: ([a-f0-9-]+)/);
        if (corrMatch) {
          correlationId = corrMatch[1];
          debugLog(`[TASK-CALLSTACK] Found correlationId in hit ${i}: ${correlationId}`);
          break;
        }
        
        // Track timestamps for time range
        if (timestamp) {
          if (!firstTimestamp) firstTimestamp = timestamp;
          lastTimestamp = timestamp;
        }
      }
      
      if (correlationId && validatedEnvId && accessToken) {
        const foundTraceId = await searchTraceIdByCorrelationId(
          validatedOrgId,
          validatedEnvId,
          correlationId,
          accessToken,
          baseUrl,
          firstTimestamp,
          lastTimestamp
        );
        if (foundTraceId) {
          traceId = foundTraceId;
          debugLog(`[TASK-CALLSTACK] ✓ Found traceId via correlationId fallback: ${traceId}`);
        }
      } else {
        debugLog(`[TASK-CALLSTACK] ✗ No correlationId found in phase1 hits for fallback`);
      }
    }

    // Phase 2: combined search if we found trace_id
    debugLog("[TASK-CALLSTACK] Step 6: Phase 2 - Combined search...");
    let allHits = phase1.hits;
    let phase2Query: string | null = null;
    if (traceId) {
      debugLog(`[TASK-CALLSTACK] Decision: traceId found, proceeding with phase 2 search`);
      phase2Query = `orgId=${validatedOrgId} AND ("${traceId}" OR "${validatedTaskId}")`;
      debugLog(`[TASK-CALLSTACK] Phase 2 query: ${phase2Query}`);
      const phase2 = await msearch(validatedOrgId, phase2Query, { timeRangeMs: timeRange }, accessToken, baseUrl);
      debugLog(`[TASK-CALLSTACK] Phase 2 result: ${phase2.hits?.length || 0} hits, error: ${phase2.error || "none"}`);
      if (phase2.hits?.length > 0) {
        const first2 = phase2.hits[0] as { _source?: { appId?: string; [key: string]: unknown } };
        const src2 = first2._source || {};
        const firstAppId2 = (src2.appId as string) || "undefined";
        const firstApiInstanceId2 = (src2.apiInstanceId as string) || (typeof src2.fields === "object" && src2.fields && typeof (src2.fields as Record<string, unknown>).apiInstanceId === "string" ? (src2.fields as Record<string, unknown>).apiInstanceId : "undefined");
        debugLog(`[KEY_FACTS] msearch Phase 2: hitCount=${phase2.hits.length}, firstHit.appId=${firstAppId2}, firstHit.apiInstanceId=${String(firstApiInstanceId2)}`);
      }
      
      // No-entitlement mode: get task details from runtime logs
      if (phase2.error === "MONITORING_CENTER_PREMIUM_REQUIRED") {
        debugLog("[TASK-CALLSTACK] Decision: Premium required in phase2, entering no-entitlement mode");
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
        let jobCardFromRuntime = runtimeLogsResult.jobCard as Record<string, unknown>;
        // No-Entitlement Sync: Use same resolver pipeline for consistency
        let noEntDeploymentApiStatus2: ApiStatus["deploymentApi"] = "not_used";
        let noEntAmc403Error2: string | null = null;
        let resolvedDeploymentIdFromPipeline2: string | null = null;
        if (validatedApiInstanceId && validatedEnvId) {
          try {
            const noEntState: TaskCallstackState = {
              orgId: validatedOrgId,
              taskId: validatedTaskId,
              apiInstanceId: validatedApiInstanceId,
              envId: validatedEnvId,
              skipTraces: true,
              accessToken,
          baseUrl,
              entries: runtimeLogsResult.entries,
              brokerName: (jobCardFromRuntime.broker as string) || "",
              appId: (jobCardFromRuntime.appId as string) || "",
              apiInstanceIdFromLogs: (jobCardFromRuntime.apiInstanceId as string) || "",
              deploymentContext: {
                id: null,
                type: undefined,
                resolvedName: undefined,
                source: "none",
                amc403Error: null,
                deploymentApiStatus: "not_used",
              },
              traceId: null,
              errors: [],
            };
            const resolvedNoEntState = await resolveDeploymentContext(noEntState);
            resolvedDeploymentIdFromPipeline2 = resolvedNoEntState.deploymentContext.id;
            if (resolvedNoEntState.deploymentContext.resolvedName) {
              jobCardFromRuntime = { ...jobCardFromRuntime, appId: resolvedNoEntState.deploymentContext.resolvedName };
              debugLog("[NO-ENTITLEMENT] Overrode jobCard.appId with resolved broker app:", resolvedNoEntState.deploymentContext.resolvedName);
            }
            if (resolvedDeploymentIdFromPipeline2) {
              debugLog("[NO-ENTITLEMENT] Resolved deploymentId from pipeline:", resolvedDeploymentIdFromPipeline2, "(source:", resolvedNoEntState.deploymentContext.source, ")");
            }
            // Extract deploymentApiStatus from resolved state (immutable)
            noEntDeploymentApiStatus2 = resolvedNoEntState.deploymentContext.deploymentApiStatus;
            noEntAmc403Error2 = resolvedNoEntState.deploymentContext.amc403Error;
            debugLog(`[NO-ENTITLEMENT] Resolved deploymentApiStatus: ${noEntDeploymentApiStatus2}, amc403Error: ${noEntAmc403Error2 ? "present" : "none"}`);
          } catch (e) {
            debugLog("[NO-ENTITLEMENT] Broker resolution failed, using runtime appId:", e);
          }
        }
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
                startTime: jobCardFromRuntime.startTime as string | number | undefined,
              },
              validatedApiInstanceId ?? undefined,
              accessToken,
              baseUrl,
              resolvedDeploymentIdFromPipeline2
            );
          // Error Transparency: Use deploymentApiStatus from resolved state (preserves 403 from Resolver 3)
          const noEntitlementApiStatus: ApiStatus = {
            logSearch: "403_entitlement",
            objectStore: objectStoreApiStatus,
            deploymentApi: noEntDeploymentApiStatus2,
            traceSpans: "skipped",
            monitoringSuggestions,
          };
          if (noEntAmc403Error2) {
            debugLog(`[NO-ENTITLEMENT] AMC 403 Error preserved: ${noEntAmc403Error2.substring(0, 200)}...`);
          }
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
      debugLog(`[TASK-CALLSTACK] Using phase 2 hits: ${allHits.length} total`);
    } else {
      debugLog(`[TASK-CALLSTACK] No traceId found, using phase 1 hits only: ${allHits.length} total`);
    }

    // Deduplicate by _id
    debugLog("[TASK-CALLSTACK] Step 7: Deduplicating hits by _id...");
    const seen = new Set<string>();
    const unique: unknown[] = [];
    for (const h of allHits) {
      const hit = h as { _id?: string };
      if (hit._id && !seen.has(hit._id)) {
        seen.add(hit._id);
        unique.push(h);
      }
    }
    debugLog(`[TASK-CALLSTACK] After deduplication: ${unique.length} unique entries (from ${allHits.length} total)`);

    // Sort by timestamp (handle numeric string = epoch ms from flex-gateway)
    debugLog("[TASK-CALLSTACK] Step 8: Sorting entries by timestamp...");
    unique.sort((a: unknown, b: unknown) => {
      const hitA = a as { _source?: { timestamp?: number | string } };
      const hitB = b as { _source?: { timestamp?: number | string } };
      const na = normalizeTimestamp(hitA._source?.timestamp);
      const nb = normalizeTimestamp(hitB._source?.timestamp);
      const ta = typeof na === "number" ? na : new Date(na).getTime();
      const tb = typeof nb === "number" ? nb : new Date(nb).getTime();
      return ta - tb;
    });
    debugLog(`[TASK-CALLSTACK] ✓ Entries sorted`);

    // Classify and parse each entry (normalize timestamp: flex-gateway sends epoch ms as string)
    debugLog("[TASK-CALLSTACK] Step 9: Classifying and parsing entries...");
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

    debugLog(`[TASK-CALLSTACK] ✓ Parsed ${entries.length} entries`);
    debugLog(`[TASK-CALLSTACK] Entry types breakdown: ${JSON.stringify(
      entries.reduce((acc: Record<string, number>, e: typeof entries[0]) => {
        acc[e.type] = (acc[e.type] || 0) + 1;
        return acc;
      }, {})
    )}`);

    // Derive max iteration from parsed log fields (iteration=N in log messages)
    const maxIter = Math.max(
      1,
      ...entries
        .map((e: typeof entries[0]) => {
          const iterStr = e.fields?.iteration as string | undefined;
          return iterStr ? parseInt(iterStr, 10) : 0;
        })
        .filter((n: number) => !isNaN(n) && n > 0)
    );
    debugLog(`[TASK-CALLSTACK] Max iteration from parsed logs: ${maxIter}`);

    // Build Job Card from parsed entries
    debugLog("[TASK-CALLSTACK] Step 10: Building job card from entries...");
    const inbound = entries.find((e: typeof entries[0]) => e.type === "INBOUND_REQUEST");
    const finalResp = entries.find((e: typeof entries[0]) => e.type === "FINAL_RESPONSE");
    const toolSelections = entries.filter((e: typeof entries[0]) => e.type === "LLM_TOOL_SELECTION");
    const toolExecutions = entries.filter((e: typeof entries[0]) => e.type === "TOOL_EXECUTED");
    debugLog(`[TASK-CALLSTACK] Found: inbound=${!!inbound}, finalResp=${!!finalResp}, toolSelections=${toolSelections.length}, toolExecutions=${toolExecutions.length}`);

    const firstEntry = entries[0];
    const lastEntry = entries[entries.length - 1];
    debugLog(`[TASK-CALLSTACK] First entry timestamp: ${firstEntry?.timestamp ?? "none"}, Last entry timestamp: ${lastEntry?.timestamp ?? "none"}`);
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
        debugLog(`[TASK-CALLSTACK] Calculated duration: ${duration}s`);
      } else {
        debugLog(`[TASK-CALLSTACK] ✗ Could not calculate duration: t1=${t1}, t2=${t2}`);
      }
    } else {
      debugLog(`[TASK-CALLSTACK] ✗ Missing first or last entry for duration calculation`);
    }

    // maxIter already calculated above from parsed log fields
    const toolStrings = toolSelections.map((e: typeof entries[0]) => e.fields.tool as string).filter((t: string | undefined): t is string => typeof t === "string" && Boolean(t));
    const allTools: string[] = Array.from(new Set(toolStrings));
    debugLog(`[TASK-CALLSTACK] Max iteration: ${maxIter}, Tools: ${allTools.join(", ") || "none"}`);

    const brokerName: string = String((entries.find((e: typeof entries[0]) => e.fields.agent) || {}).fields?.agent ?? "");
    const appId = (entries.find((e: typeof entries[0]) => e.appId && !e.appId.startsWith("_")) || {}).appId || "";
    const apiInstanceId: string = String((entries.find((e: typeof entries[0]) => e.fields.apiInstanceId) || {}).fields?.apiInstanceId || "");
    debugLog(`[KEY_FACTS] Extracted from log entries: brokerName="${brokerName}", appId="${appId}", apiInstanceId="${apiInstanceId}"`);
    debugLog(`[TASK-CALLSTACK] Extracted from entries: brokerName="${brokerName}", appId="${appId}", apiInstanceId="${apiInstanceId}"`);

    // Functional Pipeline: Resolve Deployment Context (Steps 11-13)
    debugLog("[TASK-CALLSTACK] Steps 11-13: Resolving deployment context via functional pipeline...");
    const initialState: TaskCallstackState = {
      orgId: validatedOrgId,
      taskId: validatedTaskId,
      apiInstanceId: validatedApiInstanceId,
      envId: validatedEnvId,
      skipTraces: skipTracesRequested,
      accessToken,
      baseUrl,
      entries,
      brokerName,
      appId,
      apiInstanceIdFromLogs: apiInstanceId,
      deploymentContext: {
        id: null,
        type: undefined,
        resolvedName: undefined,
        source: "none",
        amc403Error: null,
        deploymentApiStatus: "not_used",
      },
      traceId: traceId || null,
      errors: [],
    };
    
    const resolvedState = await resolveDeploymentContext(initialState);
    
    // Extract resolved values (immutable - from context object)
    const deploymentId = resolvedState.deploymentContext.id;
    const deploymentType = resolvedState.deploymentContext.type;
    const appNameForDeploymentDetail = resolvedState.deploymentContext.resolvedName;
    const applicationManager403Error = resolvedState.deploymentContext.amc403Error;
    const deploymentApiStatus = resolvedState.deploymentContext.deploymentApiStatus;
    // Use resolved appId (may have been updated by Resolver 2)
    const finalAppId = resolvedState.appId;
    
    debugLog(`[TASK-CALLSTACK] Pipeline result: deploymentId=${deploymentId ?? "null"}, deploymentType=${deploymentType ?? "undefined"}, resolvedName=${appNameForDeploymentDetail ?? "none"}, source=${resolvedState.deploymentContext.source}, deploymentApiStatus=${deploymentApiStatus}`);

    // OPTIMIZATION: Fetch Object Store and trace spans in parallel since they're independent
    debugLog(`[TASK-CALLSTACK] Step 14: Preparing Object Store fetch...`);
    debugLog(`[TASK-CALLSTACK] Final variables before Object Store fetch:`);
    debugLog(`[TASK-CALLSTACK]   - validatedOrgId: ${validatedOrgId}`);
    debugLog(`[TASK-CALLSTACK]   - validatedEnvId: ${validatedEnvId ?? "undefined"}`);
    debugLog(`[TASK-CALLSTACK]   - validatedTaskId: ${validatedTaskId}`);
    debugLog(`[TASK-CALLSTACK]   - brokerName: ${brokerName || "empty"}`);
    debugLog(`[TASK-CALLSTACK]   - deploymentId: ${deploymentId ?? "null"}`);
    debugLog(`[TASK-CALLSTACK]   - appId (log-extracted): ${appId || "empty"}`);
    debugLog(`[TASK-CALLSTACK]   - appId (final/resolved): ${finalAppId || "empty"}`);
    debugLog(`[TASK-CALLSTACK]   - apiInstanceId: ${apiInstanceId || "empty"}`);
    debugLog(`[TASK-CALLSTACK]   - deploymentType: ${deploymentType ?? "undefined"}`);
    debugLog(`[TASK-CALLSTACK] Decision: ${validatedEnvId && deploymentId ? "Will fetch Object Store" : `Skipping Object Store - missing: ${!validatedEnvId ? "envId " : ""}${!deploymentId ? "deploymentId" : ""}`}`);
    
    // Fetch Object Store data if we have envId and deployment ID (brokerName can be empty - we'll still get no_store/403/no_keys from client)
    let objectStoreData: {
      available: boolean;
      objectStoreStatus?: "ok" | "403_forbidden" | "no_store" | "no_keys";
      fromTasks?: { steps: Array<{ step: string; content: string[] }>; rawReasoning: string[] };
      llmReasoning?: {
        steps?: Array<{ step: string; content: string[] }>;
        rawReasoning?: string[];
      };
      toolCallIds?: string[];
      downstreamContextIds?: Array<{ agent: string; contextId: string; taskId: string }>;
      errors?: string[];
    } = { available: false };

    // Prepare Object Store fetch promise (returns result + optional monitoring from same deployment GET, no extra call)
    // IMMUTABILITY: Return updated deploymentApiStatus from promise to avoid mutation
    const objectStorePromise = (async (): Promise<{
      result: typeof objectStoreData;
      monitoringSuggestions?: ApiStatus["monitoringSuggestions"];
      deploymentApiStatus?: ApiStatus["deploymentApi"];
    }> => {
      if (validatedEnvId && deploymentId && accessToken) {
        debugLog(`[TASK-CALLSTACK] Object Store fetch conditions met: envId=${validatedEnvId}, deploymentId=${deploymentId}, accessToken=present`);
        let objectStoreRegion: string | undefined;
        let monitoringSuggestions: ApiStatus["monitoringSuggestions"];
        // IMMUTABILITY: Compute final deploymentApiStatus immutably (preserve 403 from Resolver 3)
        let finalDeploymentApiStatus: ApiStatus["deploymentApi"] = deploymentApiStatus;
        try {
          debugLog(`[TASK-CALLSTACK] Calling fetchDeploymentDetail with: orgId=${validatedOrgId}, envId=${validatedEnvId}, deploymentId=${deploymentId}, deploymentType=${deploymentType ?? "undefined"}, appNameFromMetadata=${appNameForDeploymentDetail ?? "undefined"}`);
          const deploymentDetail = await fetchDeploymentDetail(
            validatedOrgId,
            validatedEnvId,
            deploymentId!,
            accessToken,
            baseUrl,
            { deploymentType, appNameFromMetadata: appNameForDeploymentDetail }
          );
          if (deploymentDetail == null) {
            debugLog(`[TASK-CALLSTACK] fetchDeploymentDetail returned null; using undefined region and default monitoringSuggestions`);
            objectStoreRegion = undefined;
            monitoringSuggestions = { brokerLogger: false, insecureLogging: false };
            // Keep deploymentApiStatus from resolvedState (immutable)
            finalDeploymentApiStatus = deploymentApiStatus;
          } else {
            debugLog(`[TASK-CALLSTACK] fetchDeploymentDetail returned: region=${deploymentDetail.region ?? "undefined"}, deploymentApiStatus=${deploymentDetail.deploymentApiStatus ?? "undefined"}`);
            objectStoreRegion = deploymentDetail.region;
            monitoringSuggestions = deploymentDetail.monitoringSuggestions;
            // CRITICAL: Preserve 403 from Resolver 3 (AMC fallback) - it takes priority over fetchDeploymentDetail status
            // Priority: amc403Error ? '403_forbidden' : fetchDeploymentDetail.deploymentApiStatus
            // IMMUTABILITY: Compute new value instead of mutating
            finalDeploymentApiStatus = deploymentApiStatus === "403_forbidden" 
              ? deploymentApiStatus  // Preserve 403 from Resolver 3
              : (deploymentDetail.deploymentApiStatus || deploymentApiStatus);
            debugLog(`[TASK-CALLSTACK] Final deploymentApiStatus (immutable): ${finalDeploymentApiStatus} (base: ${deploymentApiStatus}, fetchDeploymentDetail: ${deploymentDetail.deploymentApiStatus ?? "none"})`);
          }
          if (objectStoreRegion) {
            debugLog(`[TASK-CALLSTACK] ✓ Region resolved: ${objectStoreRegion}`);
          } else {
            debugLog(`[TASK-CALLSTACK] ✗ Region detection returned null/undefined`);
          }
          const taskStartTime = firstEntry?.timestamp;
          debugLog(`[TASK-CALLSTACK] Calling fetchObjectStoreData with:`);
          debugLog(`[TASK-CALLSTACK]   - orgId: ${validatedOrgId}`);
          debugLog(`[TASK-CALLSTACK]   - envId: ${validatedEnvId}`);
          debugLog(`[TASK-CALLSTACK]   - taskId: ${validatedTaskId}`);
          debugLog(`[TASK-CALLSTACK]   - brokerName: ${brokerName || "empty"}`);
          debugLog(`[TASK-CALLSTACK]   - deploymentId: ${deploymentId}`);
          debugLog(`[TASK-CALLSTACK]   - deploymentType: ${deploymentType || "unknown"}`);
          debugLog(`[TASK-CALLSTACK]   - objectStoreRegion: ${objectStoreRegion ?? "(none)"}`);
          debugLog(`[TASK-CALLSTACK]   - taskStartTime: ${taskStartTime ?? "undefined"}`);
          const result = await fetchObjectStoreData(
          validatedOrgId,
          validatedEnvId,
          validatedTaskId,
          brokerName,
          deploymentId,
            accessToken,
            deploymentType,
            objectStoreRegion,
            taskStartTime
          );
          debugLog(`[TASK-CALLSTACK] fetchObjectStoreData returned: available=${result.available}, objectStoreStatus=${result.objectStoreStatus ?? "undefined"}, errors=${result.errors?.length || 0}`);
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
          return { result, monitoringSuggestions, deploymentApiStatus: finalDeploymentApiStatus };
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
          // Preserve deploymentApiStatus from resolvedState even on error (immutable)
          return {
            result: {
          available: false,
              objectStoreStatus: (is403 ? "403_forbidden" : undefined) as "403_forbidden" | undefined,
          errors: [errorMessage],
            },
            deploymentApiStatus: deploymentApiStatus, // Use resolved state value
        };
      }
    } else {
        const skipReason = !validatedEnvId ? "missing envId" : !deploymentId ? "missing deploymentId" : !accessToken ? "missing accessToken" : "unknown";
      debugLog(
          `[ObjectStore] Skipping Object Store fetch - reason: ${skipReason}, envId: ${validatedEnvId ? validatedEnvId : "none"}, brokerName: ${brokerName || "none"}, deploymentId: ${deploymentId || "none"}, appId: ${finalAppId || "none"}, apiInstanceId: ${apiInstanceId || "none"}`
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
            result.errors.push(`Cannot fetch Object Store: ${skipReason}. appId="${finalAppId}", apiInstanceId="${apiInstanceId}"`);
          }
        }
        // Return deploymentApiStatus from resolvedState (immutable)
        return { result, deploymentApiStatus: deploymentApiStatus };
      }
    })();

    // Prepare trace spans fetch promise
    // Search directly by entity.name (broker app), envId, and time period - no need for traceId from logs
    const traceSpansPromise = (async (): Promise<{ spans: TraceSpanRow[]; status: TraceSpansStatus; traceId: string | null }> => {
      if (!skipTracesRequested && validatedEnvId && validatedEnvId.trim() !== "" && accessToken && firstEntry && lastEntry) {
        // Use resolved broker app name for entityName
        const entityNameForSearch = appNameForDeploymentDetail || finalAppId;
        if (entityNameForSearch && entityNameForSearch.trim() !== "") {
          const taskStartMs =
            typeof firstEntry.timestamp === "number"
              ? firstEntry.timestamp
              : /^\d+$/.test(String(firstEntry.timestamp))
                ? parseInt(String(firstEntry.timestamp), 10)
                : new Date(firstEntry.timestamp).getTime();
          const taskEndMs =
            typeof lastEntry.timestamp === "number"
              ? lastEntry.timestamp
              : /^\d+$/.test(String(lastEntry.timestamp))
                ? parseInt(String(lastEntry.timestamp), 10)
                : new Date(lastEntry.timestamp).getTime();
          debugLog(`[TASK-CALLSTACK] Searching for traces by entityName="${entityNameForSearch}", envId="${validatedEnvId}", timeRange=${firstEntry.timestamp}-${lastEntry.timestamp}`);
          return await searchTracesByEntityAndTime(
            validatedOrgId,
            validatedEnvId,
            entityNameForSearch,
            accessToken,
            baseUrl,
            firstEntry.timestamp,
            lastEntry.timestamp,
            taskStartMs,
            taskEndMs
          );
        } else {
          debugLog(`[TASK-CALLSTACK] ✗ Cannot search traces: entityName is empty`);
        }
      }
      return { spans: [], status: "skipped" as TraceSpansStatus, traceId: null };
    })();

    // Execute both fetches in parallel
    const [objectStorePayload, traceSpansResult] = await Promise.all([objectStorePromise, traceSpansPromise]);
    objectStoreData = objectStorePayload.result;
    // IMMUTABILITY: Use deploymentApiStatus from promise (may have been updated by fetchDeploymentDetail)
    // This preserves 403 from Resolver 3 while allowing fetchDeploymentDetail to update if needed
    const finalDeploymentApiStatus: ApiStatus["deploymentApi"] = objectStorePayload.deploymentApiStatus ?? deploymentApiStatus;
    let traceSpans = traceSpansResult.spans;
    // Resolved traceId: from logs (traceparent), correlationId fallback, or entity+time selection
    const resolvedTraceId: string | null = (traceId || (traceSpansResult as { traceId?: string | null }).traceId) ?? null;
    // When we got a traceId from entity+time search, re-fetch the FULL trace by trace_id (no entity filter)
    // so we get root [Agent] EmployeeAgent, mule:flow, [BROKER], and child agents — matching Monitoring UI scope
    if ((traceSpansResult as { traceId?: string | null }).traceId && accessToken && validatedEnvId && firstEntry && lastEntry) {
      const fullTrace = await fetchTraceSpans(
        validatedOrgId,
        (traceSpansResult as { traceId: string }).traceId,
        accessToken,
        baseUrl,
        validatedEnvId,
        firstEntry.timestamp,
        lastEntry.timestamp
        // no entityName: get all spans for this trace so hierarchy shows root + broker + child agents
      );
      if (fullTrace.status === "ok" && fullTrace.spans.length > 0) {
        traceSpans = fullTrace.spans;
        debugLog(`[TASK-CALLSTACK] Fetched full trace by traceId: ${(traceSpansResult as { traceId: string }).traceId}, ${traceSpans.length} spans (root + broker + child agents)`);
      }
    }
    // DISABLED: Trace filtering by entityName was too aggressive and removed child spans
    // (routers, agents, LLMs) that don't have the broker name as their entityName.
    // This prevented showing the full trace hierarchy. Users can filter spans using
    // the UI filters in TraceVisualization component if needed.
    // 
    // Previous filtering code (commented out for reference):
    // const resolvedNameForFiltering = appNameForDeploymentDetail || finalAppId;
    // if (resolvedNameForFiltering && traceSpans.length > 0) {
    //   const brokerSpans = traceSpans.filter(
    //     (s: TraceSpanRow) => (s.entityName || "").trim() === resolvedNameForFiltering
    //   );
    //   if (brokerSpans.length > 0) {
    //     traceSpans = brokerSpans;
    //     debugLog(`[TASK-CALLSTACK] Filtered trace spans to broker (entityName=${resolvedNameForFiltering}): ${traceSpansResult.spans.length} -> ${traceSpans.length}`);
    //   }
    // }
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
    debugLog(`[TASK-CALLSTACK] Building monitoringSuggestions from objectStorePayload:`);
    debugLog(`[TASK-CALLSTACK]   - objectStorePayload.monitoringSuggestions: ${JSON.stringify(objectStorePayload.monitoringSuggestions ?? "undefined")}`);
    debugLog(`[TASK-CALLSTACK]   - objectStorePayload.monitoringSuggestions?.brokerLogger: ${objectStorePayload.monitoringSuggestions?.brokerLogger ?? "undefined"} (strict === true check: ${objectStorePayload.monitoringSuggestions?.brokerLogger === true})`);
    debugLog(`[TASK-CALLSTACK]   - objectStorePayload.monitoringSuggestions?.insecureLogging: ${objectStorePayload.monitoringSuggestions?.insecureLogging ?? "undefined"} (strict === true check: ${objectStorePayload.monitoringSuggestions?.insecureLogging === true})`);
    const monitoringSuggestions: ApiStatus["monitoringSuggestions"] = {
      brokerLogger: objectStorePayload.monitoringSuggestions?.brokerLogger === true,
      insecureLogging: objectStorePayload.monitoringSuggestions?.insecureLogging === true,
    };
    debugLog(`[TASK-CALLSTACK] Final monitoringSuggestions: brokerLogger=${monitoringSuggestions.brokerLogger}, insecureLogging=${monitoringSuggestions.insecureLogging}`);
    // Error Transparency: Use final deploymentApiStatus (preserves 403 from Resolver 3)
    const apiStatus: ApiStatus = {
      logSearch: "ok",
      objectStore: objectStoreStatus,
      deploymentApi: finalDeploymentApiStatus,
      traceSpans: traceSpansStatus,
      monitoringSuggestions,
    };
    
    // Error Transparency: Log amc403Error if present (for debugging/support)
    if (applicationManager403Error) {
      debugLog(`[TASK-CALLSTACK] AMC 403 Error preserved: ${applicationManager403Error.substring(0, 200)}...`);
    }

    const jobCard = {
      taskId,
      contextId: (entries.find((e: typeof entries[0]) => e.fields.contextId) || {}).fields?.contextId || "",
      traceId: resolvedTraceId ?? "",
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
      // Use resolved broker app name from deploymentContext, fallback to log appId
      appId: appNameForDeploymentDetail ?? finalAppId,
      objectStore: objectStoreData,
      apiStatus,
    };

    debugLog("[TASK-CALLSTACK] Step 15: Building final response...");
    debugLog(`[TASK-CALLSTACK] Final jobCard variables:`);
    debugLog(`[TASK-CALLSTACK]   - taskId: ${validatedTaskId}`);
    debugLog(`[TASK-CALLSTACK]   - contextId: ${(entries.find((e: typeof entries[0]) => e.fields.contextId) || {}).fields?.contextId ?? "none"}`);
    debugLog(`[TASK-CALLSTACK]   - brokerName: ${brokerName || "empty"}`);
    debugLog(`[TASK-CALLSTACK]   - appId (log-extracted): ${appId || "empty"}`);
    debugLog(`[TASK-CALLSTACK]   - deploymentContext.resolvedName: ${appNameForDeploymentDetail ?? "none"}`);
    debugLog(`[TASK-CALLSTACK]   - jobCard.appId (sent in response): ${(appNameForDeploymentDetail ?? finalAppId) || "empty"}`);
    debugLog(`[TASK-CALLSTACK]   - deploymentId: ${deploymentId ?? "null"}`);
    debugLog(`[TASK-CALLSTACK]   - objectStore.available: ${objectStoreData.available}`);
    debugLog(`[TASK-CALLSTACK]   - entries.length: ${entries.length}`);
    debugLog(`[TASK-CALLSTACK]   - traceSpans.length: ${traceSpans?.length || 0}`);
    debugLog("[TASK-CALLSTACK] ========== END GET REQUEST (SUCCESS) ==========");
    debugLog("=".repeat(80));

    return NextResponse.json({
      jobCard,
      entries,
      traceSpans,
      rawQueries: { phase1: phase1Query, phase2: phase2Query, traceId },
    });
  } catch (error) {
    debugLog("[TASK-CALLSTACK] ========== END GET REQUEST (ERROR) ==========");
    debugLog("=".repeat(80));
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
