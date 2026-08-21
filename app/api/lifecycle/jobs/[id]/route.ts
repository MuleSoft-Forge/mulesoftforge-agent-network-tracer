import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth-middleware";
import { getStore, isLifecycleConfigured } from "@/lib/lifecycle-server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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
  const events = await store.eventCount(id);
  return NextResponse.json({ job: record, events });
}
