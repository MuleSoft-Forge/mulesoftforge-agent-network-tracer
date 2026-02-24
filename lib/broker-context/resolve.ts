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
  const runtimeManagerUrl = `${baseUrl}/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiInstanceId}`;
  const rmRes = await fetchFn(runtimeManagerUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!rmRes.ok) return null;

  const apiInstanceInfo = (await rmRes.json()) as {
    deploymentId?: string;
    deployment?: {
      applicationId?: string;
      type?: string;
    };
    appId?: string;
    metadata?: { source?: string };
  };

  const deploymentType = apiInstanceInfo.deployment?.type;
  const appNameFromSource = parseAppNameFromMetadataSource(apiInstanceInfo.metadata?.source);

  let deploymentId: string | null = null;
  if (apiInstanceInfo.deployment?.applicationId) {
    deploymentId = apiInstanceInfo.deployment.applicationId;
  } else if (apiInstanceInfo.deploymentId) {
    deploymentId = apiInstanceInfo.deploymentId;
  } else if (apiInstanceInfo.appId) {
    const m = String(apiInstanceInfo.appId).match(/^APP_([a-f0-9-]+)__/);
    if (m) deploymentId = m[1];
  }

  if (deploymentId && appNameFromSource) {
    const listUrl = `${baseUrl}/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments?name=${encodeURIComponent(appNameFromSource)}`;
    const listRes = await fetchFn(listUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    if (listRes.ok) {
      const data = (await listRes.json()) as { items?: Array<{ id: string; name: string }> };
      const match = (data.items ?? []).find((d) => d.name === appNameFromSource);
      if (match) {
        return {
          deploymentId: match.id,
          appName: appNameFromSource,
          deploymentType,
        };
      }
    }
  }

  if (deploymentId) {
    return {
      deploymentId,
      appName: appNameFromSource ?? undefined,
      deploymentType,
    };
  }
  return null;
}
