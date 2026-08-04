import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth-middleware";
import { validationError } from "@/lib/api/error-responses";
import {
  fetchExchangePolicyCatalog,
  type ExchangePolicyTemplate,
} from "@/lib/mulesoft/exchange-policy-templates";

export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  organizationId: z.string().min(1),
});

export type { ExchangePolicyTemplate };

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;
  const parsed = RequestSchema.safeParse({
    organizationId: request.nextUrl.searchParams.get("organizationId"),
  });
  if (!parsed.success) return validationError(parsed.error);

  const { organizationId } = parsed.data;

  try {
    const catalog = await fetchExchangePolicyCatalog(baseUrl, accessToken, {
      organizationId,
    });

    return NextResponse.json({
      ...catalog,
      total: catalog.inbound.length + catalog.outbound.length,
      source: "getExchangePolicyTemplates",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Policy catalog request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
