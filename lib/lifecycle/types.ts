/**
 * Wire types for the lifecycle feature, shared by the API routes and the client
 * hook. These mirror the server contracts in lib/lifecycle-server/contracts.ts.
 */

import type { DeployOptions } from "@/lib/desktop/deploy-options";

export type { DeployOptions } from "@/lib/desktop/deploy-options";
export type CliCommand = "build" | "publish" | "deploy" | "unpublish" | "undeploy";
/**
 * A client-requested job command. "teardown" is a composite the worker
 * expands into undeploy then unpublish — it is never itself a CLI step, so
 * job results report back one of the real `CliCommand` values.
 */
export type JobCommand = CliCommand | "teardown";

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
  command: JobCommand;
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
  | {
      type: "result";
      ok: boolean;
      exitCode: number | null;
      json: unknown;
      at: string;
      /** The real step (undeploy/unpublish/...) this result belongs to. */
      command?: CliCommand;
    };

export function isRemovalCommand(command: JobCommand): boolean {
  return command === "unpublish" || command === "undeploy" || command === "teardown";
}
export type RemovalTargetType =
  | "agent"
  | "agent-network"
  | "app"
  | "connector"
  | "crate"
  | "custom"
  | "data-weave-library"
  | "evented-api"
  | "example"
  | "extension"
  | "graphql"
  | "http-api"
  | "llm"
  | "mcp"
  | "policy"
  | "policy-implementation"
  | "raml-fragment"
  | "rest-api"
  | "rpa-activity-template"
  | "rpa-process-template"
  | "ruleset"
  | "soap-api"
  | "template";

/**
 * Options for `unpublish` / `undeploy`. Supplying `gav` targets a remote asset
 * by coordinates and needs no project bundle; omitting it acts on the loaded
 * project instead.
 */
export interface RemovalOptions {
  /** Teardown target type. Defaults server-side to "agent-network". */
  type?: RemovalTargetType;
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
  command: JobCommand;
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
