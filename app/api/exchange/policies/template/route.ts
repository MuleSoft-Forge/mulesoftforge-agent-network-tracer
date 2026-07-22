import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth-middleware";
import { validationError } from "@/lib/api/error-responses";
import { fetchExchangePolicyTemplate } from "@/lib/mulesoft/exchange-policy-templates";

export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  organizationId: z.string().min(1),
  groupId: z.string().min(1),
  assetId: z.string().min(1),
  version: z.string().min(1),
});

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;
  const parsed = RequestSchema.safeParse({
    organizationId: request.nextUrl.searchParams.get("organizationId"),
    groupId: request.nextUrl.searchParams.get("groupId"),
    assetId: request.nextUrl.searchParams.get("assetId"),
    version: request.nextUrl.searchParams.get("version"),
  });
  if (!parsed.success) return validationError(parsed.error);

  const { organizationId, groupId, assetId, version } = parsed.data;

  try {
    const template = await fetchExchangePolicyTemplate(
      baseUrl,
      accessToken,
      organizationId,
      groupId,
      assetId,
      version
    );
    return NextResponse.json(template);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Policy template request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
