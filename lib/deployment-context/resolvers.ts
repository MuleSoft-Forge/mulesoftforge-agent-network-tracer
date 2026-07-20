/**
 * Functional Pipeline: Deployment Context Resolution
 * 
 * Each resolver is a pure function: (state) => state
 * No mutations, no side effects (except async API calls which are explicit)
 * 
 * THREE CRITICAL SAFEGUARDS (to prevent regressions):
 * 
 * 1. State Object Bloat Prevention:
 *    - Resolvers receive the full state object, but sub-functions (like resolveBrokerContext,
 *      AMC API calls) only receive specific parameters (orgId, envId, appId, etc.)
 *    - This keeps API call logic clean and reusable, not tightly coupled to TaskCallstackState
 * 
 * 2. deploymentApiStatus Priority Logic:
 *    - If Resolver 3 (AMC fallback) catches a 403, it sets deploymentApiStatus = "403_forbidden"
 *    - This status MUST be preserved even if fetchDeploymentDetail (called later) returns "ok"
 *    - Priority: amc403Error ? '403_forbidden' : fetchDeploymentDetail.deploymentApiStatus
 *    - See: app/api/task-callstack/route.ts line ~1425 for the preservation logic
 * 
 * 3. Sequential Execution (Sync/Async Bridge):
 *    - Resolver 1 is synchronous, Resolvers 2 & 3 are asynchronous
 *    - CRITICAL: Resolvers MUST run sequentially (await chain), NOT in parallel (Promise.all)
 *    - Reason: Resolver 2 MUST be able to override Resolver 1's output
 *    - Reason: Resolver 3 only runs if Resolver 2 didn't set deploymentContext.id
 *    - This is a Waterfall/Override pattern, not independent parallel enrichment
 */

import { loggedFetch, debugLog } from "@/lib/api-logger";
import { resolveBrokerContext } from "@/lib/broker-context";
import { getOAuthConfig } from "@/lib/auth/config";

export type DeploymentContextSource = 
  | "log_extraction" 
  | "broker_resolution" 
  | "amc_fallback" 
  | "none";

export interface DeploymentContext {
  id: string | null;
  type: string | undefined;
  resolvedName: string | undefined; // Broker app name (e.g. maf-unite-the-hyperscalers)
  source: DeploymentContextSource;
  // Error tracking for Step 13 403
  amc403Error: string | null;
  deploymentApiStatus: "ok" | "403_forbidden" | "not_used";
}

export interface TaskCallstackState {
  // Input (immutable)
  orgId: string;
  taskId: string;
  apiInstanceId?: string;
  envId?: string;
  skipTraces?: boolean;
  accessToken: string;
  baseUrl: string;
  
  // Base data from logs
  entries: unknown[];
  brokerName: string;
  appId: string; // Log-extracted appId (may be caller app)
  apiInstanceIdFromLogs: string;
  
  // Deployment context (flows through pipeline)
  deploymentContext: DeploymentContext;

  /**
   * When the caller already resolved broker context (e.g. via a cached
   * `resolveBrokerContext` call shared with another code path), pass it here so
   * Resolver 2 can skip its own RM-detail + AMC-list-by-name round trips.
   * `undefined` = not precomputed (Resolver 2 resolves normally); `null` = precomputed
   * and resolution found nothing (Resolver 2 skips, matching what it would have found).
   */
  precomputedDeploymentContext?: DeploymentContext | null;
  
  // Other state
  traceId: string | null;
  objectStoreData?: unknown;
  traceSpans?: unknown[];
  errors: string[];
}

/**
 * Resolver 1: Extract initial deployment context from log entries
 * Pure function: extracts appId and attempts to derive deploymentId
 */
export function resolveFromLogs(state: TaskCallstackState): TaskCallstackState {
  debugLog("[RESOLVER-1] Extracting deployment context from logs...");
  const appId = state.appId;
  let deploymentId: string | null = null;
  
  if (appId) {
    debugLog(`[RESOLVER-1] Checking appId: "${appId}"`);
    const appIdMatch = appId.match(/^APP_([a-f0-9-]+)__/);
    if (appIdMatch) {
      deploymentId = appIdMatch[1];
      debugLog(`[RESOLVER-1] ✓ Extracted deploymentId from APP_ pattern: ${deploymentId}`);
    } else if (/^[a-f0-9-]{36}$/.test(appId)) {
      deploymentId = appId;
      debugLog(`[RESOLVER-1] ✓ appId is deploymentId: ${deploymentId}`);
    } else {
      debugLog(`[RESOLVER-1] ✗ appId does not match deploymentId patterns`);
    }
  } else {
    debugLog(`[RESOLVER-1] ✗ No appId found in entries`);
  }
  
  return {
    ...state,
    deploymentContext: {
      id: deploymentId,
      type: undefined,
      resolvedName: undefined,
      source: deploymentId ? "log_extraction" : "none",
      amc403Error: null,
      deploymentApiStatus: "not_used",
    },
  };
}

/**
 * Resolver 2: Broker Resolution (MUST override Resolver 1 if validatedApiInstanceId exists)
 * Pure function: calls resolveBrokerContext and returns new state with updated context
 */
export async function resolveBroker(
  state: TaskCallstackState
): Promise<TaskCallstackState> {
  if (state.precomputedDeploymentContext !== undefined) {
    debugLog("[RESOLVER-2] Using precomputed deployment context (already resolved by caller), skipping API calls");
    if (state.precomputedDeploymentContext) {
      return {
        ...state,
        deploymentContext: state.precomputedDeploymentContext,
        appId: state.precomputedDeploymentContext.resolvedName || state.appId,
      };
    }
    return state;
  }

  const apiInstanceIdForRm = state.apiInstanceId || state.apiInstanceIdFromLogs;
  const shouldResolveBroker =
    apiInstanceIdForRm && 
    state.envId && 
    (!state.deploymentContext.id || state.apiInstanceId);
  
  debugLog("[RESOLVER-2] Broker resolution decision...");
  debugLog(`[RESOLVER-2]   - apiInstanceIdForRm: ${apiInstanceIdForRm || "none"}`);
  debugLog(`[RESOLVER-2]   - envId: ${state.envId || "none"}`);
  debugLog(`[RESOLVER-2]   - current deploymentContext.id: ${state.deploymentContext.id ?? "null"}`);
  debugLog(`[RESOLVER-2]   - validatedApiInstanceId: ${state.apiInstanceId || "none"}`);
  debugLog(`[RESOLVER-2]   - shouldResolveBroker: ${shouldResolveBroker}`);
  
  if (!shouldResolveBroker) {
    debugLog("[RESOLVER-2] Skipping broker resolution");
    return state;
  }
  
  // Extract specific parameters (not passing full state object to resolveBrokerContext)
  // This keeps the API call logic clean and reusable - resolveBrokerContext receives
  // only the strings it needs: orgId, envId, apiInstanceId, accessToken, baseUrl, fetchFn
  try {
    const brokerContext = await resolveBrokerContext(
      state.orgId,
      state.envId!,
      apiInstanceIdForRm!,
      state.accessToken,
      state.baseUrl,
      loggedFetch
    );
    
    if (brokerContext) {
      debugLog(`[RESOLVER-2] ✓ Broker context resolved: deploymentId=${brokerContext.deploymentId}, appName=${brokerContext.appName ?? "none"}, deploymentType=${brokerContext.deploymentType ?? "none"}`);
      return {
        ...state,
        deploymentContext: {
          id: brokerContext.deploymentId,
          type: brokerContext.deploymentType,
          resolvedName: brokerContext.appName,
          source: "broker_resolution",
          amc403Error: null,
          deploymentApiStatus: "not_used",
        },
        // Update appId to resolved broker name for downstream use
        appId: brokerContext.appName || state.appId,
      };
    } else {
      debugLog(`[RESOLVER-2] Resolve broker context returned null`);
      return state;
    }
  } catch (error) {
    debugLog(`[RESOLVER-2] Error resolving broker context:`, error);
    return state;
  }
}

/**
 * Resolver 3: AMC Fallback (only runs if context.id is still null AND no broker was selected)
 * Pure function: attempts AMC list-by-name lookup
 * 
 * NOTE: This function receives the full state object, but the actual AMC API call
 * only uses specific parameters (orgId, envId, appId, baseUrl, accessToken).
 * This keeps the API call logic clean and reusable - the state object is only
 * used for extracting these specific values, not passed to the API call itself.
 */
export async function resolveAmcFallback(
  state: TaskCallstackState
): Promise<TaskCallstackState> {
  // Only run if deploymentId is still null AND no broker was selected (validatedApiInstanceId)
  const shouldRun = 
    !state.deploymentContext.id && 
    state.appId && 
    state.envId && 
    !state.apiInstanceId;
  
  debugLog("[RESOLVER-3] AMC fallback decision...");
  debugLog(`[RESOLVER-3]   - deploymentContext.id: ${state.deploymentContext.id ?? "null"}`);
  debugLog(`[RESOLVER-3]   - appId: ${state.appId || "none"}`);
  debugLog(`[RESOLVER-3]   - envId: ${state.envId || "none"}`);
  debugLog(`[RESOLVER-3]   - validatedApiInstanceId: ${state.apiInstanceId || "none"}`);
  debugLog(`[RESOLVER-3]   - shouldRun: ${shouldRun}`);
  
  if (!shouldRun) {
    debugLog("[RESOLVER-3] Skipping AMC fallback");
    return state;
  }
  
  // Extract specific parameters (not passing full state object to API call)
  // This keeps the API call logic clean and reusable
  const { orgId, envId, appId, baseUrl, accessToken } = state;
  
  try {
    debugLog(`[RESOLVER-3] Calling AMC API: /amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments?name=${encodeURIComponent(appId)}`);
    const deploymentsUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments?name=${encodeURIComponent(appId)}`;
    const deploymentsRes = await loggedFetch(deploymentsUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    
    if (deploymentsRes.ok) {
      const deploymentsData = (await deploymentsRes.json()) as { 
        items?: Array<{ id: string; name: string; applicationId?: string | null }> 
      };
      const itemsFinal = deploymentsData.items ?? [];
      debugLog(`[RESOLVER-3] AMC list deployments?name=${appId}: itemCount=${itemsFinal.length}`);
      const matchingDeployment = itemsFinal.find((d: { name: string }) => d.name === appId);
      
      if (matchingDeployment) {
        const deploymentId = matchingDeployment.id;
        let deploymentType = state.deploymentContext.type;
        if (matchingDeployment.applicationId === null && !deploymentType) {
          deploymentType = "HY";
        }
        debugLog(`[RESOLVER-3] ✓ Found deploymentId from AMC: ${deploymentId}`);
        return {
          ...state,
          deploymentContext: {
            id: deploymentId,
            type: deploymentType,
            resolvedName: undefined, // AMC fallback doesn't provide app name
            source: "amc_fallback",
            amc403Error: null,
            deploymentApiStatus: "ok",
          },
        };
      } else {
        debugLog(`[RESOLVER-3] ✗ No deployment found with name: ${appId}`);
        return state;
      }
    } else if (deploymentsRes.status === 403) {
      // Preserve 403 error for UI reporting
      const errorText = await deploymentsRes.text().catch(() => "");
      let errorJson: { message?: string; error?: string; scope?: string } = {};
      try {
        errorJson = JSON.parse(errorText);
      } catch {
        // Not JSON, use raw text
      }
      
      const apiErrorMessage = errorJson.message || errorJson.error || errorText || "No error details provided";
      const currentScopes = getOAuthConfig().scopes;
      const errorMsg = `Application Manager API returned 403 Forbidden.

API Error: ${apiErrorMessage}

The token can list deployments but is not allowed to read deployment detail or specs (and thus not logs). Mulesoft docs: scope "Read Applications" (read:applications) allows GET .../organizations/{{org}}/environments/{{envId}}/deployments/**. Ensure your Anypoint org has granted the Connected App the Read Applications scope so deployment detail, specs, and logs are allowed.

To test different scopes:
1. Set ANYPOINT_SCOPES environment variable with the scope you want to test, e.g.:
   export ANYPOINT_SCOPES="profile read:exchange view:monitoring read:api_configuration read:api_policies manage:store_data <SCOPE_TO_TEST>"
2. Update your Connected App in Anypoint Platform to include that scope
3. Sign out and sign back in

Common scopes to try: ${getOAuthConfig().scopes}
Current scopes being requested: ${currentScopes}`;
      
      debugLog(`[RESOLVER-3] ✗ AMC API returned 403, preserving error for UI`);
      return {
        ...state,
        deploymentContext: {
          ...state.deploymentContext,
          amc403Error: errorMsg,
          deploymentApiStatus: "403_forbidden",
        },
      };
    } else {
      debugLog(`[RESOLVER-3] AMC API returned status ${deploymentsRes.status}`);
      return state;
    }
  } catch (error) {
    debugLog(`[RESOLVER-3] Error fetching deploymentId from AMC API:`, error);
    return state;
  }
}

/**
 * Pipeline: Execute resolvers in sequence
 * Each resolver receives the state and returns a new state (immutability)
 * 
 * CRITICAL: Resolvers MUST run sequentially (not in parallel) because:
 * - Resolver 2 MUST be able to override Resolver 1's output
 * - Resolver 3 only runs if Resolver 2 didn't set deploymentContext.id
 * - This is a Waterfall/Override pattern, not independent parallel enrichment
 * 
 * DO NOT wrap in Promise.all() - sequential await chain is required.
 */
export async function resolveDeploymentContext(
  initialState: TaskCallstackState
): Promise<TaskCallstackState> {
  debugLog("[DEPLOYMENT-CONTEXT] Starting resolution pipeline...");
  
  // Resolver 1: Extract from logs (synchronous, pure function)
  let state = resolveFromLogs(initialState);
  debugLog(`[DEPLOYMENT-CONTEXT] After Resolver 1: id=${state.deploymentContext.id ?? "null"}, source=${state.deploymentContext.source}`);
  
  // Resolver 2: Broker resolution (async, may override Resolver 1)
  // MUST await sequentially - cannot run in parallel with Resolver 3
  state = await resolveBroker(state);
  debugLog(`[DEPLOYMENT-CONTEXT] After Resolver 2: id=${state.deploymentContext.id ?? "null"}, resolvedName=${state.deploymentContext.resolvedName ?? "none"}, source=${state.deploymentContext.source}`);
  
  // Resolver 3: AMC fallback (async, only if id still null and no broker selected)
  // MUST await sequentially - depends on Resolver 2's output
  state = await resolveAmcFallback(state);
  debugLog(`[DEPLOYMENT-CONTEXT] After Resolver 3: id=${state.deploymentContext.id ?? "null"}, source=${state.deploymentContext.source}, deploymentApiStatus=${state.deploymentContext.deploymentApiStatus}`);
  
  return state;
}
