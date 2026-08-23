import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/auth-middleware";
import {
  getStore,
  createSubscriber,
  isLifecycleConfigured,
} from "@/lib/lifecycle-server/runtime";
import { isTerminal, type JobEvent } from "@/lib/lifecycle-server/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15000;
/**
 * After a job's terminal event, hold the stream open just long enough for the
 * client to receive the final frame, then close it server-side. The job is
 * over — keeping the connection (and its dedicated Redis subscriber) open past
 * the job's life is exactly what let idle streams pile up and starve the
 * machine of connections for new requests, navigation RSC fetches included.
 */
const TERMINAL_GRACE_MS = 2000;
/**
 * Absolute cap on any single stream. A still-running job's client simply
 * reconnects (the route replays the backlog); an orphaned stream whose client
 * vanished without a delivered abort is reclaimed here instead of heartbeating
 * forever.
 */
const MAX_STREAM_MS = 15 * 60 * 1000;

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
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let maxLifetime: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const clearTimers = () => {
    if (heartbeat) clearInterval(heartbeat);
    if (closeTimer) clearTimeout(closeTimer);
    if (maxLifetime) clearTimeout(maxLifetime);
    heartbeat = null;
    closeTimer = null;
    maxLifetime = null;
  };

  const isTerminalJobEvent = (event: JobEvent): boolean =>
    event.type === "result" || (event.type === "status" && isTerminal(event.status));

  const rawIsTerminal = (raw: string): boolean => {
    try {
      return isTerminalJobEvent(JSON.parse(raw) as JobEvent);
    } catch {
      return false;
    }
  };

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
        clearTimers();
        void sub.quit().catch(() => undefined);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      // Close the stream a beat after the job's terminal event: the client has
      // everything, and nothing more will ever be published for this job.
      const scheduleTerminalClose = () => {
        if (closed || closeTimer) return;
        closeTimer = setTimeout(cleanup, TERMINAL_GRACE_MS);
      };

      // Tear down when the client disconnects.
      request.signal.addEventListener("abort", cleanup);

      // Backstop so no single stream can live forever (see MAX_STREAM_MS).
      maxLifetime = setTimeout(cleanup, MAX_STREAM_MS);

      // Subscribe BEFORE replaying history so an event that fires while we read
      // the backlog can't slip through the gap (e.g. a fast job's terminal
      // event). Tail messages that arrive during the replay are buffered, then
      // flushed once, after which we go live. Worst case is a rare duplicate log
      // line if an event lands in both the backlog and the buffer — the client
      // tolerates that (status/result handling is idempotent).
      const buffered: string[] = [];
      let live = false;
      sub.on("message", (_channel, message) => {
        if (live) {
          send(`data: ${message}\n\n`);
          if (rawIsTerminal(message)) scheduleTerminalClose();
        } else {
          buffered.push(message);
        }
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

      // If the job is already finished, its terminal event is in the backlog we
      // just replayed — close after the grace window instead of heartbeating on
      // a dead job forever. Otherwise heartbeat to keep idle proxies open, but
      // reclaim the moment the consumer is gone.
      const alreadyTerminal =
        isTerminal(record.status) || backlog.some(isTerminalJobEvent);
      if (alreadyTerminal) {
        scheduleTerminalClose();
      } else {
        heartbeat = setInterval(() => {
          // A null desiredSize means the consumer is gone; reclaim rather than
          // ping into the void (and hold the connection + subscriber open).
          if (controller.desiredSize === null) {
            cleanup();
            return;
          }
          send(": ping\n\n");
        }, HEARTBEAT_MS);
      }

      if (request.signal.aborted) cleanup();
    },
    cancel() {
      closed = true;
      clearTimers();
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
