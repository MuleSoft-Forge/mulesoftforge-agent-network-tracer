import { NextRequest, NextResponse } from "next/server";
import { getSession, isAuthenticated } from "@/lib/session";
import type { FabricGraphResponse, FabricNode } from "@/lib/adapters/visualizer-to-canonical";
import type { BrokerInEnvironment } from "@/lib/visualizer/brokers-in-environment-types";
import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";
import { BrokersInEnvironmentRequestSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const DEFAULT_BASE_URL = "https://anypoint.mulesoft.com";
const DEFAULT_ACTIVITY_PERIOD_MINUTES = 1440; // 24h

/** Anypoint environment from GET .../organizations/{orgId}/environments (response.data[]. */
interface AnypointEnv {
  id?: string;
  isProduction?: boolean;
  type?: string;
  [key: string]: unknown;
}

export async function GET(request: NextRequest) {
  // Authentication check
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in", brokers: [] }, { status: 401 });
  }
  
  const session = await getSession();
  
  if (session.invalidatedAt || !session.accessToken) {
    return NextResponse.json({ error: "Not signed in", brokers: [] }, { status: 401 });
  }

  // Validate query parameters with Zod
  const orgId = request.nextUrl.searchParams.get("orgId");
  const environmentId = request.nextUrl.searchParams.get("environmentId");
  const activityPeriodParam = request.nextUrl.searchParams.get("activityPeriod");
  
  const parseResult = BrokersInEnvironmentRequestSchema.safeParse({
    orgId,
    environmentId,
  });
  
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details: parseResult.error.format(),
        brokers: [],
      },
      { status: 400 }
    );
  }
  
  const { orgId: validatedOrgId, environmentId: validatedEnvironmentId } = parseResult.data;
  
  const activityPeriodMinutes = (() => {
    const n = activityPeriodParam != null ? parseInt(activityPeriodParam, 10) : NaN;
    if (!Number.isFinite(n) || n < 1) return DEFAULT_ACTIVITY_PERIOD_MINUTES;
    return Math.min(Math.max(n, 1), 10080); // clamp 1–7 days
  })();

  const baseUrl = session.baseUrl ?? DEFAULT_BASE_URL;
  const authHeader = `Bearer ${session.accessToken}`;

  try {
    // Resolve isProduction for the selected environment (fabric only has prod vs non-prod).
    const envsRes = await loggedFetch(
      `${baseUrl}/accounts/api/organizations/${encodeURIComponent(validatedOrgId)}/environments`,
      { headers: { Authorization: authHeader } }
    );
    if (!envsRes.ok) {
      const text = await envsRes.text();
      return NextResponse.json(
        { error: `Environments failed: ${envsRes.status} ${text}`, brokers: [] },
        { status: envsRes.status }
      );
    }
    const envsBody = (await envsRes.json()) as { data?: AnypointEnv[] };
    const envs = Array.isArray(envsBody.data) ? envsBody.data : [];
    const selectedEnv = envs.find(
      (e: AnypointEnv) => e.id != null && String(e.id) === validatedEnvironmentId
    );
    const isProduction = selectedEnv?.isProduction === true;

    // Single fabric call: instance IDs come from prod_instances_map / non_prod_instances_map.
    // FabricGraphFilterDTO does not include activityPeriod; pass it to any Visualizer endpoint that does (e.g. node runtime, runtime-edges).
    const fabricRes = await loggedFetch(
      `${baseUrl}/visualizer/api/v2/organizations/${encodeURIComponent(validatedOrgId)}/fabric-network`,
      {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ orgIds: [validatedOrgId] }),
      }
    );
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
    const prodMap = fabric.prod_instances_map ?? {};
    const nonProdMap = fabric.non_prod_instances_map ?? {};

    debugLog("[BROKERS] Fabric data:", {
      totalNodes: fabric.nodes?.length ?? 0,
      brokerNodesCount: brokerNodes.length,
      isProduction,
      prodMapKeys: Object.keys(prodMap).length,
      nonProdMapKeys: Object.keys(nonProdMap).length,
    });

    const brokers: BrokerInEnvironment[] = [];

    for (const node of brokerNodes) {
      const nodeId = node.id ?? `${node.organizationId}:${node.assetId}`;
      const instanceIds: string[] = isProduction
        ? (prodMap[nodeId] ?? []).filter((id): id is string => typeof id === "string" && id.length > 0)
        : (nonProdMap[nodeId] ?? []).filter((id): id is string => typeof id === "string" && id.length > 0);

      if (instanceIds.length > 0) {
        brokers.push({
          nodeId,
          assetId: node.assetId ?? "",
          name: node.name ?? node.assetId ?? nodeId,
          organizationId: node.organizationId ?? "",
          instanceIds,
        });
      }
    }

    debugLog("[BROKERS] Returning brokers:", {
      count: brokers.length,
      brokerIds: brokers.map((b: BrokerInEnvironment) => b.nodeId),
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
