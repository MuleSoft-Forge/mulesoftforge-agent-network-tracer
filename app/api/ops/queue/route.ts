import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOps } from "@/lib/ops/guard";
import { isLifecycleConfigured } from "@/lib/lifecycle-server/runtime";
import {
  ACTION_TIMEOUT_MS,
  cancelQueueJob,
  cleanQueue,
  drainWaitingJobs,
  finalizeStuckJob,
  removeQueueJob,
  retryQueueJob,
  setQueuePaused,
  withTimeout,
  type QueueActionResult,
} from "@/lib/ops/queue-inspector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jobId = z.string().min(1).max(256);

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("cancel"), jobId }),
  z.object({ action: z.literal("remove"), jobId }),
  z.object({ action: z.literal("retry"), jobId }),
  z.object({ action: z.literal("finalize"), jobId }),
  z.object({ action: z.literal("drain-waiting") }),
  z.object({ action: z.literal("clean-failed") }),
  z.object({ action: z.literal("clean-completed") }),
]);

type QueueAction = z.infer<typeof actionSchema>;

function run(request: QueueAction): Promise<QueueActionResult> {
  switch (request.action) {
    case "pause":
      return setQueuePaused(true);
    case "resume":
      return setQueuePaused(false);
    case "cancel":
      return cancelQueueJob(request.jobId);
    case "remove":
      return removeQueueJob(request.jobId);
    case "retry":
      return retryQueueJob(request.jobId);
    case "finalize":
      return finalizeStuckJob(request.jobId);
    case "drain-waiting":
      return drainWaitingJobs();
    case "clean-failed":
      return cleanQueue("failed");
    case "clean-completed":
      return cleanQueue("completed");
    default: {
      const _exhaustive: never = request;
      return _exhaustive;
    }
  }
}

export async function POST(request: NextRequest) {
  const ops = await requireOps(request);
  if (ops instanceof NextResponse) return ops;

  if (!isLifecycleConfigured()) {
    return NextResponse.json({ error: "remote_lifecycle_disabled" }, { status: 501 });
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

  try {
    const result = await withTimeout(
      run(parsed.data),
      ACTION_TIMEOUT_MS,
      `Queue action "${parsed.data.action}"`
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
