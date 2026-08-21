import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOps } from "@/lib/ops/guard";
import { FlyApiError, readFlyConfig, runMachineAction } from "@/lib/fly/machines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.enum(["start", "stop", "restart"]),
  machineId: z.string().min(1).max(128),
});

export async function POST(request: NextRequest) {
  const ops = await requireOps(request);
  if (ops instanceof NextResponse) return ops;

  const flyConfig = readFlyConfig();
  if (!flyConfig) {
    return NextResponse.json(
      { ok: false, message: "Fly API access is not configured for this deployment." },
      { status: 501 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { action, machineId } = parsed.data;
  try {
    await runMachineAction(flyConfig, machineId, action);
    return NextResponse.json({ ok: true, message: `Sent ${action} to machine ${machineId}.` });
  } catch (err) {
    if (err instanceof FlyApiError) {
      return NextResponse.json({ ok: false, message: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
