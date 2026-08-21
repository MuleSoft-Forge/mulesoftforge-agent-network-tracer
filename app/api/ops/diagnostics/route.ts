import { NextRequest, NextResponse } from "next/server";
import { requireOps } from "@/lib/ops/guard";
import { buildOpsReport } from "@/lib/ops/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ops = await requireOps(request);
  if (ops instanceof NextResponse) return ops;

  try {
    const report = await buildOpsReport();
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: "report_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
