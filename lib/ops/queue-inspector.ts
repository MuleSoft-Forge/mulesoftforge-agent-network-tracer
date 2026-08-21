/**
 * Read-only views over the lifecycle queue and its Redis backing store, plus
 * the small set of operator actions the Ops page exposes.
 *
 * Every job summary is a deliberate projection: the queued payload carries the
 * acting user's Anypoint access token and the whole project bundle, and neither
 * may leave the server. Only counts and non-secret identifiers cross the wire.
 */

import "server-only";
import type { Job } from "bullmq";
import { getQueue, getStore, getStoreRedis, CANCEL_CHANNEL } from "@/lib/lifecycle-server/runtime";
import type { LifecycleJobData } from "@/lib/lifecycle-server/queue";
import { config } from "@/lib/lifecycle-server/config";
import { finalizeJob } from "@/lib/lifecycle-server/finalize";
import { isTerminal, type JobRecord, type JobStatus } from "@/lib/lifecycle-server/contracts";
import {
  QUEUE_STATES,
  type QueueJobSummary,
  type QueueSnapshot,
  type QueueState,
  type RedisHealth,
  type StuckJobSummary,
  type WorkerConnection,
} from "./types";

/**
 * The worker's reaper sweeps abandoned records once a minute using this same
 * window; listing them here shows what it will pick up, and lets an operator
 * clear one immediately instead of waiting for the sweep.
 */
export const ABANDON_AFTER_MS = config.maxCliTimeoutMs + config.abandonSlackMs;

/**
 * BullMQ requires `maxRetriesPerRequest: null` on its connections, which makes
 * ioredis queue commands indefinitely instead of failing them while the socket
 * is down. Unbounded, that would hang this page in the exact situation it
 * exists to report on, so every Redis probe races a deadline.
 */
const PROBE_TIMEOUT_MS = 5_000;
const READ_TIMEOUT_MS = 10_000;
/** Actions write and then read back, so they get a little more room. */
export const ACTION_TIMEOUT_MS = 15_000;

export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not respond within ${ms}ms.`)), ms);
  });
  try {
    // Promise.race attaches handlers to both, so the abandoned command can
    // never surface later as an unhandled rejection.
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function parseInfoField(info: string, field: string): string | null {
  const match = info.match(new RegExp(`^${field}:(.*)$`, "m"));
  return match ? match[1].trim() : null;
}

function parseIntOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function readRedisHealth(): Promise<RedisHealth> {
  const redis = getStoreRedis();
  const startedAt = Date.now();
  try {
    await withTimeout(redis.ping(), PROBE_TIMEOUT_MS, `Redis PING (socket is "${redis.status}")`);
    const pingMs = Date.now() - startedAt;
    const info = await withTimeout(redis.info(), PROBE_TIMEOUT_MS, "Redis INFO");
    return {
      reachable: true,
      pingMs,
      version: parseInfoField(info, "redis_version"),
      uptimeSeconds: parseIntOrNull(parseInfoField(info, "uptime_in_seconds")),
      usedMemoryHuman: parseInfoField(info, "used_memory_human"),
      connectedClients: parseIntOrNull(parseInfoField(info, "connected_clients")),
      error: null,
    };
  } catch (err) {
    return {
      reachable: false,
      pingMs: null,
      version: null,
      uptimeSeconds: null,
      usedMemoryHuman: null,
      connectedClients: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function summarizeJob(
  job: Job<LifecycleJobData>,
  state: QueueState,
  storeStatus: JobStatus | null
): QueueJobSummary {
  const data = job.data ?? ({} as LifecycleJobData);
  const enqueuedAt = job.timestamp ? new Date(job.timestamp).toISOString() : null;
  const startedAt = job.processedOn ? new Date(job.processedOn).toISOString() : null;
  const ageAnchor = state === "active" ? job.processedOn : job.timestamp;

  return {
    id: String(job.id ?? data.jobId ?? "unknown"),
    command: job.name ?? data.command ?? "unknown",
    state,
    orgId: data.orgId ?? null,
    actor: data.actor?.label ?? data.actor?.userId ?? null,
    fileCount: data.project?.length ?? 0,
    deployEnvironment: data.deploy?.environment ?? null,
    deployTarget: data.deploy?.targetKind ?? null,
    enqueuedAt,
    startedAt,
    ageMs: ageAnchor ? Date.now() - ageAnchor : null,
    attemptsMade: job.attemptsMade ?? 0,
    failedReason: job.failedReason ?? null,
    storeStatus,
  };
}

/** BullMQ names the waiting list `wait`; the rest match their public state. */
const BULLMQ_TYPE_FOR: Record<QueueState, "active" | "wait" | "delayed" | "failed" | "completed"> = {
  active: "active",
  waiting: "wait",
  delayed: "delayed",
  failed: "failed",
  completed: "completed",
};

const JOBS_PER_STATE = 25;

async function readWorkers(): Promise<{ workers: WorkerConnection[]; unavailable: boolean }> {
  try {
    const raw = await withTimeout(getQueue().getWorkers(), PROBE_TIMEOUT_MS, "CLIENT LIST");
    const workers = raw.map((entry): WorkerConnection => {
      const record = entry as unknown as Record<string, string | undefined>;
      return {
        addr: record.addr ?? null,
        name: record.name?.trim() ? record.name : null,
        ageSeconds: parseIntOrNull(record.age ?? null),
        idleSeconds: parseIntOrNull(record.idle ?? null),
      };
    });
    return { workers, unavailable: false };
  } catch {
    // Managed Redis providers sometimes disable CLIENT LIST. Absence of the
    // command is not absence of workers, so this is reported as unknown.
    return { workers: [], unavailable: true };
  }
}

export function readQueueSnapshot(): Promise<QueueSnapshot> {
  return withTimeout(collectQueueSnapshot(), READ_TIMEOUT_MS, "Reading the queue");
}

async function collectQueueSnapshot(): Promise<QueueSnapshot> {
  const queue = getQueue();
  const store = getStore();

  const [counts, paused, workerInfo] = await Promise.all([
    queue.getJobCounts(),
    queue.isPaused(),
    readWorkers(),
  ]);

  const jobs: QueueJobSummary[] = [];
  for (const state of QUEUE_STATES) {
    const batch = await queue.getJobs([BULLMQ_TYPE_FOR[state]], 0, JOBS_PER_STATE - 1, false);
    for (const job of batch) {
      if (!job) continue;
      const record = job.id ? await store.getJob(String(job.id)) : null;
      jobs.push(summarizeJob(job as Job<LifecycleJobData>, state, record?.status ?? null));
    }
  }

  return {
    name: config.queueName,
    paused,
    counts,
    workers: workerInfo.workers,
    workersUnavailable: workerInfo.unavailable,
    jobs,
  };
}

function ageOf(record: JobRecord): number {
  const since = Date.parse(record.startedAt ?? record.createdAt);
  return Number.isFinite(since) ? Date.now() - since : 0;
}

export function readStuckJobs(): Promise<StuckJobSummary[]> {
  return withTimeout(collectStuckJobs(), READ_TIMEOUT_MS, "Scanning job records");
}

async function collectStuckJobs(): Promise<StuckJobSummary[]> {
  const store = getStore();
  const stuck: StuckJobSummary[] = [];
  for (const jobId of await store.listJobIds()) {
    const record = await store.getJob(jobId);
    if (!record || isTerminal(record.status)) continue;
    const ageMs = ageOf(record);
    if (ageMs < ABANDON_AFTER_MS) continue;
    stuck.push({
      id: record.id,
      command: record.command,
      status: record.status,
      orgId: record.orgId,
      actor: record.actor?.label ?? record.actor?.userId ?? null,
      createdAt: record.createdAt,
      startedAt: record.startedAt ?? null,
      ageMs,
    });
  }
  return stuck.sort((a, b) => b.ageMs - a.ageMs);
}

export type QueueActionResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Cancel a job wherever it currently lives: signal the worker (which kills the
 * CLI child), mark the store record terminal so anyone watching over SSE stops
 * waiting, and drop the queue entry so a worker never picks it up later.
 */
export async function cancelQueueJob(jobId: string): Promise<QueueActionResult> {
  const store = getStore();
  const record = await store.getJob(jobId);
  const job = await getQueue().getJob(jobId);

  if (!record && !job) return { ok: false, message: `No job ${jobId} in the queue or the store.` };

  if (record && !isTerminal(record.status)) {
    await getStoreRedis().publish(CANCEL_CHANNEL, jobId);
    await store.setStatus(jobId, "cancelled");
  }

  if (job) {
    const state = await job.getState();
    if (state !== "active") {
      await job.remove().catch(() => undefined);
    }
  }

  return { ok: true, message: `Cancelled ${jobId}.` };
}

/** Remove a queue entry outright. Refuses while the job is being processed. */
export async function removeQueueJob(jobId: string): Promise<QueueActionResult> {
  const job = await getQueue().getJob(jobId);
  if (!job) return { ok: false, message: `No queue entry for ${jobId}.` };
  const state = await job.getState();
  if (state === "active") {
    return { ok: false, message: `${jobId} is running — cancel it instead of removing it.` };
  }
  await job.remove();
  return { ok: true, message: `Removed ${jobId} from the queue.` };
}

export async function retryQueueJob(jobId: string): Promise<QueueActionResult> {
  const job = await getQueue().getJob(jobId);
  if (!job) return { ok: false, message: `No queue entry for ${jobId}.` };
  const state = await job.getState();
  if (state !== "failed") {
    return { ok: false, message: `${jobId} is ${state}, so there is nothing to retry.` };
  }
  await job.retry();
  return { ok: true, message: `Re-queued ${jobId}.` };
}

/** Drop every waiting entry. Running jobs are untouched. */
export async function drainWaitingJobs(): Promise<QueueActionResult> {
  const removed = await getQueue().clean(0, 1000, "wait");
  for (const jobId of removed) {
    await finalizeJob({
      store: getStore(),
      jobId: String(jobId),
      status: "cancelled",
      message: "An operator cleared the build queue before this job started.",
    }).catch(() => undefined);
  }
  return { ok: true, message: `Cleared ${removed.length} waiting job(s).` };
}

export async function cleanQueue(type: "failed" | "completed"): Promise<QueueActionResult> {
  const removed = await getQueue().clean(0, 1000, type);
  return { ok: true, message: `Removed ${removed.length} ${type} job(s) from history.` };
}

export async function setQueuePaused(paused: boolean): Promise<QueueActionResult> {
  const queue = getQueue();
  if (paused) {
    await queue.pause();
    return { ok: true, message: "Queue paused — workers finish current jobs and take no new ones." };
  }
  await queue.resume();
  return { ok: true, message: "Queue resumed." };
}

/** Mark an abandoned record terminal now instead of waiting for the reaper. */
export async function finalizeStuckJob(jobId: string): Promise<QueueActionResult> {
  const finalized = await finalizeJob({
    store: getStore(),
    jobId,
    status: "failed",
    message: "An operator marked this job abandoned from the Ops page. Submit it again.",
  });
  return finalized
    ? { ok: true, message: `Marked ${jobId} as abandoned.` }
    : { ok: false, message: `${jobId} was already finished.` };
}
