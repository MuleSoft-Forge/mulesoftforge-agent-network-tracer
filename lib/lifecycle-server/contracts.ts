/**
 * Wire contracts shared between the lifecycle API routes (producer) and the
 * worker (consumer).
 *
 * These mirror the lifecycle request types in the app so the same project
 * bundle + deploy options can be enqueued for the worker.
 */

import { z } from "zod";

/** Lifecycle commands the backend may run. Mirrors electron/cli/runner.js. */
export const CLI_COMMANDS = ["build", "publish", "deploy", "unpublish", "undeploy"] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

/**
 * Commands that tear something down rather than create it. They take a
 * different flag set from deploy and never need a preceding build.
 */
export const REMOVAL_COMMANDS = ["unpublish", "undeploy"] as const;
export type RemovalCommand = (typeof REMOVAL_COMMANDS)[number];

export function isRemovalCommand(command: CliCommand): command is RemovalCommand {
  return (REMOVAL_COMMANDS as readonly CliCommand[]).includes(command);
}

/**
 * Commands a client may request. Every `CliCommand` is individually runnable;
 * `teardown` is a composite the worker expands into `["undeploy", "unpublish"]`
 * (see `commandsFor` in lifecycle-worker.ts) — it never reaches `runCli`
 * directly, so it stays out of `CliCommand` and the allowlist it indexes.
 */
export const JOB_COMMANDS = [...CLI_COMMANDS, "teardown"] as const;
export type JobCommand = (typeof JOB_COMMANDS)[number];

/** Job-level commands that are removal-shaped: need `removal`, never a project bundle. */
export const REMOVAL_JOB_COMMANDS = [...REMOVAL_COMMANDS, "teardown"] as const;

export function isRemovalJobCommand(command: JobCommand): boolean {
  return (REMOVAL_JOB_COMMANDS as readonly string[]).includes(command);
}

export type DeployTargetKind = "shared" | "private";

export interface DeployProperty {
  name: string;
  value: string;
}

export interface DeployOptions {
  /** Business group name for the CLI's `--organization` flag. */
  organization?: string;
  environment: string;
  targetKind: DeployTargetKind;
  gateway?: string;
  targetSpace?: string;
  ingressGw?: string;
  egressGw?: string;
  properties: DeployProperty[];
}

/**
 * Options for `unpublish` / `undeploy`.
 *
 * Two targeting modes, mutually exclusive at the CLI level:
 *   - no `gav` — act on the uploaded project bundle via `--path`;
 *   - `gav` set — act on a remote asset by coordinates, with no bundle at all,
 *     which is the mode that matters when tearing down something you did not
 *     build locally.
 */
export interface RemovalOptions {
  /** Business group name for the CLI's `--organization` flag. */
  organization?: string;
  /**
   * Required by `undeploy` to locate the deployment. On `unpublish` it is
   * optional, and supplying it enables the CLI's active-instance safety check.
   */
  environment?: string;
  /** `groupId:assetId:version`. Present means remote-by-coordinates mode. */
  gav?: string;
  /**
   * `unpublish` only. Both modes erase the asset and neither can be undone;
   * a hard delete additionally frees the GAV so the version can be republished,
   * and Anypoint only permits it for a short window after the asset's creation.
   */
  hardDelete?: boolean;
}

/** One file of an Agent Network project, transferred inline. */
export interface ProjectFileEntry {
  filename: string;
  content: string;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** Terminal statuses — no further transitions happen after these. */
export const TERMINAL_STATUSES: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Non-secret identity of who/what triggered the job, for the audit trail. */
export interface JobActor {
  /** Stable user id from the web app's session. */
  userId: string;
  /** Optional display label (email/name) — never a secret. */
  label?: string;
}

/** Persisted job record. Never contains secrets. */
export interface JobRecord {
  id: string;
  command: JobCommand;
  status: JobStatus;
  /** Anypoint org this job targets. */
  orgId: string;
  /** Reference to the credential connection to resolve at run time. */
  connectionRef: string;
  actor: JobActor;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  ok?: boolean;
  /** Present when the job failed to start or run. */
  error?: string;
  /** Parsed final JSON from the CLI (publish/deploy), when available. */
  resultJson?: unknown;
}

const projectFileSchema = z.object({
  filename: z.string().min(1).max(1024),
  content: z.string(),
});

const deployPropertySchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string().max(8192),
});

const deployOptionsSchema = z.object({
  organization: z.string().max(128).optional(),
  environment: z.string().min(1).max(128),
  targetKind: z.enum(["shared", "private"]),
  gateway: z.string().max(128).optional(),
  targetSpace: z.string().max(128).optional(),
  ingressGw: z.string().max(128).optional(),
  egressGw: z.string().max(128).optional(),
  properties: z.array(deployPropertySchema).max(200).default([]),
});

/**
 * `groupId:assetId:version`. Kept strict because it reaches argv: each segment
 * is an Exchange identifier, so no whitespace, separators, or control chars.
 */
export const GAV_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*:[a-zA-Z0-9][a-zA-Z0-9._-]*:[a-zA-Z0-9][a-zA-Z0-9._+-]*$/;

const removalOptionsSchema = z.object({
  organization: z.string().max(128).optional(),
  environment: z.string().max(128).optional(),
  gav: z.string().max(512).regex(GAV_PATTERN).optional(),
  hardDelete: z.boolean().optional(),
});

const actorSchema = z.object({
  userId: z.string().min(1).max(256),
  label: z.string().max(256).optional(),
});

/** Body accepted by the enqueue route after server-side enrichment. */
export const jobRequestSchema = z
  .object({
    command: z.enum(JOB_COMMANDS),
    orgId: z.string().min(1).max(256),
    connectionRef: z.string().min(1).max(256),
    actor: actorSchema,
    /** Empty only for removals targeting a remote GAV, which need no bundle. */
    project: z.array(projectFileSchema).max(2000),
    deploy: deployOptionsSchema.optional(),
    removal: removalOptionsSchema.optional(),
    /**
     * The acting user's short-lived Anypoint access token. When present the
     * worker runs the CLI as that user via ANYPOINT_BEARER (their own org
     * permissions), so no per-org Connected App secret is needed. Never
     * persisted to the job record; only carried on the queued job payload.
     */
    userToken: z.string().min(1).max(8192).optional(),
    /** Control-plane base URL for the token (e.g. https://eu1.anypoint.mulesoft.com). */
    baseUrl: z.string().url().max(2048).optional(),
    /** Optional client-supplied key to make submissions idempotent. */
    idempotencyKey: z.string().min(1).max(256).optional(),
  })
  .refine((body) => body.command !== "deploy" || body.deploy !== undefined, {
    message: "deploy options are required for the deploy command",
    path: ["deploy"],
  })
  .refine((body) => !isRemovalJobCommand(body.command) || body.removal !== undefined, {
    message: "removal options are required for unpublish, undeploy, and teardown",
    path: ["removal"],
  })
  .refine((body) => body.removal?.gav !== undefined || body.project.length > 0, {
    message: "a project bundle is required unless a gav is supplied",
    path: ["project"],
  });

export type JobRequest = z.infer<typeof jobRequestSchema>;

/** Event envelope stored per job and streamed to clients over SSE. */
export type JobEvent =
  | { type: "status"; status: JobStatus; at: string }
  | { type: "log"; channel: "stdout" | "stderr" | "meta"; chunk: string; at: string }
  | {
      type: "result";
      ok: boolean;
      exitCode: number | null;
      json: unknown;
      at: string;
      /**
       * The specific step this result belongs to — the failed step, or the
       * last step run on success. Always a real `CliCommand`, never the
       * composite job command (e.g. a "teardown" job reports "undeploy" or
       * "unpublish" here), so diagnosis can key off the step that actually ran.
       */
      command?: CliCommand;
    };
