import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth-middleware";
import { getMuleSoftAssumptionReport } from "@/lib/mulesoft/catalog";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  let controlPlaneHost = "unknown";
  try {
    controlPlaneHost = new URL(authResult.baseUrl).host;
  } catch {
    // Do not return the raw session URL if it is malformed.
  }

  return NextResponse.json(
    {
      controlPlaneHost,
      ...getMuleSoftAssumptionReport(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
