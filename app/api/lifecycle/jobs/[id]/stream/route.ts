import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth-middleware";
import {
  getStore,
  createSubscriber,
  isLifecycleConfigured,
} from "@/lib/lifecycle-server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15000;

/**
 * Server-Sent Events stream for a job's live event log. The browser opens an
 * EventSource here (same-origin, authed by the session cookie). We replay the
 * backlog, then subscribe to the job's Redis channel for the tail, sending a
 * heartbeat comment so idle proxies keep the connection open. Everything is
 * torn down when the client disconnects (request.signal aborts).
 */
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

  const encoder = new TextEncoder();
  const channel = store.channelFor(id);
  const sub = createSubscriber();

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Controller already closed (client went away mid-write).
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        void sub.quit().catch(() => undefined);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      // Tear down when the client disconnects.
      request.signal.addEventListener("abort", cleanup);

      // Subscribe BEFORE replaying history so an event that fires while we read
      // the backlog can't slip through the gap (e.g. a fast job's terminal
      // event). Tail messages that arrive during the replay are buffered, then
      // flushed once, after which we go live. Worst case is a rare duplicate log
      // line if an event lands in both the backlog and the buffer — the client
      // tolerates that (status/result handling is idempotent).
      const buffered: string[] = [];
      let live = false;
      sub.on("message", (_channel, message) => {
        if (live) send(`data: ${message}\n\n`);
        else buffered.push(message);
      });
      try {
        await sub.subscribe(channel);
      } catch {
        cleanup();
        return;
      }

      const backlog = await store.getEvents(id, 0);
      for (const event of backlog) send(`data: ${JSON.stringify(event)}\n\n`);
      // Flush + go live in one synchronous step so no message can be dropped.
      for (const message of buffered) send(`data: ${message}\n\n`);
      buffered.length = 0;
      live = true;

      heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

      if (request.signal.aborted) cleanup();
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      closed = true;
      void sub.quit().catch(() => undefined);
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
