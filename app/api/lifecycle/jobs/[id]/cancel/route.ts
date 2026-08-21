import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth-middleware";
import { getStore, getStoreRedis, isLifecycleConfigured, CANCEL_CHANNEL } from "@/lib/lifecycle-server/runtime";
import { isTerminal } from "@/lib/lifecycle-server/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!isLifecycleConfigured()) {
    return NextResponse.json({ error: "remote_lifecycle_disabled" }, { status: 501 });
  }
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await context.params;
  const store = getStore();
  const record = await store.getJob(id);
  if (!record) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (isTerminal(record.status)) {
    return NextResponse.json({ jobId: record.id, status: record.status, cancelled: false });
  }

  await getStoreRedis().publish(CANCEL_CHANNEL, record.id);
  await store.setStatus(record.id, "cancelled");
  return NextResponse.json({ jobId: record.id, status: "cancelled", cancelled: true });
}
