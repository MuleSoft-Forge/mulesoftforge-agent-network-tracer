/**
 * Single place to resolve "broker context" from (orgId, envId, apiInstanceId).
 * Used by broker-tasks (filter hits by broker app) and task-callstack (deploymentId + appName).
 * Uses RM GET api -> metadata.source -> AMC list by app name when HY/RR so we get the broker's MC deployment, not the caller's.
 */

import {
  deploymentNameCandidates,
  findAmcDeploymentByNames,
  type AmcDeploymentItem,
} from "./amc-deployment-match";
import {
  logSearchAppIdCandidates,
  parseBrokerRouteFromEndpoint,
} from "./log-search-ids";

export interface BrokerContext {
  deploymentId: string;
  appName: string | undefined;
  deploymentType: string | undefined;
  /** Flex Gateway / shared-space target id — often the `appId` in Log Search. */
  targetId?: string;
  /** Values to use when querying or post-filtering Log Search `appId`. */
  logAppIds?: string[];
  /** Exchange asset id for this API instance (broker identity on shared gateways). */
  assetId?: string;
  instanceLabel?: string;
  /** Last path segment from RM endpoint URI (e.g. agent_broker_get_date). */
  routeSegment?: string;
  /** RM deployment.applicationId — sometimes the runtime log appId. */
  rmApplicationId?: string;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export function parseAppNameFromMetadataSource(source: string | undefined): string | undefined {
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
    assetId?: string;
    instanceLabel?: string;
    deploymentId?: string;
    deployment?: {
      applicationId?: string;
      deploymentId?: string | null;
      targetId?: string;
      type?: string;
    };
    appId?: string;
    targetId?: string;
    metadata?: { source?: string };
    endpoint?: { uri?: string; deploymentType?: string };
  };

  const deploymentType = apiInstanceInfo.deployment?.type ?? apiInstanceInfo.endpoint?.deploymentType;
  const appNameFromSource = parseAppNameFromMetadataSource(apiInstanceInfo.metadata?.source);
  const targetId = apiInstanceInfo.deployment?.targetId ?? apiInstanceInfo.targetId;
  const assetId = apiInstanceInfo.assetId?.trim() || undefined;
  const instanceLabel = apiInstanceInfo.instanceLabel?.trim() || undefined;
  const routeSegment = parseBrokerRouteFromEndpoint(apiInstanceInfo.endpoint?.uri);
  const rmApplicationId = apiInstanceInfo.deployment?.applicationId?.trim() || undefined;

  debugLog(`[BROKER-CTX] RM response: deployment.applicationId=${apiInstanceInfo.deployment?.applicationId ?? "null"}, deployment.deploymentId=${apiInstanceInfo.deployment?.deploymentId ?? "null"}, deploymentId=${apiInstanceInfo.deploymentId ?? "null"}, appId=${apiInstanceInfo.appId ?? "null"}`);
  debugLog(`[BROKER-CTX] RM response: deploymentType=${deploymentType ?? "null"}, metadata.source=${apiInstanceInfo.metadata?.source ?? "null"}, appNameFromSource=${appNameFromSource ?? "null"}`);
  debugLog(`[BROKER-CTX] RM response: endpoint.uri=${apiInstanceInfo.endpoint?.uri ?? "null"}`);
  debugLog(
    `[BROKER-CTX] RM response: assetId=${assetId ?? "null"}, instanceLabel=${instanceLabel ?? "null"}, routeSegment=${routeSegment ?? "null"}, rmApplicationId=${rmApplicationId ?? "null"}`
  );

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

  const amcNameCandidates = deploymentNameCandidates(
    appNameFromSource,
    assetId,
    instanceLabel,
    routeSegment
  );
  const amcMatch = await resolveAmcDeployment(
    orgId,
    envId,
    amcNameCandidates,
    accessToken,
    baseUrl,
    fetchFn,
    debugLog
  );

  const rmFields = { assetId, instanceLabel, routeSegment, rmApplicationId };

  if (amcMatch) {
    debugLog(`[BROKER-CTX] ✓ AMC match: deploymentId=${amcMatch.id} (amcName=${amcMatch.name})`);
    if (deploymentId && amcMatch.id !== deploymentId) {
      debugLog(
        `[BROKER-CTX] NOTE: AMC deploymentId (${amcMatch.id}) differs from RM deploymentId (${deploymentId}) — using AMC`
      );
    }
    return buildBrokerContext(
      amcMatch.id,
      amcMatch.name,
      deploymentType,
      targetId,
      appNameFromSource,
      rmFields
    );
  }

  if (deploymentId) {
    debugLog(`[BROKER-CTX] Returning fallback: deploymentId=${deploymentId} (from ${deploymentIdSource})`);
    return buildBrokerContext(
      deploymentId,
      appNameFromSource ?? undefined,
      deploymentType,
      targetId,
      appNameFromSource,
      rmFields
    );
  }
  debugLog(`[BROKER-CTX] ✗ Could not resolve any deploymentId`);
  return null;
}

interface RmBrokerFields {
  assetId?: string;
  instanceLabel?: string;
  routeSegment?: string;
  rmApplicationId?: string;
}

function buildBrokerContext(
  deploymentId: string,
  appName: string | undefined,
  deploymentType: string | undefined,
  targetId: string | undefined,
  metadataAppName: string | undefined,
  rmFields: RmBrokerFields = {}
): BrokerContext {
  const logAppIds = logSearchAppIdCandidates(
    appName,
    metadataAppName,
    targetId,
    rmFields.assetId,
    rmFields.instanceLabel,
    rmFields.routeSegment,
    rmFields.rmApplicationId
  );
  return {
    deploymentId,
    appName,
    deploymentType,
    ...(targetId ? { targetId } : {}),
    ...(rmFields.assetId ? { assetId: rmFields.assetId } : {}),
    ...(rmFields.instanceLabel ? { instanceLabel: rmFields.instanceLabel } : {}),
    ...(rmFields.routeSegment ? { routeSegment: rmFields.routeSegment } : {}),
    ...(rmFields.rmApplicationId ? { rmApplicationId: rmFields.rmApplicationId } : {}),
    ...(logAppIds.length > 0 ? { logAppIds } : {}),
  };
}

async function resolveAmcDeployment(
  orgId: string,
  envId: string,
  candidateNames: string[],
  accessToken: string,
  baseUrl: string,
  fetchFn: FetchFn,
  debugLog: (...args: unknown[]) => void
): Promise<AmcDeploymentItem | null> {
  if (candidateNames.length === 0) {
    debugLog("[BROKER-CTX] No AMC name candidates — skipping AMC resolution");
    return null;
  }

  debugLog(`[BROKER-CTX] Resolving via AMC: candidates=${candidateNames.join(", ")}`);

  for (const candidate of candidateNames) {
    const listUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments?name=${encodeURIComponent(candidate)}`;
    const listRes = await fetchFn(listUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    if (!listRes.ok) {
      debugLog(`[BROKER-CTX] AMC list-by-name "${candidate}" returned ${listRes.status}`);
      continue;
    }
    const data = (await listRes.json()) as { items?: AmcDeploymentItem[] };
    const items = data.items ?? [];
    debugLog(
      `[BROKER-CTX] AMC list "${candidate}" returned ${items.length} items: ${items.map((d) => `${d.name}=${d.id}`).join(", ")}`
    );
    const match = findAmcDeploymentByNames(items, candidateNames);
    if (match) return match;
  }

  const allUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments`;
  const allRes = await fetchFn(allUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  if (!allRes.ok) {
    debugLog(`[BROKER-CTX] AMC full list returned ${allRes.status}`);
    return null;
  }
  const allData = (await allRes.json()) as { items?: AmcDeploymentItem[] };
  const allItems = allData.items ?? [];
  const fuzzy = findAmcDeploymentByNames(allItems, candidateNames);
  if (fuzzy) {
    debugLog(`[BROKER-CTX] ✓ AMC fuzzy match from full list: ${fuzzy.name}=${fuzzy.id}`);
    return fuzzy;
  }

  debugLog(`[BROKER-CTX] ✗ No AMC deployment matched candidates=[${candidateNames.join(", ")}]`);
  return null;
}
