import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth-middleware";
import { validationError } from "@/lib/api/error-responses";
import { EXCHANGE_SEARCH_TYPES, listAllExchangeAssetsInOrg } from "@/lib/mulesoft/exchange-search";
import { fetchExchangeAssetViaGraphQL } from "@/lib/mulesoft/exchange-graphql";

export const dynamic = "force-dynamic";

const ListRequestSchema = z.object({
  organizationId: z.string().min(1),
  search: z.string().trim().min(1).max(200).optional(),
});

const MAX_NETWORKS = 40;

export interface ExchangeNetworkListItem {
  groupId: string;
  assetId: string;
  name: string;
  versions: Array<{ version: string; status: string | null }>;
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;
  const parseResult = ListRequestSchema.safeParse({
    organizationId: request.nextUrl.searchParams.get("organizationId"),
    search: request.nextUrl.searchParams.get("search") ?? undefined,
  });

  if (!parseResult.success) {
    return validationError(parseResult.error);
  }

  const { organizationId, search } = parseResult.data;
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  const hits = await listAllExchangeAssetsInOrg(
    baseUrl,
    organizationId,
    authHeader,
    fetch,
    undefined,
    [EXCHANGE_SEARCH_TYPES.AGENT_NETWORK]
  );

  const normalizedSearch = search?.trim().toLowerCase() ?? "";
  const filteredHits =
    normalizedSearch.length === 0
      ? hits
      : hits.filter((hit) => {
          const name = (hit.name ?? "").toLowerCase();
          const assetId = hit.assetId.toLowerCase();
          return name.includes(normalizedSearch) || assetId.includes(normalizedSearch);
        });

  const unique = new Map<string, { groupId: string; assetId: string; name: string }>();
  for (const hit of filteredHits) {
    const key = `${hit.groupId}:${hit.assetId}`;
    if (!unique.has(key)) {
      unique.set(key, {
        groupId: hit.groupId,
        assetId: hit.assetId,
        name: hit.name ?? hit.assetId,
      });
    }
    if (unique.size >= MAX_NETWORKS) break;
  }

  const networks: ExchangeNetworkListItem[] = await Promise.all(
    Array.from(unique.values()).map(async (entry) => {
      const asset = await fetchExchangeAssetViaGraphQL(
        baseUrl,
        entry.groupId,
        entry.assetId,
        accessToken
      );
      if (!asset) {
        return {
          ...entry,
          versions: [{ version: "unknown", status: null }],
        };
      }
      const versions = [
        { version: asset.version, status: asset.status ?? null },
        ...asset.otherVersions
          .filter((v) => v.version !== asset.version)
          .map((v) => ({ version: v.version, status: null as string | null })),
      ].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));

      return {
        groupId: entry.groupId,
        assetId: entry.assetId,
        name: asset.name || entry.name,
        versions,
      };
    })
  );

  networks.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ networks, total: networks.length });
}
