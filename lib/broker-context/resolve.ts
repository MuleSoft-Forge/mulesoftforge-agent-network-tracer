/**
 * Single place to resolve "broker context" from (orgId, envId, apiInstanceId).
 * Used by broker-tasks (filter hits by broker app) and task-callstack (deploymentId + appName).
 * Uses RM GET api -> metadata.source -> AMC list by app name when HY/RR so we get the broker's MC deployment, not the caller's.
 */

export interface BrokerContext {
  deploymentId: string;
  appName: string | undefined;
  deploymentType: string | undefined;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function parseAppNameFromMetadataSource(source: string | undefined): string | undefined {
  if (!source || typeof source !== "string") return undefined;
  const parts = source.split(":");
  return parts.length >= 4 ? parts[3] : undefined;
}

/**
 * Resolve broker context: deploymentId, appName, deploymentType.
 * When RM returns HY/RR and metadata.source has an app name, resolves via AMC list-by-name so we use the broker's MC deployment.
 */
export async function resolveBrokerContext(
  orgId: string,
  envId: string,
  apiInstanceId: string,
  accessToken: string,
  baseUrl: string,
  fetchFn: FetchFn = fetch
): Promise<BrokerContext | null> {
  const { debugLog } = await import("@/lib/api-logger");
  debugLog(`[BROKER-CTX] Resolving broker context for apiInstanceId=${apiInstanceId}, envId=${envId}`);

  const runtimeManagerUrl = `${baseUrl}/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiInstanceId}`;
  const rmRes = await fetchFn(runtimeManagerUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!rmRes.ok) {
    debugLog(`[BROKER-CTX] RM API returned ${rmRes.status} for apiInstanceId=${apiInstanceId}`);
    return null;
  }

  const apiInstanceInfo = (await rmRes.json()) as {
    deploymentId?: string;
    deployment?: {
      applicationId?: string;
      deploymentId?: string | null;
      type?: string;
    };
    appId?: string;
    metadata?: { source?: string };
    endpoint?: { uri?: string; deploymentType?: string };
  };

  const deploymentType = apiInstanceInfo.deployment?.type ?? apiInstanceInfo.endpoint?.deploymentType;
  const appNameFromSource = parseAppNameFromMetadataSource(apiInstanceInfo.metadata?.source);

  debugLog(`[BROKER-CTX] RM response: deployment.applicationId=${apiInstanceInfo.deployment?.applicationId ?? "null"}, deployment.deploymentId=${apiInstanceInfo.deployment?.deploymentId ?? "null"}, deploymentId=${apiInstanceInfo.deploymentId ?? "null"}, appId=${apiInstanceInfo.appId ?? "null"}`);
  debugLog(`[BROKER-CTX] RM response: deploymentType=${deploymentType ?? "null"}, metadata.source=${apiInstanceInfo.metadata?.source ?? "null"}, appNameFromSource=${appNameFromSource ?? "null"}`);
  debugLog(`[BROKER-CTX] RM response: endpoint.uri=${apiInstanceInfo.endpoint?.uri ?? "null"}`);

  let deploymentId: string | null = null;
  let deploymentIdSource = "none";
  if (apiInstanceInfo.deployment?.applicationId) {
    deploymentId = apiInstanceInfo.deployment.applicationId;
    deploymentIdSource = "deployment.applicationId";
  } else if (apiInstanceInfo.deploymentId) {
    deploymentId = apiInstanceInfo.deploymentId;
    deploymentIdSource = "deploymentId";
  } else if (apiInstanceInfo.appId) {
    const m = String(apiInstanceInfo.appId).match(/^APP_([a-f0-9-]+)__/);
    if (m) {
      deploymentId = m[1];
      deploymentIdSource = "appId (APP_ pattern)";
    }
  }
  debugLog(`[BROKER-CTX] Initial deploymentId=${deploymentId ?? "null"} (from ${deploymentIdSource})`);

  if (appNameFromSource) {
    debugLog(`[BROKER-CTX] Resolving via AMC list-by-name: ${appNameFromSource}`);
    const listUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments?name=${encodeURIComponent(appNameFromSource)}`;
    const listRes = await fetchFn(listUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    if (listRes.ok) {
      const data = (await listRes.json()) as { items?: Array<{ id: string; name: string }> };
      const items = data.items ?? [];
      debugLog(`[BROKER-CTX] AMC list returned ${items.length} items: ${items.map(d => `${d.name}=${d.id}`).join(", ")}`);
      const match = items.find((d) => d.name === appNameFromSource);
      if (match) {
        debugLog(`[BROKER-CTX] ✓ AMC match: deploymentId=${match.id} (appName=${appNameFromSource})`);
        if (deploymentId && match.id !== deploymentId) {
          debugLog(`[BROKER-CTX] NOTE: AMC deploymentId (${match.id}) differs from RM deploymentId (${deploymentId}) — using AMC (correct for Object Store)`);
        }
        return {
          deploymentId: match.id,
          appName: appNameFromSource,
          deploymentType,
        };
      } else {
        debugLog(`[BROKER-CTX] ✗ No AMC deployment matched name="${appNameFromSource}"`);
      }
    } else {
      debugLog(`[BROKER-CTX] AMC list-by-name returned ${listRes.status}`);
    }
  } else {
    debugLog(`[BROKER-CTX] No appNameFromSource — skipping AMC list-by-name`);
  }

  if (deploymentId) {
    debugLog(`[BROKER-CTX] Returning fallback: deploymentId=${deploymentId} (from ${deploymentIdSource})`);
    return {
      deploymentId,
      appName: appNameFromSource ?? undefined,
      deploymentType,
    };
  }
  debugLog(`[BROKER-CTX] ✗ Could not resolve any deploymentId`);
  return null;
}
