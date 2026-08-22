import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth-middleware";
import { validationError } from "@/lib/api/error-responses";
import {
  deleteExchangeAssetVersion,
  exchangeDeleteHint,
  httpStatusLabel,
} from "@/lib/mulesoft/exchange-delete";

export const dynamic = "force-dynamic";

/**
 * Force-deletes a single Exchange asset version through the v2 trusted-manager
 * path — the one that works for MAF/agent asset types the CLI cannot remove.
 *
 * One version per call by design: the panel resolves an asset's versions and
 * loops, so every delete is a discrete, visible step with its own result rather
 * than one opaque batch. Uses the signed-in user's token (the app already
 * requests `manage:exchange`); a 403 means that user/org lacks delete rights.
 */
const DeleteRequestSchema = z.object({
  groupId: z.string().min(1),
  assetId: z.string().min(1),
  version: z.string().min(1),
  deleteType: z.enum(["hard-delete", "soft-delete"]).default("hard-delete"),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = DeleteRequestSchema.safeParse(json);
  if (!parseResult.success) {
    return validationError(parseResult.error);
  }

  const { groupId, assetId, version, deleteType } = parseResult.data;

  const result = await deleteExchangeAssetVersion(
    baseUrl,
    groupId,
    assetId,
    version,
    accessToken,
    { deleteType }
  );

  return NextResponse.json({
    ok: result.ok,
    status: result.status,
    statusLabel: httpStatusLabel(result.status),
    error: result.error ?? null,
    hint: result.ok ? null : exchangeDeleteHint(result.status),
  });
}
