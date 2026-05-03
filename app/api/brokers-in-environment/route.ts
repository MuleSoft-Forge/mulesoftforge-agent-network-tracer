import { NextRequest, NextResponse } from "next/server";
import type { FabricGraphResponse, FabricNode } from "@/lib/adapters/visualizer-to-canonical";
import type { BrokerInEnvironment } from "@/lib/visualizer/brokers-in-environment-types";
import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";
import { BrokersInEnvironmentRequestSchema } from "@/lib/schemas";
import { requireAuth } from "@/lib/api/auth-middleware";
import { validationError } from "@/lib/api/error-responses";

export const dynamic = "force-dynamic";

interface Gav { groupId: string; assetId: string; version: string }

function parseGav(urn: string | null | undefined): Gav | undefined {
  // "urn:gav:groupId:assetId:version"
  if (!urn || typeof urn !== "string") return undefined;
  const parts = urn.replace("urn:gav:", "").split(":");
  if (parts.length >= 3) {
    return { groupId: parts[0], assetId: parts[1], version: parts[2] };
  }
  return undefined;
}

/**
 * Shape of an API Manager instance row (from /apimanager/api/v1/.../apis).
 * Only the fields we actually need; the endpoint returns many more.
 */
interface ApiManagerInstance {
  id?: number | string;
  assetId?: string;
  groupId?: string;
  assetVersion?: string;
  metadata?: { source?: string; [key: string]: unknown } | null;
  apiAsset?: { assetId?: string | null; groupId?: string | null } | null;
}

interface ApiManagerAsset {
  assetId?: string;
  groupId?: string;
  apis?: ApiManagerInstance[];
}

interface ApiManagerListResponse {
  total?: number;
  /** Newer shape: assets grouping API instances. */
  assets?: ApiManagerAsset[];
  /** Older shape: flat list. */
  instances?: ApiManagerInstance[];
}

/**
 * Fetch ALL API instances for (orgId, envId) from API Manager, following the
 * `limit`/`offset` pager. This is the authoritative source for which
 * instances are deployed in a given environment — fabric's
 * `prod_instances_map` is observed to be incomplete for some orgs, which
 * would cause the old code path to drop brokers entirely.
 */
async function listApiManagerInstances(
  baseUrl: string,
  orgId: string,
  envId: string,
  authHeader: string
): Promise<ApiManagerInstance[]> {
  const PAGE_SIZE = 500;
  const results: ApiManagerInstance[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url =
      `${baseUrl}/apimanager/api/v1/organizations/${encodeURIComponent(orgId)}` +
      `/environments/${encodeURIComponent(envId)}/apis` +
      `?fullInfo=true&limit=${PAGE_SIZE}&offset=${offset}&sort=name&ascending=true`;
    const res = await loggedFetch(url, { headers: { Authorization: authHeader } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API Manager list failed: ${res.status} ${text}`);
    }
    const body = (await res.json()) as ApiManagerListResponse;

    const flat: ApiManagerInstance[] = [];
    if (Array.isArray(body.assets)) {
      for (const asset of body.assets) {
        for (const inst of asset.apis ?? []) {
          flat.push({
            ...inst,
            assetId: inst.assetId ?? asset.assetId,
            groupId: inst.groupId ?? asset.groupId,
          });
        }
      }
    }
    if (Array.isArray(body.instances)) flat.push(...body.instances);

    results.push(...flat);

    // Stop when the response returns fewer than a full page OR we've hit the
    // reported total. Defensive: some API versions don't return `total`.
    const pageCount = flat.length;
    if (pageCount < PAGE_SIZE) break;
    if (typeof body.total === "number" && results.length >= body.total) break;
    // Safety guard against unbounded looping.
    if (offset > 10_000) break;
  }
  return results;
}

/**
 * For instances whose list entry did not include `metadata.source`, fetch the
 * single-instance detail to recover the parent agent-network GAV. We only do
 * this for broker instances we're about to return — NOT for every instance in
 * the env. At most one call per broker (the first instance).
 */
async function fetchSingleInstanceGav(
  baseUrl: string,
  orgId: string,
  envId: string,
  apiInstanceId: string,
  authHeader: string
): Promise<Gav | undefined> {
  const url = `${baseUrl}/apimanager/api/v1/organizations/${encodeURIComponent(orgId)}/environments/${encodeURIComponent(envId)}/apis/${encodeURIComponent(apiInstanceId)}`;
  const res = await loggedFetch(url, { headers: { Authorization: authHeader } });
  if (!res.ok) return undefined;
  try {
    const data = (await res.json()) as { metadata?: { source?: string } };
    return parseGav(data?.metadata?.source);
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  // Authentication check
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) {
    return NextResponse.json({ error: "Not signed in", brokers: [] }, { status: 401 });
  }
  
  const { baseUrl, accessToken } = authResult;

  // Validate query parameters with Zod
  const orgId = request.nextUrl.searchParams.get("orgId");
  const environmentId = request.nextUrl.searchParams.get("environmentId");
  const activityPeriodParam = request.nextUrl.searchParams.get("activityPeriod");
  
  const parseResult = BrokersInEnvironmentRequestSchema.safeParse({
    orgId,
    environmentId,
  });
  
  if (!parseResult.success) {
    const errorResponse = validationError(parseResult.error);
    const errorBody = await errorResponse.json();
    return NextResponse.json(
      {
        ...errorBody,
        brokers: [],
      },
      { status: 400 }
    );
  }
  
  const { orgId: validatedOrgId, environmentId: validatedEnvironmentId } = parseResult.data;

  // activityPeriod is accepted (for API compatibility) but not used: the list
  // of brokers in an env doesn't depend on how far back we look at activity.
  void activityPeriodParam;

  const authHeader = `Bearer ${accessToken}`;

  try {
    // -----------------------------------------------------------------------
    // Data sources (why two calls, not one):
    //
    //   (A) Visualizer fabric-network  → node metadata (name, icon, platform,
    //       tags, version). Source of truth for WHAT to display.
    //   (B) API Manager /apis          → authoritative instance IDs for the
    //       selected env. Source of truth for WHAT IS DEPLOYED HERE.
    //
    // Previously we relied on fabric's `prod_instances_map`, but it has been
    // observed to be incomplete for some orgs (fabric lists a broker node but
    // has no entry for it in the map → broker disappears entirely, tasks
    // can't be fetched). API Manager reliably returns every API instance
    // deployed in an environment, so we inner-join fabric × API Manager on
    // `assetId` to decide which brokers to return.
    // -----------------------------------------------------------------------

    const [fabricRes, amInstances] = await Promise.all([
      loggedFetch(
        `${baseUrl}/visualizer/api/v2/organizations/${encodeURIComponent(validatedOrgId)}/fabric-network`,
        {
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ orgIds: [validatedOrgId] }),
        }
      ),
      listApiManagerInstances(baseUrl, validatedOrgId, validatedEnvironmentId, authHeader),
    ]);

    if (!fabricRes.ok) {
      const text = await fabricRes.text();
      return NextResponse.json(
        { error: `Fabric network failed: ${fabricRes.status} ${text}`, brokers: [] },
        { status: fabricRes.status }
      );
    }
    const fabric = (await fabricRes.json()) as FabricGraphResponse;
    const brokerNodes = (fabric.nodes ?? []).filter(
      (n: FabricNode) => String(n.type).toUpperCase() === "BROKER"
    );

    // Group API Manager instances by assetId. Each entry collects every
    // instance id for the asset in this env plus (if present on the list
    // response) the parent agent-network GAV from metadata.source.
    const instancesByAssetId = new Map<string, { ids: string[]; gav?: Gav }>();
    for (const inst of amInstances) {
      const assetId = inst.assetId ?? inst.apiAsset?.assetId ?? undefined;
      if (!assetId || inst.id == null) continue;
      const id = String(inst.id);
      const existing = instancesByAssetId.get(assetId) ?? { ids: [] };
      if (!existing.ids.includes(id)) existing.ids.push(id);
      if (!existing.gav) existing.gav = parseGav(inst.metadata?.source);
      instancesByAssetId.set(assetId, existing);
    }

    debugLog("[BROKERS] Sources:", {
      totalFabricNodes: fabric.nodes?.length ?? 0,
      brokerNodesCount: brokerNodes.length,
      apiManagerInstances: amInstances.length,
      apiManagerAssetKeys: instancesByAssetId.size,
    });

    // Inner-join fabric broker nodes with API Manager instances. Brokers the
    // list endpoint doesn't return aren't deployed in this env — dropping
    // them matches what the UI needs (the Tasks view can't do anything
    // without an apiInstanceId).
    const brokers: BrokerInEnvironment[] = [];
    const gavFallbackQueue: { broker: BrokerInEnvironment; firstInstanceId: string }[] = [];

    for (const node of brokerNodes) {
      if (!node.assetId) continue;
      const match = instancesByAssetId.get(node.assetId);
      if (!match || match.ids.length === 0) continue;

      const broker: BrokerInEnvironment = {
        nodeId: node.id ?? `${node.organizationId}:${node.assetId}`,
        assetId: node.assetId,
        name: node.name ?? node.assetId,
        organizationId: node.organizationId ?? "",
        instanceIds: match.ids,
        ...(match.gav ? { agentNetworkGav: match.gav } : {}),
      };
      brokers.push(broker);

      // If the list response didn't include `metadata.source` we'll try the
      // per-instance detail endpoint once to recover the GAV. This matches
      // old behaviour (which always fetched per-instance) but at most once
      // per broker instead of once per instance.
      if (!match.gav) {
        gavFallbackQueue.push({ broker, firstInstanceId: match.ids[0] });
      }
    }

    // Recover missing GAVs in parallel. Best-effort — if the call fails, the
    // broker just won't have agentNetworkGav, and ExchangeVersionsPanel will
    // surface "No agent-network asset linked to this broker".
    if (gavFallbackQueue.length > 0) {
      const recovered = await Promise.all(
        gavFallbackQueue.map(({ firstInstanceId }) =>
          fetchSingleInstanceGav(
            baseUrl,
            validatedOrgId,
            validatedEnvironmentId,
            firstInstanceId,
            authHeader
          )
        )
      );
      gavFallbackQueue.forEach(({ broker }, i) => {
        const gav = recovered[i];
        if (gav) broker.agentNetworkGav = gav;
      });
    }

    debugLog("[BROKERS] Returning brokers (env " + validatedEnvironmentId + "):", {
      count: brokers.length,
      brokerIds: brokers.map((b: BrokerInEnvironment) => b.nodeId),
      gavFallbacksIssued: gavFallbackQueue.length,
    });

    return NextResponse.json({ brokers });
  } catch (error) {
    debugError("[BROKERS] Error fetching brokers:", error);
    return NextResponse.json(
      { error: "Failed to fetch brokers in environment", brokers: [] },
      { status: 500 }
    );
  }
}
