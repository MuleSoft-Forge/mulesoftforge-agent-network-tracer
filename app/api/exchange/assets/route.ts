import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth-middleware";
import { validationError } from "@/lib/api/error-responses";
import { listAllExchangeAssetsInOrg } from "@/lib/mulesoft/exchange-search";

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
});

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
  const parseResult = ListRequestSchema.safeParse({
    organizationId: request.nextUrl.searchParams.get("organizationId"),
  });

  if (!parseResult.success) {
    return validationError(parseResult.error);
  }

  const { organizationId } = parseResult.data;
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  const hits = await listAllExchangeAssetsInOrg(baseUrl, organizationId, authHeader);

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
