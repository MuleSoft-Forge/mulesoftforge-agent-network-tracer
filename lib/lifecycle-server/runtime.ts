/**
 * Server-only singletons for the in-process lifecycle API (Next.js route
 * handlers). The web app now enqueues BullMQ jobs and reads the job store
 * directly instead of proxying to a separate Fastify service.
 *
 * Connections are cached on globalThis so Next's dev hot-reload does not leak a
 * new Redis connection + Queue on every edit.
 */

import "server-only";
import type { Redis } from "ioredis";
import type { Queue } from "bullmq";
import { createRedis } from "./redis";
import { createQueue, type LifecycleJobData } from "./queue";
import { JobStore, CANCEL_CHANNEL } from "./store";

export { CANCEL_CHANNEL };

interface LifecycleGlobals {
  redis?: Redis;
  store?: JobStore;
  queue?: Queue<LifecycleJobData>;
}

const globalForLifecycle = globalThis as typeof globalThis & {
  __lifecycleRuntime?: LifecycleGlobals;
};

function state(): LifecycleGlobals {
  if (!globalForLifecycle.__lifecycleRuntime) {
    globalForLifecycle.__lifecycleRuntime = {};
  }
  return globalForLifecycle.__lifecycleRuntime;
}

/** Shared Redis connection for job-store reads/writes and publishing. */
export function getStoreRedis(): Redis {
  const s = state();
  if (!s.redis) s.redis = createRedis();
  return s.redis;
}

export function getStore(): JobStore {
  const s = state();
  if (!s.store) s.store = new JobStore(getStoreRedis());
  return s.store;
}

export function getQueue(): Queue<LifecycleJobData> {
  const s = state();
  if (!s.queue) s.queue = createQueue();
  return s.queue;
}

/**
 * A fresh connection dedicated to a single SSE subscription. Subscriber
 * connections cannot be shared (a subscribed connection can't run other
 * commands), so each stream gets its own and quits it on disconnect.
 */
export function createSubscriber(): Redis {
  return createRedis();
}

/**
 * Whether the lifecycle feature is available in this deployment. It is in-process
 * now, so it is considered configured whenever a Redis URL is present (always the
 * case on Fly) or we are running locally in development.
 */
export function isLifecycleConfigured(): boolean {
  return Boolean(process.env.REDIS_URL) || process.env.NODE_ENV !== "production";
}
