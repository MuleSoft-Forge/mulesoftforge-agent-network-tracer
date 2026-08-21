/**
 * Central runtime configuration for the lifecycle server code (API routes +
 * worker), parsed once from the environment.
 *
 * Under Next.js the environment is already populated (.env.local etc.). The
 * standalone worker process (`node --import tsx lifecycle-worker.ts`) does NOT
 * go through Next's env loading, so we also try Node's built-in .env loader for
 * local development. Existing environment variables always take precedence
 * (Node's loader never overrides them), so this is a no-op on Fly where secrets
 * arrive via the platform.
 */

import type { CliCommand } from "./contracts";

function tryLoadEnvFile(path: string): void {
  try {
    const proc = process as unknown as { loadEnvFile?: (path?: string) => void };
    proc.loadEnvFile?.(path);
  } catch {
    // File absent or loader unavailable — rely on the ambient environment.
  }
}

tryLoadEnvFile(".env.local");
tryLoadEnvFile(".env");

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function intOptional(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Env var ${name} must be a positive integer.`);
  }
  return parsed;
}

function boolOptional(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Env var ${name} must be a boolean (true/false/1/0).`);
}

export interface Config {
  redisUrl: string;
  anypointCliPath: string;
  workspaceRoot: string;
  maxBundleBytes: number;
  jobRetentionSeconds: number;
  queueName: string;
  anypointCliDebug: boolean;
  /**
   * Wall-clock ceiling per CLI step. Observed healthy runs finish in ~2 minutes,
   * so these are generous; a step that exceeds its ceiling is wedged, not slow,
   * and waiting longer only delays the failure the user is waiting to see.
   */
  cliTimeoutMsFor: Record<CliCommand, number>;
  /** Longest any step may run — used to decide when a job is abandoned. */
  maxCliTimeoutMs: number;
  cliHeartbeatMs: number;
  /** Jobs run in parallel per worker process. */
  workerConcurrency: number;
  /** BullMQ job lock; renewed while the worker's event loop is healthy. */
  lockDurationMs: number;
  /** Cap on CLI output kept in memory and streamed per step. */
  maxStepOutputBytes: number;
  /** Age at which an abandoned job workspace is swept on worker start. */
  workspaceMaxAgeMs: number;
  /** Grace added to the CLI timeout before a non-terminal job is declared abandoned. */
  abandonSlackMs: number;
}

/**
 * Per-step timeout, in order of precedence: the step's own variable, then the
 * blanket LIFECYCLE_CLI_TIMEOUT_MS (which overrides every step at once), then
 * the built-in default.
 */
function stepTimeoutMs(envName: string, fallbackMs: number): number {
  const blanket = process.env.LIFECYCLE_CLI_TIMEOUT_MS;
  const base = blanket && blanket.trim() ? intOptional("LIFECYCLE_CLI_TIMEOUT_MS", fallbackMs) : fallbackMs;
  return intOptional(envName, base);
}

const cliTimeoutMsFor: Record<CliCommand, number> = {
  build: stepTimeoutMs("LIFECYCLE_BUILD_TIMEOUT_MS", 4 * 60 * 1000),
  publish: stepTimeoutMs("LIFECYCLE_PUBLISH_TIMEOUT_MS", 6 * 60 * 1000),
  deploy: stepTimeoutMs("LIFECYCLE_DEPLOY_TIMEOUT_MS", 5 * 60 * 1000),
  unpublish: stepTimeoutMs("LIFECYCLE_UNPUBLISH_TIMEOUT_MS", 5 * 60 * 1000),
  // The CLI's own --process-timeout for undeploy defaults to 15 minutes. A
  // lower ceiling here would SIGKILL a teardown the CLI still considers healthy,
  // so this matches it rather than undercutting it. Note this raises
  // maxCliTimeoutMs, and therefore the abandoned-job window, for every command.
  undeploy: stepTimeoutMs("LIFECYCLE_UNDEPLOY_TIMEOUT_MS", 15 * 60 * 1000),
};

export const config: Config = {
  redisUrl: optional("REDIS_URL", "redis://localhost:6379"),
  anypointCliPath: optional("ANYPOINT_CLI_PATH", "anypoint-cli-v4"),
  workspaceRoot: optional("WORKSPACE_ROOT", "/tmp/anf-jobs"),
  maxBundleBytes: intOptional("MAX_BUNDLE_BYTES", 5 * 1024 * 1024),
  jobRetentionSeconds: intOptional("JOB_RETENTION_SECONDS", 24 * 60 * 60),
  queueName: optional("QUEUE_NAME", "lifecycle-jobs"),
  anypointCliDebug: boolOptional("ANYPOINT_CLI_DEBUG", false),
  cliTimeoutMsFor,
  maxCliTimeoutMs: Math.max(...Object.values(cliTimeoutMsFor)),
  cliHeartbeatMs: intOptional("LIFECYCLE_CLI_HEARTBEAT_MS", 30 * 1000),
  workerConcurrency: intOptional("LIFECYCLE_WORKER_CONCURRENCY", 4),
  lockDurationMs: intOptional("LIFECYCLE_LOCK_DURATION_MS", 60 * 1000),
  maxStepOutputBytes: intOptional("LIFECYCLE_MAX_STEP_OUTPUT_BYTES", 2 * 1024 * 1024),
  workspaceMaxAgeMs: intOptional("LIFECYCLE_WORKSPACE_MAX_AGE_MS", 6 * 60 * 60 * 1000),
  abandonSlackMs: intOptional("LIFECYCLE_ABANDON_SLACK_MS", 5 * 60 * 1000),
};
