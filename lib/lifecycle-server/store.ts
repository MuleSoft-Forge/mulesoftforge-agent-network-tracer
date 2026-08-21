/**
 * Job persistence + event log, backed by Redis.
 *
 * Keys (all namespaced and TTL'd with JOB_RETENTION_SECONDS):
 *   job:{id}        JSON JobRecord
 *   joblog:{id}     RPUSH-ed list of JSON JobEvent (ordered, index = position)
 *   jobevents:{id}  pub/sub channel for live streaming
 *   idem:{key}      maps an idempotency key -> job id
 */

import type { Redis } from "ioredis";
import { config } from "./config";
import type { JobEvent, JobRecord, JobStatus } from "./contracts";

/** Redis pub/sub channel used to signal a job cancellation to the worker. */
export const CANCEL_CHANNEL = "jobcancel";

function jobKey(id: string): string {
  return `job:${id}`;
}
function logKey(id: string): string {
  return `joblog:${id}`;
}
function channelKey(id: string): string {
  return `jobevents:${id}`;
}
function idemKey(key: string): string {
  return `idem:${key}`;
}

export class JobStore {
  constructor(private readonly redis: Redis) {}

  private get ttl(): number {
    return config.jobRetentionSeconds;
  }

  async createJob(record: JobRecord): Promise<void> {
    await this.redis
      .multi()
      .set(jobKey(record.id), JSON.stringify(record), "EX", this.ttl)
      .exec();
  }

  async getJob(id: string): Promise<JobRecord | null> {
    const raw = await this.redis.get(jobKey(id));
    return raw ? (JSON.parse(raw) as JobRecord) : null;
  }

  async patchJob(id: string, patch: Partial<JobRecord>): Promise<JobRecord | null> {
    const current = await this.getJob(id);
    if (!current) return null;
    const next: JobRecord = { ...current, ...patch };
    await this.redis.set(jobKey(id), JSON.stringify(next), "EX", this.ttl);
    return next;
  }

  async setStatus(id: string, status: JobStatus): Promise<void> {
    await this.patchJob(id, { status });
    await this.appendEvent(id, { type: "status", status, at: new Date().toISOString() });
  }

  async appendEvent(id: string, event: JobEvent): Promise<void> {
    const payload = JSON.stringify(event);
    await this.redis
      .multi()
      .rpush(logKey(id), payload)
      .expire(logKey(id), this.ttl)
      .exec();
    await this.redis.publish(channelKey(id), payload);
  }

  /** Read events from `start` (0-based, inclusive) to the end of the log. */
  async getEvents(id: string, start = 0): Promise<JobEvent[]> {
    const raw = await this.redis.lrange(logKey(id), start, -1);
    return raw.map((entry) => JSON.parse(entry) as JobEvent);
  }

  async eventCount(id: string): Promise<number> {
    return this.redis.llen(logKey(id));
  }

  /**
   * Ids of all retained job records. Uses SCAN rather than KEYS so sweeping
   * never blocks Redis for other clients.
   */
  async listJobIds(): Promise<string[]> {
    const prefix = jobKey("");
    const ids: string[] = [];
    let cursor = "0";
    do {
      const [next, keys] = await this.redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 200);
      cursor = next;
      for (const key of keys) ids.push(key.slice(prefix.length));
    } while (cursor !== "0");
    return ids;
  }

  /** Reserve an idempotency key. Returns the existing job id if already used. */
  async reserveIdempotencyKey(key: string, jobId: string): Promise<string> {
    const ok = await this.redis.set(idemKey(key), jobId, "EX", this.ttl, "NX");
    if (ok === "OK") return jobId;
    const existing = await this.redis.get(idemKey(key));
    return existing ?? jobId;
  }

  channelFor(id: string): string {
    return channelKey(id);
  }
}
