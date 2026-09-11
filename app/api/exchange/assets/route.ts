import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth-middleware";
import { validationError } from "@/lib/api/error-responses";
import { listAllExchangeAssetsInOrg } from "@/lib/mulesoft/exchange-search";
import { REMOVAL_TARGET_TYPES } from "@/lib/lifecycle-server/contracts";

export const dynamic = "force-dynamic";

/**
 * Lists every Exchange asset owned by a business group, across all types.
 *
 * This backs the "stubborn teardown" panel: unlike `/api/exchange/networks`
 * (agent-network only, keyword search) this enumerates the whole group so
 * orphaned agent/mcp/llm assets — the ones a failed CLI delete leaves behind —
 * are surfaced for a direct API delete.
 */
const ListRequestSchema = z.object({
  organizationId: z.string().min(1),
  types: z.array(z.enum(REMOVAL_TARGET_TYPES)).optional(),
  includeAllTypes: z.boolean().default(false),
});

const DEFAULT_SCAN_TYPES = ["agent", "agent-network", "mcp", "llm"] as const;

export interface ExchangeGroupAsset {
  groupId: string;
  assetId: string;
  name: string;
  version: string;
  type: string;
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;
  const requestedTypesRaw = request.nextUrl.searchParams
    .getAll("type")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  const includeAllTypes = requestedTypesRaw.includes("all");
  const requestedTypes = requestedTypesRaw.filter((value) => value !== "all");
  const parseResult = ListRequestSchema.safeParse({
    organizationId: request.nextUrl.searchParams.get("organizationId"),
    types: requestedTypes.length > 0 ? requestedTypes : undefined,
    includeAllTypes,
  });

  if (!parseResult.success) {
    return validationError(parseResult.error);
  }

  const { organizationId, types, includeAllTypes: useAllTypes } = parseResult.data;
  const authHeader = { Authorization: `Bearer ${accessToken}` };
  const scanTypes = useAllTypes ? [] : (types ?? [...DEFAULT_SCAN_TYPES]);

  const hits = await listAllExchangeAssetsInOrg(baseUrl, organizationId, authHeader, fetch, 250, scanTypes);

  const assets: ExchangeGroupAsset[] = hits.map((hit) => ({
    groupId: hit.groupId,
    assetId: hit.assetId,
    name: hit.name ?? hit.assetId,
    version: hit.version ?? "",
    type: hit.type ?? "unknown",
  }));

  assets.sort(
    (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
  );

  return NextResponse.json({ assets, total: assets.length });
}
