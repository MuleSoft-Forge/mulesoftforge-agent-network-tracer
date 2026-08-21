import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugError, debugLog } from "@/lib/api-logger";
import { TaskCallstackRequestSchema } from "@/lib/schemas";
import { fetchObjectStoreData, getObjectStoreRegionFromDeployment, getMonitoringLogCategoriesFromDeployment, getKnownObjectStoreRetentionMs } from "@/lib/object-store/client";
import type { TaskStory } from "@/lib/object-store/v2-parser";
import { getOAuthConfig, AMC_COMMON_SCOPES_TO_TRY } from "@/lib/auth/config";
import type { ApiStatus } from "@/components/task-details/types";
import { requireAuth } from "@/lib/api/auth-middleware";
import { orgHasTitaniumMonitoring } from "@/lib/api/log-search-entitlement";
import { isOrgLogSearchEntitled } from "@/lib/api/log-search";
import { msearch } from "@/lib/api/msearch";
import { buildAmcLogsUrl } from "@/lib/api/amc-logs";
import { validationError } from "@/lib/api/error-responses";
import { resolveDeploymentContext, type TaskCallstackState } from "@/lib/deployment-context/resolvers";
import { resolveBrokerContext, type BrokerContext } from "@/lib/broker-context";
import { PhaseTimer } from "@/lib/api/timing";
import {
  assignTaskIterations,
  collectToolNames,
  deriveMaxIteration,
  type IterationAssignableEntry,
} from "@/lib/broker-tasks/assign-task-iterations";
import {
  chooseSpecIdAtOrBefore,
  parseEpochMs,
  type AmcSpecDescriptor,
} from "@/lib/broker-tasks/amc-spec-selection";

export const dynamic = "force-dynamic";

/**
 * Escape a value that will be embedded inside a Lucene double-quoted phrase
 * (e.g. `"${taskId}"`). Prevents query injection by neutralizing the quote and
 * backslash characters that would otherwise break out of the phrase. Newlines
 * are stripped for good measure.
 */
function escapeLucenePhrase(value: string): string {
  return value.replace(/[\\"]/g, "\\$&").replace(/[\r\n]+/g, " ");
}

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
 * Skip the Object Store lookup only for tasks we know are past their store's
 * expiry. Retention is a store-level setting the runtime cannot override
 * per key, and it varies by deployment (observed: 30 days, not the 24h the
 * runtime's own comments describe), so it is read from the platform during
 * store discovery rather than assumed here. Until a store has been found the
 * retention is unknown, and unknown must mean "attempt the fetch" — skipping
 * on a guess silently drops readable history.
 */
function isTaskOlderThanObjectStoreRetention(
  taskStart: string | number | undefined | null,
  retentionMs: number | undefined
): { skip: boolean; ageMs?: number; retentionMs?: number } {
  if (taskStart == null || retentionMs == null) return { skip: false };
  const startedAt =
    typeof taskStart === "number" ? taskStart : new Date(taskStart).getTime();
  if (!Number.isFinite(startedAt)) return { skip: false };
  const ageMs = Date.now() - startedAt;
  return { skip: ageMs > retentionMs, ageMs, retentionMs };
}

function describeRetentionSkip(check: { ageMs?: number; retentionMs?: number }): string {
  const ageHours = Math.floor((check.ageMs ?? 0) / (60 * 60 * 1000));
  const retentionHours = Math.floor((check.retentionMs ?? 0) / (60 * 60 * 1000));
  return `task start is ${ageHours}h old, past this store's ${retentionHours}h retention`;
}

/**
 * Read `target.deploymentSettings.persistentObjectStore` from an AMC
 * deployment object if present. Returns `undefined` when the shape doesn't
 * match (Hybrid API surface uses different keys).
 */
function readPersistentObjectStoreFlag(deployment: unknown): boolean | undefined {
  const flag = (deployment as {
    target?: { deploymentSettings?: { persistentObjectStore?: unknown } };
  })?.target?.deploymentSettings?.persistentObjectStore;
  return typeof flag === "boolean" ? flag : undefined;
}

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
  debugLog(`[fetchDeploymentDetailViaHybrid] getMonitoringLogCategoriesFromDeployment returned: insecureLogging=${monitoringSuggestions.insecureLogging}`);
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
  /**
   * `target.deploymentSettings.persistentObjectStore` from AMC (diagnostic/logs only).
   * `false` means non-durable store attachment; an ephemeral Object Store with its own
   * shorter window may still apply, so this is never used to judge whether keys survive.
   */
  persistentObjectStore?: boolean;
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
              const persistentObjectStore = readPersistentObjectStoreFlag(deployment);
              debugLog(`[fetchDeploymentDetail] AMC GET by id (from name): region=${region ?? "undefined"}, insecureLogging=${monitoringSuggestions.insecureLogging}, persistentObjectStore=${persistentObjectStore}`);
              return { region, monitoringSuggestions, deploymentApiStatus: "ok" as const, persistentObjectStore };
            }
          }
        }
      }
      if (result === null) {
        debugLog(`[fetchDeploymentDetail] Hybrid API fallback returned null; returning safe object (region undefined) so caller does not read .region on null`);
        return { region: undefined, monitoringSuggestions: { insecureLogging: false }, deploymentApiStatus: "ok" as const };
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
  const persistentObjectStore = readPersistentObjectStoreFlag(deployment);
  debugLog(`[fetchDeploymentDetail] getMonitoringLogCategoriesFromDeployment returned: insecureLogging=${monitoringSuggestions.insecureLogging}, persistentObjectStore=${persistentObjectStore}`);
  debugLog("[fetchDeploymentDetail] ========== END (AMC) ==========");
  return { region, monitoringSuggestions, deploymentApiStatus: "ok", persistentObjectStore };
}


function isGraphRuntimeLog(logger: string, message: string): boolean {
  if (logger.includes("module_graph_runtime")) return true;
  return /\[agent_[^\]]+\]|\] on_init:|\] after_reasoning:|Graph execution|Execution started \(turn_id|Current node:|Starting vanilla node|Transitioning to next (?:node|component)|OpenAI request input|Response output from OpenAI|LLM Reasoning was:|Final state variables|Slow internal duration|Registered node type|State size check:|already registered with|completed without needing to transition|trace_id=[a-f0-9]{32} task_id=/i.test(
    message
  );
}

function classifyGraphRuntimeLog(logger: string, message: string): string | null {
  if (!isGraphRuntimeLog(logger, message)) return null;

  if (/^\[agent_[^\]]+\]\s+Received message:/.test(message)) return "INBOUND_REQUEST";
  if (/Execution started \(turn_id:/.test(message)) return "GRAPH_EXECUTION_START";
  if (/^Current node:/.test(message) || /^Starting vanilla node/.test(message)) return "GRAPH_NODE";
  if (/\] on_init: Action enabled, executing tool=/.test(message) || /\] on_init: Tool .+ result received/.test(message)) {
    return "TOOL_EXECUTED";
  }
  if (/^OpenAI request input:/.test(message)) return "LLM_REQUEST";
  if (/^Response output from OpenAI:/.test(message)) return "LLM_RESPONSE";
  if (/^LLM Reasoning was:/.test(message)) return "LLM_REASONING";
  if (/Transitioning to next (?:node|component):/.test(message) || /Handoff to .+ enabled/.test(message) || /\] after_reasoning: Handoff to/.test(message)) {
    return "GRAPH_TRANSITION";
  }
  if (/^Final state variables:/.test(message) && message.includes("TASK_STATE_COMPLETED")) return "FINAL_RESPONSE";
  if (/^Graph execution completed/.test(message)) return "FINAL_RESPONSE";
  if (/completed without needing to transition/.test(message)) return "GRAPH_NODE_COMPLETE";
  if (/^Slow internal duration/.test(message)) return "GRAPH_PERF";
  if (/Registered node type|State size check:|already registered with|Node type .* already registered/.test(message)) {
    return "GRAPH_DEBUG";
  }
  return "GRAPH_RUNTIME";
}

function classifyLog(logger: string, message: string): string {
  const graphType = classifyGraphRuntimeLog(logger, message);
  if (graphType) return graphType;
  if (logger === "flex-gateway-envoy") return "GATEWAY";
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
  return "OTHER";
}

function parseFields(message: string) {
  const f: Record<string, unknown> = {};
  const m = (rx: RegExp) => (message.match(rx) || [])[1] || null;
  f.taskId = m(/(?:taskId|task_id)=([a-f0-9-]+)/);
  f.contextId = m(/(?:contextId|context_id)=([a-f0-9-]+)/);
  f.apiInstanceId = m(/apiInstanceId=(\d+)/);
  f.iteration = m(/iteration=(\d+)/);
  f.agent = m(/(?:agent_id|agent)=(\S+)/);
  f.traceId = m(/traceparent: 00-([a-f0-9]{32})/) || m(/trace_id=([a-f0-9]{32})/);
  f.spanId = m(/traceparent: 00-[a-f0-9]{32}-([a-f0-9]{16})/);
  f.correlationId = m(/[Xx]-[Cc]orrelation-[Ii]d: ([a-f0-9-]+)/);
  f.tool =
    m(/(?:LLM selected tool|Executed tool) (\S+)/) ||
    m(/executing tool=(\S+)/) ||
    m(/Tool (\S+) result received/);
  f.graphNode =
    m(/Current node: (\S+)/) ||
    m(/Starting vanilla node (\S+)/) ||
    m(/Transitioning to next (?:node|component): (\S+)/) ||
    m(/Handoff to (\S+) enabled/) ||
    m(/\[(\w+)\] on_init:/);
  const bracketAgent = message.match(/^\[(agent_[^\]]+)\]/);
  if (bracketAgent) {
    f.agent = f.agent || bracketAgent[1];
  }
  if (message.startsWith("LLM Reasoning was:")) {
    f.llmReasoning = message.replace(/^LLM Reasoning was:\s*/, "").split(" : trace_id")[0].trim();
  }
  if (message.startsWith("Final state variables:")) {
    const stateMatch = message.match(/TASK_STATE_(\w+)/);
    if (stateMatch) f.resultStatus = `TASK_STATE_${stateMatch[1]}`;
    const textMatch = message.match(/'text':\s*'([^']+)'/);
    if (textMatch) f.responseText = textMatch[1];
  }
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

function extractTraceIdFromMessage(message: string): string | null {
  const traceparent = message.match(/traceparent: 00-([a-f0-9]{32})/);
  if (traceparent) return traceparent[1];
  const traceIdField = message.match(/trace_id=([a-f0-9]{32})/);
  if (traceIdField) return traceIdField[1];
  return null;
}

type TaskCallstackEntry = {
  index?: number;
  type?: string;
  summary?: string;
  timestamp?: string | number;
  logger?: string;
  level?: string;
  appId?: string;
  workerId?: string;
  fields?: Record<string, unknown>;
  raw?: { message?: string; [key: string]: unknown };
  _id?: string;
  _index?: string;
};

function entryDedupeKey(entry: TaskCallstackEntry): string {
  const message = (entry.raw?.message as string) ?? entry.summary ?? "";
  return `${String(entry.timestamp ?? "")}|${entry.logger ?? ""}|${message.slice(0, 120)}`;
}

function mergeTaskCallstackEntries<T extends TaskCallstackEntry>(primary: T[], supplemental: T[]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const entry of [...primary, ...supplemental]) {
    const key = entryDedupeKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  merged.sort((a, b) => {
    const ta = normalizeTimestamp(a.timestamp);
    const tb = normalizeTimestamp(b.timestamp);
    const t1 = typeof ta === "number" ? ta : new Date(ta).getTime();
    const t2 = typeof tb === "number" ? tb : new Date(tb).getTime();
    return t1 - t2;
  });
  return merged.map((entry, index) => ({ ...entry, index }));
}

function hasBrokerRuntimeLogs(entries: TaskCallstackEntry[]): boolean {
  return entries.some((entry) => {
    if (
      entry.type === "INBOUND_REQUEST" ||
      entry.type === "FINAL_RESPONSE" ||
      entry.type === "LLM_TOOL_SELECTION" ||
      entry.type === "LLM_REASONING" ||
      entry.type === "LLM_REQUEST" ||
      entry.type === "LLM_RESPONSE" ||
      entry.type === "TOOL_EXECUTED" ||
      entry.type === "GRAPH_NODE" ||
      entry.type === "GRAPH_EXECUTION_START" ||
      entry.type === "GRAPH_TRANSITION"
    ) {
      return true;
    }
    if (
      entry.logger === "http-listener-config" ||
      entry.logger === "Loop" ||
      entry.logger === "INSECURE-LOGGING" ||
      entry.logger?.includes("module_graph_runtime")
    ) {
      return true;
    }
    const message = ((entry.raw?.message as string) ?? entry.summary ?? "") as string;
    return /Graph execution|module_graph_runtime|\[agent_[^\]]+\]/i.test(message);
  });
}

/**
 * Flex Gateway can be the only observable source for an A2A request. A terminal
 * gateway response already contains the completed task payload, so scanning
 * every AMC deployment for non-existent broker logs only adds latency.
 */
function hasSufficientCompletedGatewayTask(
  entries: TaskCallstackEntry[],
  taskId: string
): boolean {
  let matchingGatewayEntries = 0;
  let hasTerminalState = false;
  for (const entry of entries) {
    if (entry.type !== "GATEWAY") return false;
    const message = String((entry.raw?.message as string) ?? entry.summary ?? "");
    if (!message.includes(`"taskId":"${taskId}"`)) continue;
    matchingGatewayEntries++;
    if (/TASK_STATE_(COMPLETED|FAILED|CANCELED)|terminal state/i.test(message)) {
      hasTerminalState = true;
    }
  }
  // One gateway event is not enough to assume that broker runtime logs are
  // absent. Multiple task-scoped gateway entries plus a terminal response are
  // sufficient to avoid the costly AMC deployment scan.
  return matchingGatewayEntries >= 2 && hasTerminalState;
}

function graphMessageHead(message: string, maxLen = 120): string {
  return message.split(" : trace_id")[0].slice(0, maxLen);
}

function summarizeLine(type: string, message: string, fields: Record<string, unknown>): string {
  switch (type) {
    case "INBOUND_REQUEST":
      if (/^\[agent_[^\]]+\]\s+Received message:/.test(message)) {
        const agent = (fields.agent as string) || message.match(/^\[(agent_[^\]]+)\]/)?.[1] || "?";
        const lenMatch = message.match(/length=(\d+)/);
        return lenMatch ? `[${agent}] Received message (${lenMatch[1]} bytes)` : `[${agent}] Received message`;
      }
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
    case "TOOL_EXECUTED": {
      const toolName = ((fields.tool as string) || "?").replace(/^[a-zA-Z0-9]+_/, "");
      const nodePrefix = fields.graphNode ? `${fields.graphNode}: ` : "";
      if (/\] on_init: Tool .+ result received/.test(message)) {
        return `${nodePrefix}${toolName} result received`;
      }
      return `${nodePrefix}Executed: ${toolName}`;
    }
    case "TOOL_OUTPUT":
      return fields.toolOutputJson
        ? `Output: ${JSON.stringify(fields.toolOutputJson).slice(0, 200)}${JSON.stringify(fields.toolOutputJson).length > 200 ? "..." : ""}`
        : "Tool output";
    case "FINAL_RESPONSE":
      if (fields.responseText) {
        return fields.resultStatus
          ? `"${fields.responseText}" (${fields.resultStatus})`
          : `"${fields.responseText}"`;
      }
      if (/^Graph execution completed/.test(message)) return "Graph execution completed";
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
    case "GRAPH_EXECUTION_START": {
      const turnMatch = message.match(/turn_id: ([^)]+)/);
      return turnMatch ? `Execution started (${turnMatch[1]})` : "Graph execution started";
    }
    case "GRAPH_NODE":
      return fields.graphNode ? `Node: ${fields.graphNode}` : graphMessageHead(message, 100);
    case "GRAPH_NODE_COMPLETE": {
      const doneMatch = message.match(/Node (\S+) completed/);
      return doneMatch ? `${doneMatch[1]} completed` : "Node completed";
    }
    case "GRAPH_TRANSITION":
      return fields.graphNode ? `Transition → ${fields.graphNode}` : graphMessageHead(message, 100);
    case "LLM_REQUEST":
      return "OpenAI request";
    case "LLM_RESPONSE":
      return "OpenAI response";
    case "LLM_REASONING": {
      const reasoning = (fields.llmReasoning as string) || message.replace(/^LLM Reasoning was:\s*/, "").split(" : trace_id")[0].trim();
      return reasoning.length > 140 ? `${reasoning.slice(0, 140)}…` : reasoning;
    }
    case "GRAPH_PERF": {
      const perfMatch = message.match(/action '([^']+)' internal duration: ([\d.]+ms)/);
      return perfMatch ? `${perfMatch[1]}: ${perfMatch[2]}` : graphMessageHead(message, 100);
    }
    case "GRAPH_DEBUG":
      return graphMessageHead(message, 100);
    case "GRAPH_RUNTIME":
      return graphMessageHead(message);
    case "OTHER":
      return message.split("\n")[0].slice(0, 200);
    default:
      return message.split("\n")[0].slice(0, 200);
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
 * Search for trace spans by optional entity.name, envId, and time period.
 * Then scope to the ONE trace that matches this task's time window (so we don't mix multiple broker calls).
 */
async function searchTracesByEntityAndTime(
  orgId: string,
  envId: string,
  entityName: string | undefined,
  accessToken: string,
  baseUrl: string,
  startTime: string | number,
  endTime: string | number,
  /** Task's exact time window (ms) - we pick the trace that overlaps this the most */
  taskStartMs: number,
  taskEndMs: number
): Promise<{ spans: TraceSpanRow[]; status: TraceSpansStatus; traceId: string | null }> {
  if (!orgId || !envId || envId.trim() === "") {
    return { spans: [], status: "skipped", traceId: null };
  }

  try {
    const start = typeof startTime === "number" ? startTime : new Date(startTime).getTime();
    const end = typeof endTime === "number" ? endTime : new Date(endTime).getTime();
    // Keep the unfiltered fallback narrow so LIMIT 500 is not consumed by
    // unrelated applications in a busy environment.
    const padding = entityName?.trim() ? 30 * 60 * 1000 : 2 * 60 * 1000;
    const startTimeMs = Math.max(0, start - padding);
    const endTimeMs = end + padding;

    let whereClause = `"sub_org.id" = '${orgId}' AND "env.id" = '${envId}' AND timestamp BETWEEN ${startTimeMs} AND ${endTimeMs}`;
    if (entityName?.trim()) {
      whereClause += ` AND "entity.name" = '${entityName.trim()}'`;
    }
    const query = `SELECT "span_id" AS spanId, name, kind, "trace_id" AS traceId, "status_code" AS statusCode, "http.status_code" AS httpStatusCode, duration, "end_time_nano" AS endTime, "entity.id" AS entityId, "entity.name" AS entityName, "entity.type" AS entityType, "env.id" AS envId, "sub_org.id" AS orgId, "sub_org.name" AS orgName, "env.name" AS envName WHERE ${whereClause} ORDER BY timestamp ASC LIMIT 500`;
    
    debugLog(
      `[searchTracesByEntityAndTime] Searching for traces: entityName="${entityName?.trim() || "(unfiltered)"}", envId="${envId}", timeRange=${startTimeMs}-${endTimeMs}`
    );
    
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
    debugLog(
      `[searchTracesByEntityAndTime] ✓ Found ${allSpans.length} spans across ${uniqueTraceIds.size} unique traces for entityName="${entityName?.trim() || "(unfiltered)"}"`
    );

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
 * Lightweight runtime-log fetch for a deployment we've already resolved (via cached
 * resolveBrokerContext). Skips the RM-detail + AMC-list-by-name lookups that
 * getTaskDetailsFromRuntimeLogs performs internally, and uses the AMC logs `regexp`
 * param so the server filters to matching lines instead of transferring up to 1000
 * lines for client-side filtering.
 */
async function fetchAndParseRuntimeLogsForDeployment(
  orgId: string,
  envId: string,
  deploymentId: string,
  accessToken: string,
  baseUrl: string,
  taskId: string,
  taskStartHint?: string | number
): Promise<{ entries: unknown[]; jobCard: unknown } | null> {
  try {
    const specId = await resolveSpecIdForTask(
      orgId,
      envId,
      deploymentId,
      accessToken,
      baseUrl,
      taskStartHint
    );
    if (!specId) {
      debugLog("[TASK-CALLSTACK] fetchAndParseRuntimeLogsForDeployment: no usable specId for this task");
      return null;
    }

    const logsUrl = buildAmcLogsUrl({
      baseUrl,
      organizationId: orgId,
      environmentId: envId,
      deploymentId,
      specificationId: specId,
      search: { length: 200, descending: true, regexp: taskId },
    });
    const logsRes = await loggedFetch(logsUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!logsRes.ok) {
      debugLog(`[TASK-CALLSTACK] fetchAndParseRuntimeLogsForDeployment: logs fetch ${logsRes.status}`);
      return null;
    }

    const contentType = logsRes.headers.get("content-type") || "";
    let logsText: string;
    if (contentType.includes("application/json")) {
      const logEntries = (await logsRes.json()) as Array<{ timestamp?: number; message?: string }>;
      logsText = Array.isArray(logEntries)
        ? logEntries
            .map((e) => `${e.timestamp != null ? new Date(e.timestamp).toISOString() : ""} ${e.message ?? ""}`.trim())
            .filter((l) => l.length > 0)
            .join("\n")
        : "";
    } else {
      logsText = await logsRes.text();
    }
    if (!logsText.includes(taskId)) {
      debugLog("[TASK-CALLSTACK] fetchAndParseRuntimeLogsForDeployment: filtered logs don't contain taskId");
      return null;
    }
    return parseRuntimeLogsToEntriesAndJobCard(logsText, taskId);
  } catch (error) {
    debugLog("[TASK-CALLSTACK] fetchAndParseRuntimeLogsForDeployment error:", error);
    return null;
  }
}

async function resolveSpecIdForTask(
  orgId: string,
  envId: string,
  deploymentId: string,
  accessToken: string,
  baseUrl: string,
  taskStartHint?: string | number
): Promise<string | null> {
  const specsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/specs`;
  try {
    const specsRes = await loggedFetch(specsUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (specsRes.ok) {
      const specs = (await specsRes.json()) as AmcSpecDescriptor[];
      if (Array.isArray(specs) && specs.length > 0) {
        const chosen = chooseSpecIdAtOrBefore(specs, parseEpochMs(taskStartHint));
        if (chosen) return chosen;
      }
    }
  } catch {
    // Ignore and fall back to deployment detail.
  }

  const detailRes = await loggedFetch(
    `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}`,
    { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!detailRes.ok) return null;
  const detail = (await detailRes.json()) as { desiredVersion?: string; replicas?: Array<{ id: string }> };
  return detail.desiredVersion ?? detail.replicas?.[0]?.id ?? null;
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

  // AMC requests use descending order. Normalize task events to chronological
  // order before deriving iterations, the task start/end, or its duration.
  // Otherwise the newest event becomes the "start" and produces a negative
  // duration (as observed for task 53d61cbe…).
  entries.sort((a, b) => {
    const aTimestamp = new Date(String((a as { timestamp?: string }).timestamp ?? "")).getTime();
    const bTimestamp = new Date(String((b as { timestamp?: string }).timestamp ?? "")).getTime();
    return aTimestamp - bTimestamp;
  });
  entries.forEach((entry, index) => {
    (entry as { index: number }).index = index;
  });

  assignTaskIterations(entries as IterationAssignableEntry[]);
  const assignedEntries = entries as IterationAssignableEntry[];
  debugLog(
    `[TASK-CALLSTACK] Runtime parse iteration assignment: max=${deriveMaxIteration(assignedEntries)}, tools=${collectToolNames(assignedEntries).join(", ") || "none"}`
  );

  const inbound = entries.find((e: unknown) => (e as { type?: string }).type === "INBOUND_REQUEST");
  const finalResp = entries.find((e: unknown) => (e as { type?: string }).type === "FINAL_RESPONSE");
  const toolSelections = entries.filter((e: unknown) => (e as { type?: string }).type === "LLM_TOOL_SELECTION");
  const toolExecutions = entries.filter((e: unknown) => (e as { type?: string }).type === "TOOL_EXECUTED");
  const maxIter = deriveMaxIteration(entries as IterationAssignableEntry[]);
            const firstEntry = entries[0] as { timestamp?: string | number };
            const lastEntry = entries[entries.length - 1] as { timestamp?: string | number };
            let duration: string | null = null;
            if (firstEntry && lastEntry) {
              const t1 = typeof firstEntry.timestamp === "number" ? firstEntry.timestamp : new Date(firstEntry.timestamp || "").getTime();
              const t2 = typeof lastEntry.timestamp === "number" ? lastEntry.timestamp : new Date(lastEntry.timestamp || "").getTime();
              duration = ((t2 - t1) / 1000).toFixed(1);
            }
  // maxIter already calculated above from parsed log fields
  const toolStrings = collectToolNames(entries as IterationAssignableEntry[]);
            const allTools: string[] = toolStrings;
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
    taskStory?: unknown;
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
  const retentionCheck = isTaskOlderThanObjectStoreRetention(
    jobCard.startTime,
    resolvedDeploymentId != null
      ? getKnownObjectStoreRetentionMs(orgId, envId, resolvedDeploymentId)
      : undefined
  );
  if (retentionCheck.skip) {
    const reason = describeRetentionSkip(retentionCheck);
    debugLog(`[NO-ENTITLEMENT] Skipping Object Store fetch - ${reason}`);
    return {
      objectStore: {
        available: false,
        errors: [`Object Store skipped: ${reason}`],
      },
      objectStoreApiStatus: "skipped",
    };
  }

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
    debugLog(
      "[NO-ENTITLEMENT] Attempting Object Store fetch - orgId, envId, taskId, brokerName, deploymentId, persistentObjectStore",
      orgId, envId, taskId, brokerName, deploymentId, deploymentDetail.persistentObjectStore
    );
    const objectStoreData = await fetchObjectStoreData(
      orgId,
      envId,
      taskId,
      brokerName,
      deploymentId,
      accessToken,
      undefined,
      objectStoreRegion
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
        taskStory: objectStoreData.taskStory,
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
/**
 * Bounded so a large environment cannot open dozens of AMC connections at once
 * — that trades one slow request for rate-limit errors across all of them.
 */
const DEPLOYMENT_PROBE_CONCURRENCY = 6;

/**
 * Look for a taskId across an environment's deployments, resolving with the
 * first deployment whose logs contain it. Workers share a cursor and stop as
 * soon as any of them finds a match, so the common case (the broker is one of
 * the first few probed) costs a couple of round trips rather than two per
 * deployment in the environment.
 */
async function probeDeploymentsForTask(
  orgId: string,
  envId: string,
  deployments: Array<{ id: string; name: string }>,
  accessToken: string,
  baseUrl: string,
  taskId: string,
  taskStartHint?: string | number
): Promise<{ entries: unknown[]; jobCard: unknown } | null> {
  let cursor = 0;
  let found: { entries: unknown[]; jobCard: unknown } | null = null;

  async function worker(): Promise<void> {
    while (found == null) {
      const index = cursor++;
      const deployment = deployments[index];
      if (deployment == null) return;
      try {
        const parsed = await fetchAndParseRuntimeLogsForDeployment(
          orgId,
          envId,
          deployment.id,
          accessToken,
          baseUrl,
          taskId,
          taskStartHint
        );
        if (parsed != null && found == null) {
          debugLog(
            `[NO-ENTITLEMENT] Found taskId in deployment: ${deployment.id} entries: ${parsed.entries.length}`
          );
          found = parsed;
          return;
        }
      } catch (error) {
        debugLog(`[NO-ENTITLEMENT] Error probing deployment ${deployment.id}:`, error);
      }
    }
  }

  const workerCount = Math.min(DEPLOYMENT_PROBE_CONCURRENCY, deployments.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return found;
}

async function getTaskDetailsFromRuntimeLogs(
  orgId: string,
  taskId: string,
  envId: string | null,
  accessToken: string,
  baseUrl: string,
  timeRangeMs: number,
  apiInstanceId?: string | null,
  taskStartHint?: string | number
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
          const specId = await resolveSpecIdForTask(
            orgId,
            envId,
            deploymentId,
            accessToken,
            baseUrl,
            taskStartHint
          );
          if (specId) {
              const safeLength = 1000;
              const logsUrl = buildAmcLogsUrl({
                baseUrl,
                organizationId: orgId,
                environmentId: envId,
                deploymentId,
                specificationId: specId,
                search: { length: safeLength, descending: true },
              });
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

        // Step 2: probe deployments for the taskId, concurrently and stopping
        // at the first hit. Serially walking an environment cost two round
        // trips per deployment (detail, then logs) and dominated the request.
        const parsed = await probeDeploymentsForTask(
          orgId,
          env.id,
          deployments,
          accessToken,
          baseUrl,
          taskId,
          taskStartHint
        );
        if (parsed) {
          return parsed;
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

const CALLSTACK_MAX_WINDOW_MS = 30 * 24 * 3600 * 1000;
/** Absorbs clock skew between the gateway, broker and log pipeline. */
const CALLSTACK_WINDOW_MARGIN_MS = 15 * 60 * 1000;

/**
 * Log search takes a lookback relative to now, not an absolute range, so the
 * best we can do with a known task start is shrink the lookback to "far enough
 * back to include this task". For a task from an hour ago that is a ~75-minute
 * window instead of 30 days.
 */
function resolveCallstackWindow(
  startTimeHint: string | undefined,
  endTimeHint: string | undefined
): { timeRange: number; windowSource: string } {
  if (!startTimeHint) {
    return { timeRange: CALLSTACK_MAX_WINDOW_MS, windowSource: "30 days, no task start supplied" };
  }
  const startMs = new Date(startTimeHint).getTime();
  if (!Number.isFinite(startMs)) {
    return { timeRange: CALLSTACK_MAX_WINDOW_MS, windowSource: "30 days, unparseable task start" };
  }
  // An end time in the future (or a still-running task) just widens the margin.
  const endMs = endTimeHint ? new Date(endTimeHint).getTime() : Number.NaN;
  const latest = Number.isFinite(endMs) ? Math.max(startMs, endMs) : startMs;
  const lookback = Date.now() - startMs + CALLSTACK_WINDOW_MARGIN_MS + (latest - startMs);
  if (lookback <= 0 || lookback > CALLSTACK_MAX_WINDOW_MS) {
    return { timeRange: CALLSTACK_MAX_WINDOW_MS, windowSource: "30 days, task older than the cap" };
  }
  return { timeRange: lookback, windowSource: `${Math.round(lookback / 60000)} min, scoped to task start` };
}

export async function GET(request: NextRequest) {
  debugLog("=".repeat(80));
  debugLog("[TASK-CALLSTACK] ========== START GET REQUEST ==========");
  const timer = new PhaseTimer("task-callstack");
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
  debugLog(`[TASK-CALLSTACK] baseUrl: ${baseUrl}`);
  debugLog(`[TASK-CALLSTACK] accessToken: ${accessToken ? "present" : "missing"} (${accessToken?.length || 0} chars)`);
  debugLog(`[TASK-CALLSTACK] monitoringProductSKU: ${session.monitoringProductSKU ?? "unknown"}`);
  
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId");
  const taskId = searchParams.get("taskId");
  // Convert null to undefined for optional parameters (Zod expects undefined, not null)
  const apiInstanceId = searchParams.get("apiInstanceId") || undefined;
  const envId = searchParams.get("envId") || undefined;
  const skipTracesParam = searchParams.get("skipTraces") ?? undefined;
  const appIdHint = searchParams.get("appId") || undefined;
  const startTimeHint = searchParams.get("startTime") || undefined;
  const endTimeHint = searchParams.get("endTime") || undefined;

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
    appId: appIdHint,
    startTime: startTimeHint,
    endTime: endTimeHint,
  });
  
  if (!parseResult.success) {
    debugLog(`[TASK-CALLSTACK] ✗ Validation failed: ${JSON.stringify(parseResult.error.format())}`);
    return validationError(parseResult.error);
  }
  debugLog("[TASK-CALLSTACK] ✓ Validation successful");
  
  const {
    orgId: validatedOrgId,
    taskId: validatedTaskId,
    apiInstanceId: validatedApiInstanceId,
    envId: validatedEnvId,
    skipTraces: skipTracesRequested,
    appId: validatedAppIdHint,
    startTime: validatedStartTimeHint,
    endTime: validatedEndTimeHint,
  } = parseResult.data;
  debugLog(`[TASK-CALLSTACK] Validated orgId: ${validatedOrgId}`);
  debugLog(`[TASK-CALLSTACK] Validated taskId: ${validatedTaskId}`);
  debugLog(`[TASK-CALLSTACK] Validated apiInstanceId: ${validatedApiInstanceId ?? "undefined"}`);
  debugLog(`[TASK-CALLSTACK] Validated envId: ${validatedEnvId ?? "undefined"}`);
  debugLog(`[TASK-CALLSTACK] Validated skipTraces: ${skipTracesRequested ?? false}`);

  // Entitlement is decided for the *queried* org, not a login-time flag.
  const hasMsearch = await isOrgLogSearchEntitled(baseUrl, validatedOrgId, accessToken);
  debugLog(`[TASK-CALLSTACK] logSearchEntitled (per-org): ${hasMsearch}`);

  // Phase 1 searches the tenant's whole log index for a taskId that only exists
  // inside `message` text, so the window is the dominant cost. When the caller
  // passes the task's own start/end (the task row already knows them), collapse
  // 30 days to the task's lifetime plus a margin for clock skew and late lines.
  const { timeRange, windowSource } = resolveCallstackWindow(
    validatedStartTimeHint,
    validatedEndTimeHint
  );
  debugLog(`[TASK-CALLSTACK] Time range: ${timeRange}ms (${windowSource})`);

  // Resolve broker context (RM detail + AMC list-by-name) once up front, in parallel with
  // msearch below. Both the runtime-log supplement and the deployment-context pipeline
  // (Steps 11-13) need this — caching avoids doing the same 2 network round trips twice.
  const brokerContextPromise: Promise<BrokerContext | null> =
    validatedApiInstanceId && validatedEnvId
      ? resolveBrokerContext(validatedOrgId, validatedEnvId, validatedApiInstanceId, accessToken, baseUrl, loggedFetch).catch(
          (error) => {
            debugLog("[TASK-CALLSTACK] Cached resolveBrokerContext failed:", error);
            return null;
          }
        )
      : Promise.resolve(null);

  try {
    // Phase 1: search by taskId — only when org has Log Search (productSKU === 1)
    // `appId` is a mapped, indexed field, so adding it turns a full-text scan of
    // the tenant index into a filtered one. Both the broker's own appId and the
    // gateway's `_api_version_<apiInstanceId>` records are needed — the tree view
    // parses gateway entries — so filter on the set, never a single value.
    const phase1AppIds = [
      ...new Set(
        [
          validatedAppIdHint,
          validatedApiInstanceId ? `_api_version_${validatedApiInstanceId}` : undefined,
        ].filter((value): value is string => Boolean(value))
      ),
    ];
    const appIdClause =
      phase1AppIds.length > 0 ? ` AND appId:(${phase1AppIds.join(" OR ")})` : "";
    let phase1Query = `orgId=${validatedOrgId}${appIdClause} AND "${escapeLucenePhrase(validatedTaskId)}"`;
    // Set when phase 1 had to drop its narrowing to find anything, so phase 2
    // searches the same scope instead of re-applying a filter we know excludes
    // this task's documents.
    let searchWidened = false;
    const phase1 = hasMsearch
      ? await timer.measure("phase1-log-search", async () => {
          debugLog("[TASK-CALLSTACK] Step 4: Phase 1 - Searching logs by taskId...");
          debugLog(`[TASK-CALLSTACK] Phase 1 query: ${phase1Query}`);
          debugLog(`[TASK-CALLSTACK] Phase 1 timeRange: ${timeRange}ms`);
          let result = await msearch(validatedOrgId, phase1Query, { timeRangeMs: timeRange, envId: validatedEnvId ?? undefined }, accessToken, baseUrl);

          // The narrowing above is a hint, not a guarantee: a broker can log
          // under an appId we did not predict, and `envId` is only a filter for
          // documents the shipper actually tagged. Rather than let a bad hint
          // drop us into the much slower runtime-log fallback, widen once here —
          // dropping both the appId clause and the environment filter.
          const hadNarrowing = appIdClause !== "" || validatedEnvId != null;
          if (!result.error && (result.hits?.length ?? 0) === 0 && hadNarrowing) {
            phase1Query = `orgId=${validatedOrgId} AND "${escapeLucenePhrase(validatedTaskId)}"`;
            searchWidened = true;
            debugLog(`[TASK-CALLSTACK] Phase 1 narrowed query found nothing — retrying unfiltered: ${phase1Query}`);
            result = await msearch(validatedOrgId, phase1Query, { timeRangeMs: timeRange }, accessToken, baseUrl);
          }

          debugLog(`[TASK-CALLSTACK] Phase 1 result: ${result.hits?.length || 0} hits, error: ${result.error || "none"}`);
          if (result.hits?.length > 0) {
            const first = result.hits[0] as { _source?: { appId?: string; [key: string]: unknown } };
            const src = first._source || {};
            const firstAppId = (src.appId as string) || "undefined";
            const firstApiInstanceId = (src.apiInstanceId as string) || (typeof src.fields === "object" && src.fields && typeof (src.fields as Record<string, unknown>).apiInstanceId === "string" ? (src.fields as Record<string, unknown>).apiInstanceId : "undefined");
            debugLog(`[KEY_FACTS] msearch Phase 1: hitCount=${result.hits.length}, firstHit.appId=${firstAppId}, firstHit.apiInstanceId=${String(firstApiInstanceId)}`);
          }
          return result;
        })
      : { total: 0, hits: [] as unknown[], raw: {}, error: "MONITORING_CENTER_PREMIUM_REQUIRED" as const };

    if (!hasMsearch) {
      debugLog("[TASK-CALLSTACK] Skipping msearch (monitoringCenterEnabled=false)");
    }

    // Runtime-log fallback: when Log Search is unavailable, or when entitled but
    // the task is not indexed yet (empty msearch hits).
    const titaniumOrg = orgHasTitaniumMonitoring(session);
    const msearchUnavailable =
      phase1.error === "MSEARCH_UNAVAILABLE" ||
      phase1.error === "MONITORING_CENTER_PREMIUM_REQUIRED";
    const msearchHadNoHits = hasMsearch && !phase1.error && (phase1.hits?.length ?? 0) === 0;
    const lacksLogSearch = !hasMsearch || msearchUnavailable;
    if (lacksLogSearch || msearchHadNoHits) {
      if (msearchHadNoHits) {
        debugLog("[TASK-CALLSTACK] msearch returned 0 hits — falling through to runtime logs");
      }
      const runtimeFallbackMode =
        lacksLogSearch && !titaniumOrg ? "no-entitlement" : "entitlement";
      debugLog(
        `[TASK-CALLSTACK] Decision: runtime-log fallback (mode=${runtimeFallbackMode}, lacksLogSearch=${lacksLogSearch}, titaniumOrg=${titaniumOrg})`
      );
      debugLog("[RUNTIME-FALLBACK] Getting task details from runtime logs");
      const runtimeLogsResult = await getTaskDetailsFromRuntimeLogs(
        validatedOrgId,
        validatedTaskId,
        validatedEnvId ?? null,
        accessToken,
        baseUrl,
        timeRange,
        validatedApiInstanceId ?? undefined,
        validatedStartTimeHint
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
          const runtimeFallbackApiStatus: ApiStatus = {
            logSearch:
              phase1.error === "MSEARCH_UNAVAILABLE" || (lacksLogSearch && titaniumOrg)
                ? "404_unavailable"
                : lacksLogSearch
                  ? "403_entitlement"
                  : "error",
            objectStore: objectStoreApiStatus,
            deploymentApi: noEntDeploymentApiStatus,
            traceSpans: "skipped",
            monitoringSuggestions,
          };
          if (noEntAmc403Error) {
            debugLog(`[RUNTIME-FALLBACK] AMC 403 Error preserved: ${noEntAmc403Error.substring(0, 200)}...`);
          }
        return NextResponse.json({
            jobCard: { ...jobCardFromRuntime, objectStore, apiStatus: runtimeFallbackApiStatus },
            entries: runtimeLogsResult.entries,
            traceSpans: [],
          rawQueries: { phase1: phase1Query, phase2: null, traceId: null },
            mode: runtimeFallbackMode,
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
      debugLog(`[TASK-CALLSTACK] Hit ${i}: checking for traceId in message (length: ${message.length})`);
      const extractedTraceId = extractTraceIdFromMessage(message);
      if (extractedTraceId) {
        traceId = extractedTraceId;
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
      phase2Query = `orgId=${validatedOrgId} AND ("${escapeLucenePhrase(traceId)}" OR "${escapeLucenePhrase(validatedTaskId)}")`;
      debugLog(`[TASK-CALLSTACK] Phase 2 query: ${phase2Query}`);
      const phase2 = await msearch(
        validatedOrgId,
        phase2Query,
        { timeRangeMs: timeRange, ...(searchWidened ? {} : { envId: validatedEnvId ?? undefined }) },
        accessToken,
        baseUrl
      );
      debugLog(`[TASK-CALLSTACK] Phase 2 result: ${phase2.hits?.length || 0} hits, error: ${phase2.error || "none"}`);
      if (phase2.hits?.length > 0) {
        const first2 = phase2.hits[0] as { _source?: { appId?: string; [key: string]: unknown } };
        const src2 = first2._source || {};
        const firstAppId2 = (src2.appId as string) || "undefined";
        const firstApiInstanceId2 = (src2.apiInstanceId as string) || (typeof src2.fields === "object" && src2.fields && typeof (src2.fields as Record<string, unknown>).apiInstanceId === "string" ? (src2.fields as Record<string, unknown>).apiInstanceId : "undefined");
        debugLog(`[KEY_FACTS] msearch Phase 2: hitCount=${phase2.hits.length}, firstHit.appId=${firstAppId2}, firstHit.apiInstanceId=${String(firstApiInstanceId2)}`);
      }
      
      // Runtime-log fallback when phase 2 hits an entitlement error.
      if (phase2.error === "MONITORING_CENTER_PREMIUM_REQUIRED" || phase2.error === "MSEARCH_UNAVAILABLE") {
        const titaniumOrg = orgHasTitaniumMonitoring(session);
        const phase2FallbackMode = titaniumOrg || hasMsearch ? "entitlement" : "no-entitlement";
        debugLog(
          `[TASK-CALLSTACK] Decision: phase2 ${phase2.error} — runtime fallback (mode=${phase2FallbackMode})`
        );
        const runtimeLogsResult = await getTaskDetailsFromRuntimeLogs(
          validatedOrgId,
          validatedTaskId,
          validatedEnvId ?? null,
          accessToken,
          baseUrl,
          timeRange,
          validatedApiInstanceId ?? undefined,
          validatedStartTimeHint
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
          const phase2FallbackApiStatus: ApiStatus = {
            logSearch:
              phase2.error === "MSEARCH_UNAVAILABLE"
                ? "404_unavailable"
                : phase2.error === "MONITORING_CENTER_PREMIUM_REQUIRED"
                  ? "403_entitlement"
                  : "error",
            objectStore: objectStoreApiStatus,
            deploymentApi: noEntDeploymentApiStatus2,
            traceSpans: "skipped",
            monitoringSuggestions,
          };
          if (noEntAmc403Error2) {
            debugLog(`[RUNTIME-FALLBACK] AMC 403 Error preserved: ${noEntAmc403Error2.substring(0, 200)}...`);
          }
          return NextResponse.json({
            jobCard: { ...jobCardFromRuntime, objectStore, apiStatus: phase2FallbackApiStatus },
            entries: runtimeLogsResult.entries,
            traceSpans: [],
            rawQueries: { phase1: phase1Query, phase2: phase2Query, traceId },
            mode: phase2FallbackMode,
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
    let entries = unique.map((h: unknown, i: number) => {
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

    // Log Search often indexes the Flex Gateway line before broker runtime logs.
    // Supplement with AMC runtime logs so refresh matches the initial runtime-log view.
    const completedGatewayTask = hasSufficientCompletedGatewayTask(entries, validatedTaskId);
    if (!hasBrokerRuntimeLogs(entries) && !completedGatewayTask) {
      debugLog("[TASK-CALLSTACK] Log Search hits lack broker runtime logs — supplementing from AMC runtime logs");
      const supplementDone = timer.start("runtime-log-supplement");
      let runtimeSupplement: { entries: unknown[]; jobCard: unknown } | null = null;
      const cachedBrokerContext = await brokerContextPromise;
      if (cachedBrokerContext?.deploymentId && validatedEnvId) {
        debugLog(
          `[TASK-CALLSTACK] Using cached broker context for supplement: deploymentId=${cachedBrokerContext.deploymentId}`
        );
        runtimeSupplement = await timer.measure("supplement-broker-deployment", () =>
          fetchAndParseRuntimeLogsForDeployment(
            validatedOrgId,
            validatedEnvId,
            cachedBrokerContext.deploymentId,
            accessToken,
            baseUrl,
            validatedTaskId,
            validatedStartTimeHint
          )
        );
      }
      // Full discovery scans every deployment in the environment, which is only
      // worth its cost when we don't know where the broker runs. If we already
      // asked the broker's own deployment for this taskId and it said no, no
      // other deployment can answer yes — the task is the broker's, so a miss
      // means AMC has rotated the logs away, not that we asked the wrong app.
      const probedBrokerDeployment =
        cachedBrokerContext?.deploymentId != null && validatedEnvId != null;
      if (!runtimeSupplement && !probedBrokerDeployment) {
        debugLog("[TASK-CALLSTACK] Falling back to full runtime-log discovery for supplement");
        runtimeSupplement = await timer.measure("supplement-full-discovery", () =>
          getTaskDetailsFromRuntimeLogs(
            validatedOrgId,
            validatedTaskId,
            validatedEnvId ?? null,
            accessToken,
            baseUrl,
            timeRange,
            validatedApiInstanceId ?? undefined,
            validatedStartTimeHint
          )
        );
      } else if (!runtimeSupplement) {
        debugLog(
          `[TASK-CALLSTACK] Skipping full runtime-log discovery — broker deployment ${cachedBrokerContext?.deploymentId} already probed for this taskId`
        );
      }
      supplementDone();
      if (runtimeSupplement && runtimeSupplement.entries.length > 0) {
        const beforeCount = entries.length;
        entries = mergeTaskCallstackEntries(entries, runtimeSupplement.entries as typeof entries);
        debugLog(
          `[TASK-CALLSTACK] Merged AMC runtime logs: ${beforeCount} log-search + ${runtimeSupplement.entries.length} runtime -> ${entries.length} total`
        );
        debugLog(`[TASK-CALLSTACK] Entry types breakdown after merge: ${JSON.stringify(
          entries.reduce((acc: Record<string, number>, e: typeof entries[0]) => {
            acc[e.type] = (acc[e.type] || 0) + 1;
            return acc;
          }, {})
        )}`);
      } else {
        debugLog("[TASK-CALLSTACK] AMC runtime log supplement returned no entries");
      }
    } else if (completedGatewayTask) {
      debugLog(
        "[TASK-CALLSTACK] Completed gateway task found — skipping AMC runtime-log supplement"
      );
    }

    // Derive iterations — v1 uses iteration=N tags; v2 graph logs are synthesized.
    assignTaskIterations(entries);
    const maxIter = deriveMaxIteration(entries);
    debugLog(
      `[TASK-CALLSTACK] Iteration assignment: max=${maxIter}, breakdown=${JSON.stringify(
        entries.reduce((acc: Record<string, number>, e: typeof entries[0]) => {
          const iter = String(e.fields?.iteration ?? "none");
          acc[iter] = (acc[iter] || 0) + 1;
          return acc;
        }, {})
      )}`
    );

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
    const toolStrings = collectToolNames(entries);
    const allTools: string[] = toolStrings;
    debugLog(`[TASK-CALLSTACK] Max iteration: ${maxIter}, Tools: ${allTools.join(", ") || "none"}`);

    const brokerName: string = String((entries.find((e: typeof entries[0]) => e.fields.agent) || {}).fields?.agent ?? "");
    const appId = (entries.find((e: typeof entries[0]) => e.appId && !e.appId.startsWith("_")) || {}).appId || "";
    const apiInstanceId: string = String((entries.find((e: typeof entries[0]) => e.fields.apiInstanceId) || {}).fields?.apiInstanceId || "");
    debugLog(`[KEY_FACTS] Extracted from log entries: brokerName="${brokerName}", appId="${appId}", apiInstanceId="${apiInstanceId}"`);
    debugLog(`[TASK-CALLSTACK] Extracted from entries: brokerName="${brokerName}", appId="${appId}", apiInstanceId="${apiInstanceId}"`);

    // Functional Pipeline: Resolve Deployment Context (Steps 11-13)
    debugLog("[TASK-CALLSTACK] Steps 11-13: Resolving deployment context via functional pipeline...");
    // Reuse the broker context resolved up front (shared with the runtime-log supplement
    // above, or already in flight) instead of letting Resolver 2 refetch it.
    const cachedBrokerContextForPipeline =
      validatedApiInstanceId && validatedEnvId ? await brokerContextPromise : undefined;
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
      precomputedDeploymentContext:
        cachedBrokerContextForPipeline === undefined
          ? undefined
          : cachedBrokerContextForPipeline
            ? {
                id: cachedBrokerContextForPipeline.deploymentId,
                type: cachedBrokerContextForPipeline.deploymentType,
                resolvedName: cachedBrokerContextForPipeline.appName,
                source: "broker_resolution",
                amc403Error: null,
                deploymentApiStatus: "not_used",
              }
            : null,
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
    const objectStoreRetentionCheck = isTaskOlderThanObjectStoreRetention(
      firstEntry?.timestamp,
      validatedEnvId != null && deploymentId != null
        ? getKnownObjectStoreRetentionMs(validatedOrgId, validatedEnvId, deploymentId)
        : undefined
    );
    const objectStoreDecision =
      objectStoreRetentionCheck.skip
        ? `Skipping Object Store - ${describeRetentionSkip(objectStoreRetentionCheck)}`
        : validatedEnvId && deploymentId
          ? "Will fetch Object Store"
          : `Skipping Object Store - missing: ${!validatedEnvId ? "envId " : ""}${!deploymentId ? "deploymentId" : ""}`;
    debugLog(`[TASK-CALLSTACK] Decision: ${objectStoreDecision}`);
    
    // Fetch Object Store data if we have envId and deployment ID (brokerName can be empty - we'll still get no_store/403/no_keys from client)
    let objectStoreData: {
      available: boolean;
      objectStoreStatus?: "ok" | "403_forbidden" | "no_store" | "no_keys";
      fromTasks?: { steps: Array<{ step: string; content: string[] }>; rawReasoning: string[] };
      llmReasoning?: {
        steps?: Array<{ step: string; content: string[] }>;
        rawReasoning?: string[];
      };
      taskStory?: TaskStory;
      toolCallIds?: string[];
      downstreamContextIds?: Array<{ agent: string; contextId: string; taskId: string }>;
      errors?: string[];
      debug?: {
        tasks: {
          partition: string | null;
          keyFound: boolean;
          keyUsed: string | null;
          valueEmpty: boolean;
          stringCount: number;
          brokerFormat?: "v1" | "v2";
          valueType?: "BINARY" | "STRING" | null;
        };
      };
    } = { available: false };

    // Prepare Object Store fetch promise (returns result + optional monitoring from same deployment GET, no extra call)
    // IMMUTABILITY: Return updated deploymentApiStatus from promise to avoid mutation
    const objectStoreDone = timer.start("object-store");
    const objectStorePromise = (async (): Promise<{
      result: typeof objectStoreData;
      monitoringSuggestions?: ApiStatus["monitoringSuggestions"];
      deploymentApiStatus?: ApiStatus["deploymentApi"];
    }> => {
      const taskStartTime = firstEntry?.timestamp;
      const retentionCheck = isTaskOlderThanObjectStoreRetention(
        taskStartTime,
        validatedEnvId != null && deploymentId != null
          ? getKnownObjectStoreRetentionMs(validatedOrgId, validatedEnvId, deploymentId)
          : undefined
      );
      if (retentionCheck.skip) {
        const reason = describeRetentionSkip(retentionCheck);
        timer.note("osOutcome", "retention-skip");
        debugLog(`[ObjectStore] Skipping Object Store fetch - ${reason}`);
        return {
          result: {
            available: false,
            errors: [`Object Store skipped: ${reason}`],
          },
          deploymentApiStatus: deploymentApiStatus,
        };
      }
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
            monitoringSuggestions = { insecureLogging: false };
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
          debugLog(`[TASK-CALLSTACK] Calling fetchObjectStoreData with:`);
          debugLog(`[TASK-CALLSTACK]   - orgId: ${validatedOrgId}`);
          debugLog(`[TASK-CALLSTACK]   - envId: ${validatedEnvId}`);
          debugLog(`[TASK-CALLSTACK]   - taskId: ${validatedTaskId}`);
          debugLog(`[TASK-CALLSTACK]   - brokerName: ${brokerName || "empty"}`);
          debugLog(`[TASK-CALLSTACK]   - deploymentId: ${deploymentId}`);
          debugLog(`[TASK-CALLSTACK]   - deploymentType: ${deploymentType || "unknown"}`);
          debugLog(`[TASK-CALLSTACK]   - objectStoreRegion: ${objectStoreRegion ?? "(none)"}`);
          debugLog(`[TASK-CALLSTACK]   - taskStartTime: ${taskStartTime ?? "undefined"}`);
          debugLog(
            `[TASK-CALLSTACK]   - persistentObjectStore (AMC diagnostic only): ${deploymentDetail?.persistentObjectStore ?? "undefined"}`
          );
          const result = await fetchObjectStoreData(
          validatedOrgId,
          validatedEnvId,
          validatedTaskId,
          brokerName,
          deploymentId,
            accessToken,
            deploymentType,
            objectStoreRegion,
            timer
          );
          timer.note("osOutcome", result.objectStoreStatus ?? (result.available ? "ok" : "unavailable"));
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
        timer.note("osOutcome", is403 ? "403-forbidden" : "error");
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
        timer.note("osOutcome", skipReason.replace(/\s+/g, "-"));
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
    // Prefer the traceId extracted from logs. In v2, Observability entity.name is
    // commonly a deployment UUID rather than the human-readable application name.
    const tracesDone = timer.start("traces");
    const traceSpansPromise = (async (): Promise<{ spans: TraceSpanRow[]; status: TraceSpansStatus; traceId: string | null }> => {
      if (!skipTracesRequested && validatedEnvId && validatedEnvId.trim() !== "" && accessToken && firstEntry && lastEntry) {
        if (traceId) {
          debugLog(`[TASK-CALLSTACK] Fetching trace spans directly by traceId="${traceId}"`);
          const direct = await fetchTraceSpans(
            validatedOrgId,
            traceId,
            accessToken,
            baseUrl,
            validatedEnvId,
            firstEntry.timestamp,
            lastEntry.timestamp
          );
          return { ...direct, traceId: null };
        }

        const entityNamesForSearch = Array.from(
          new Set(
            [deploymentId, appNameForDeploymentDetail, finalAppId]
              .map((value) => value?.trim())
              .filter((value): value is string => Boolean(value))
          )
        );
        if (entityNamesForSearch.length > 0) {
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

          let lastResult: { spans: TraceSpanRow[]; status: TraceSpansStatus; traceId: string | null } = {
            spans: [],
            status: "ok",
            traceId: null,
          };
          for (const entityName of entityNamesForSearch) {
            debugLog(
              `[TASK-CALLSTACK] Searching for traces by entityName="${entityName}", envId="${validatedEnvId}", timeRange=${firstEntry.timestamp}-${lastEntry.timestamp}`
            );
            lastResult = await searchTracesByEntityAndTime(
              validatedOrgId,
              validatedEnvId,
              entityName,
              accessToken,
              baseUrl,
              firstEntry.timestamp,
              lastEntry.timestamp,
              taskStartMs,
              taskEndMs
            );
            if (lastResult.spans.length > 0 || lastResult.status !== "ok") return lastResult;
          }
          debugLog(
            `[TASK-CALLSTACK] No configured entity key matched; searching all Observability entities in the task time window`
          );
          return await searchTracesByEntityAndTime(
            validatedOrgId,
            validatedEnvId,
            undefined,
            accessToken,
            baseUrl,
            firstEntry.timestamp,
            lastEntry.timestamp,
            taskStartMs,
            taskEndMs
          );
        } else {
          debugLog(
            `[TASK-CALLSTACK] No entity key is available; searching all Observability entities in the task time window`
          );
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
          return await searchTracesByEntityAndTime(
            validatedOrgId,
            validatedEnvId,
            undefined,
            accessToken,
            baseUrl,
            firstEntry.timestamp,
            lastEntry.timestamp,
            taskStartMs,
            taskEndMs
          );
        }
      }
      return { spans: [], status: "skipped" as TraceSpansStatus, traceId: null };
    })();

    // Execute both fetches in parallel
    const [objectStorePayload, traceSpansResult] = await Promise.all([
      objectStorePromise.finally(objectStoreDone),
      traceSpansPromise.finally(tracesDone),
    ]);
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
    // Safe debug mode only: one greppable outcome line per lookup, pairing with the
    // [ObjectStore][PROBE-CONTEXT] block so a cross-org "no keys" can be diagnosed
    // (and re-probed) straight from the log.
    debugLog(
      "[ObjectStore][PROBE-RESULT]",
      JSON.stringify(
        {
          taskId: validatedTaskId,
          orgId: validatedOrgId,
          envId: validatedEnvId,
          deploymentId: deploymentId ?? null,
          brokerName: brokerName || null,
          status: objectStoreStatus,
          available: objectStoreData.available,
          taskPartition: objectStoreData.debug?.tasks?.partition ?? null,
          keyFound: objectStoreData.debug?.tasks?.keyFound ?? null,
          keyUsed: objectStoreData.debug?.tasks?.keyUsed ?? null,
          brokerFormat: objectStoreData.debug?.tasks?.brokerFormat ?? null,
          hasTaskStory: Boolean(objectStoreData.taskStory),
          errors: objectStoreData.errors ?? [],
        },
        null,
        2
      )
    );
    // Use only deployment/config-based suggestions for "Set" so we don't show "Set" when
    // the app merely emits logs with those logger/class names (e.g. INSECURE-LOGGING, broker Loop).
    debugLog(`[TASK-CALLSTACK] Building monitoringSuggestions from objectStorePayload:`);
    debugLog(`[TASK-CALLSTACK]   - objectStorePayload.monitoringSuggestions: ${JSON.stringify(objectStorePayload.monitoringSuggestions ?? "undefined")}`);
    debugLog(`[TASK-CALLSTACK]   - objectStorePayload.monitoringSuggestions?.insecureLogging: ${objectStorePayload.monitoringSuggestions?.insecureLogging ?? "undefined"} (strict === true check: ${objectStorePayload.monitoringSuggestions?.insecureLogging === true})`);
    const monitoringSuggestions: ApiStatus["monitoringSuggestions"] = {
      insecureLogging: objectStorePayload.monitoringSuggestions?.insecureLogging === true,
    };
    debugLog(`[TASK-CALLSTACK] Final monitoringSuggestions: insecureLogging=${monitoringSuggestions.insecureLogging}`);
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
      // Primary Exchange identity from API Manager metadata.source (URN), when available.
      sourceAssetId: cachedBrokerContextForPipeline?.sourceMetadata?.assetId,
      sourceGroupId: cachedBrokerContextForPipeline?.sourceMetadata?.groupId,
      sourceVersion: cachedBrokerContextForPipeline?.sourceMetadata?.version,
      sourceUrn: cachedBrokerContextForPipeline?.sourceMetadata?.urn,
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

    timer.logSummary();
    return NextResponse.json(
      {
        jobCard,
        entries,
        traceSpans,
        rawQueries: { phase1: phase1Query, phase2: phase2Query, traceId },
      },
      { headers: { "Server-Timing": timer.toServerTiming() } }
    );
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
