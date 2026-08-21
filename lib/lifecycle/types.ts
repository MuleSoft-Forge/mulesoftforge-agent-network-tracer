/**
 * Wire types for the lifecycle feature, shared by the API routes and the client
 * hook. These mirror the server contracts in lib/lifecycle-server/contracts.ts.
 */

import type { DeployOptions } from "@/lib/desktop/deploy-options";

export type { DeployOptions } from "@/lib/desktop/deploy-options";
export type CliCommand = "build" | "publish" | "deploy" | "unpublish" | "undeploy";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

const TERMINAL: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL.includes(status);
}

export interface JobActor {
  userId: string;
  label?: string;
}

/** One file of an Agent Network project, transferred inline. */
export interface ProjectFileEntry {
  filename: string;
  content: string;
}

export interface JobRecord {
  id: string;
  command: CliCommand;
  status: JobStatus;
  orgId: string;
  connectionRef: string;
  actor: JobActor;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  ok?: boolean;
  error?: string;
  resultJson?: unknown;
}

/** Streamed job event (SSE payload from the backend, relayed by the proxy). */
export type JobEvent =
  | { type: "status"; status: JobStatus; at: string }
  | { type: "log"; channel: "stdout" | "stderr" | "meta"; chunk: string; at: string }
  | { type: "result"; ok: boolean; exitCode: number | null; json: unknown; at: string };

export function isRemovalCommand(command: CliCommand): boolean {
  return command === "unpublish" || command === "undeploy";
}

/**
 * Options for `unpublish` / `undeploy`. Supplying `gav` targets a remote asset
 * by coordinates and needs no project bundle; omitting it acts on the loaded
 * project instead.
 */
export interface RemovalOptions {
  /** Business group id from session context; resolved to a name server-side. */
  organizationId?: string;
  /** Required for undeploy. On unpublish it enables the active-instance check. */
  environment?: string;
  /** `groupId:assetId:version`. */
  gav?: string;
  /** `unpublish` only: also free the GAV for reuse. See RemovalOptions on the server. */
  hardDelete?: boolean;
}

/** Body the client sends to POST /api/lifecycle/jobs. */
export interface RemoteJobSubmit {
  command: CliCommand;
  project: ProjectFileEntry[];
  deploy?: DeployOptions;
  removal?: RemovalOptions;
  /** Optional override; defaults server-side to the user's org id. */
  connectionRef?: string;
  idempotencyKey?: string;
}

export interface RemoteJobAccepted {
  jobId: string;
  status: JobStatus;
  deduped?: boolean;
}
