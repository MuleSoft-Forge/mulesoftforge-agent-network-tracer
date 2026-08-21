/**
 * Terminal-state guarantee for lifecycle jobs.
 *
 * A browser watching a job over SSE only stops waiting when it receives a
 * `result` or terminal `status` event. Any path that ends a job without those —
 * a killed worker, a BullMQ-level failure, a stalled lock, shutdown — would
 * otherwise leave the client spinning forever. Every such path funnels through
 * here instead.
 *
 * Writes are skipped when the job is already terminal, so racing with the
 * worker's own completion is harmless.
 */

import type { JobStore } from "./store";
import { isTerminal, type JobStatus } from "./contracts";
import { redactSecrets } from "./redaction";

export type FinalizableStatus = Extract<JobStatus, "failed" | "cancelled">;

export interface FinalizeJobArgs {
  store: JobStore;
  jobId: string;
  status: FinalizableStatus;
  /** Operator-facing explanation, appended to the job log. */
  message: string;
  exitCode?: number | null;
}

/** Returns true when this call is the one that moved the job to terminal. */
export async function finalizeJob(args: FinalizeJobArgs): Promise<boolean> {
  const { store, jobId, status, message, exitCode = null } = args;

  const record = await store.getJob(jobId);
  if (!record || isTerminal(record.status)) return false;

  const at = new Date().toISOString();
  const text = redactSecrets(message);

  await store.patchJob(jobId, { finishedAt: at, ok: false, exitCode, error: text });
  await store.appendEvent(jobId, { type: "log", channel: "meta", chunk: `${text}\n`, at });
  await store.appendEvent(jobId, { type: "result", ok: false, exitCode, json: null, at });
  await store.setStatus(jobId, status);
  return true;
}
