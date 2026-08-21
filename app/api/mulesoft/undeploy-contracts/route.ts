import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth-middleware";
import { apiError, validationError } from "@/lib/api/error-responses";
import { parseGav } from "@/lib/mulesoft/parse-gav";
import { listActiveContractsForGav, revokeContract } from "@/lib/mulesoft/api-manager-contracts";

/**
 * Pre-flight check (and revocation) for the "biggest gotcha" in undeploy:
 * Anypoint refuses to remove an API instance that still has an approved
 * client-application contract. This lets the UI surface those contracts and
 * offer to revoke them before the CLI's undeploy attempt is submitted.
 */
export const dynamic = "force-dynamic";

const ListQuerySchema = z.object({
  organizationId: z.string().min(1).max(100),
  environmentId: z.string().min(1).max(100),
  gav: z.string().min(1).max(300),
});

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const parsed = ListQuerySchema.safeParse({
    organizationId: request.nextUrl.searchParams.get("organizationId"),
    environmentId: request.nextUrl.searchParams.get("environmentId"),
    gav: request.nextUrl.searchParams.get("gav"),
  });
  if (!parsed.success) return validationError(parsed.error);

  const gav = parseGav(parsed.data.gav);
  if (!gav) return apiError("gav must be groupId:assetId:version", 400);

  try {
    const contracts = await listActiveContractsForGav(
      authResult.baseUrl,
      parsed.data.organizationId,
      parsed.data.environmentId,
      gav,
      `Bearer ${authResult.accessToken}`
    );
    return NextResponse.json({ contracts }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return apiError(
      "Failed to check for active API contracts",
      502,
      err instanceof Error ? err.message : undefined
    );
  }
}

const RevokeBodySchema = z.object({
  organizationId: z.string().min(1).max(100),
  environmentId: z.string().min(1).max(100),
  contracts: z
    .array(
      z.object({
        apiInstanceId: z.string().min(1).max(100),
        contractId: z.string().min(1).max(100),
      })
    )
    .min(1)
    .max(50),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const json = await request.json().catch(() => null);
  const parsed = RevokeBodySchema.safeParse(json);
  if (!parsed.success) return validationError(parsed.error);

  const { organizationId, environmentId, contracts } = parsed.data;
  const authHeader = `Bearer ${authResult.accessToken}`;

  const results = await Promise.all(
    contracts.map(async ({ apiInstanceId, contractId }) => {
      try {
        await revokeContract(
          authResult.baseUrl,
          organizationId,
          environmentId,
          apiInstanceId,
          contractId,
          authHeader
        );
        return { contractId, ok: true as const };
      } catch (err) {
        return {
          contractId,
          ok: false as const,
          message: err instanceof Error ? err.message : "Revoke failed",
        };
      }
    })
  );

  return NextResponse.json({ results });
}
