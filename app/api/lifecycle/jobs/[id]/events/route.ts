import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth-middleware";
import { getStore, isLifecycleConfigured } from "@/lib/lifecycle-server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Poll fallback for clients that can't hold an SSE connection. */
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

  const start = Number.parseInt(request.nextUrl.searchParams.get("start") ?? "0", 10) || 0;
  const events = await store.getEvents(id, start);
  return NextResponse.json({ events, nextStart: start + events.length });
}
