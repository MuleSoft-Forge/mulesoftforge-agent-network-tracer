/**
 * Wire shapes for the Ops report, shared by the API routes that produce them
 * and the dashboard that renders them.
 *
 * These live apart from the modules that build them because those are
 * `server-only`; keeping the contract in a neutral file means the client
 * imports types without reaching into server code.
 */

import type { JobStatus } from "@/lib/lifecycle-server/contracts";

export const QUEUE_STATES = ["active", "waiting", "delayed", "failed", "completed"] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

export interface QueueJobSummary {
  id: string;
  /** BullMQ job name — the lifecycle command that was requested. */
  command: string;
  state: QueueState;
  orgId: string | null;
  actor: string | null;
  fileCount: number;
  deployEnvironment: string | null;
  deployTarget: string | null;
  enqueuedAt: string | null;
  startedAt: string | null;
  /** Time since enqueue for waiting jobs, time since pickup for active ones. */
  ageMs: number | null;
  attemptsMade: number;
  failedReason: string | null;
  /** Status recorded in the job store, which can diverge from the queue state. */
  storeStatus: JobStatus | null;
}

export interface WorkerConnection {
  addr: string | null;
  name: string | null;
  /** Seconds the connection has been open, per Redis CLIENT LIST. */
  ageSeconds: number | null;
  idleSeconds: number | null;
}

export interface RedisHealth {
  reachable: boolean;
  pingMs: number | null;
  version: string | null;
  uptimeSeconds: number | null;
  usedMemoryHuman: string | null;
  connectedClients: number | null;
  error: string | null;
}

export interface QueueSnapshot {
  name: string;
  paused: boolean;
  counts: Record<string, number>;
  workers: WorkerConnection[];
  /** True when Redis refused CLIENT LIST, so worker presence is unknown. */
  workersUnavailable: boolean;
  jobs: QueueJobSummary[];
}

/**
 * A job record that can no longer be making progress: non-terminal in the store
 * but past the window a healthy worker would have timed it out in.
 */
export interface StuckJobSummary {
  id: string;
  command: string;
  status: JobStatus;
  orgId: string;
  actor: string | null;
  createdAt: string;
  startedAt: string | null;
  ageMs: number;
}

export type OpsCheckLevel = "ok" | "warn" | "fail" | "unknown";

export interface OpsCheck {
  id: string;
  title: string;
  level: OpsCheckLevel;
  detail: string;
  /** What to do about it, when there is something to do. */
  action: string | null;
}

export interface FlySelfInfo {
  appName: string | null;
  machineId: string | null;
  region: string | null;
  imageRef: string | null;
  processGroup: string | null;
}

export interface FlyMachineSummary {
  id: string;
  name: string | null;
  state: string | null;
  region: string | null;
  processGroup: string | null;
  imageTag: string | null;
  cpuKind: string | null;
  cpus: number | null;
  memoryMb: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Derived from the machine's own service config, not from a name. */
  alwaysOn: boolean;
  checks: { name: string | null; status: string | null; output: string | null }[];
  /** True for the machine serving this request. */
  isSelf: boolean;
}

export interface FlySnapshot {
  configured: boolean;
  appName: string | null;
  appStatus: string | null;
  organization: string | null;
  machines: FlyMachineSummary[];
  self: FlySelfInfo;
  error: string | null;
  /** Setup guidance shown when the API is not usable from this deployment. */
  hint: string | null;
}

export interface ProcessInfo {
  nodeVersion: string;
  nodeEnv: string;
  uptimeSeconds: number;
  rssBytes: number;
  heapUsedBytes: number;
  redisConfigured: boolean;
  queueName: string;
  workerConcurrency: number;
  abandonAfterMs: number;
}

export interface OpsReport {
  generatedAt: string;
  checks: OpsCheck[];
  redis: RedisHealth;
  queue: QueueSnapshot | null;
  queueError: string | null;
  stuckJobs: StuckJobSummary[];
  fly: FlySnapshot;
  process: ProcessInfo;
}

export type FlyMachineAction = "start" | "stop" | "restart";

export type QueueActionRequest =
  | { action: "pause" }
  | { action: "resume" }
  | { action: "cancel"; jobId: string }
  | { action: "remove"; jobId: string }
  | { action: "retry"; jobId: string }
  | { action: "finalize"; jobId: string }
  | { action: "drain-waiting" }
  | { action: "clean-failed" }
  | { action: "clean-completed" };

export interface OpsActionResponse {
  ok: boolean;
  message: string;
}
