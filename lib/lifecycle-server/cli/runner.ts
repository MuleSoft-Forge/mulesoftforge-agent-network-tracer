/**
 * Spawn one allowlisted `agent-network project ...` command and stream its
 * output. Ported security model from electron/cli/runner.js:
 *   * only the three allowlisted commands may run — caller passes a key, never argv;
 *   * spawn uses shell:false, so shell metacharacters in any path are inert;
 *   * projectDir must contain exchange.json;
 *   * no caller-supplied flags are forwarded (deploy flags are re-validated);
 *   * resolved credentials are injected into the child env only and redacted
 *     from every emitted chunk.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { COMMANDS, DESCRIPTOR_FILE } from "../security/command-allowlist";
import { appendDeployArgv, deployContextEnv } from "../security/deploy-argv";
import { appendRemovalArgv } from "../security/removal-argv";
import { redactSecrets, redactValues } from "../redaction";
import { isRemovalCommand, type CliCommand, type DeployOptions, type RemovalOptions } from "../contracts";
import { config } from "../config";
import { withCliLock } from "./cli-lock";

export interface RunnerEvent {
  type: "start" | "output" | "end" | "error";
  channel?: "stdout" | "stderr" | "meta";
  chunk?: string;
  commandLine?: string;
  exitCode?: number | null;
  ok?: boolean;
  json?: unknown;
  message?: string;
}

export interface RunCliOptions {
  command: CliCommand;
  /**
   * Working directory for the CLI. Holds the project bundle for bundle-mode
   * runs; for a GAV-targeted removal it is an empty scratch dir, because the
   * child still needs a real cwd but there is no project to act on.
   */
  projectDir: string;
  deploy?: DeployOptions;
  /** Required for unpublish / undeploy. */
  removal?: RemovalOptions;
  /** Extra env for the child (resolved Anypoint credentials). */
  extraEnv: Record<string, string>;
  /** Inherited env vars to delete before applying extraEnv (auth conflicts). */
  unsetEnv?: string[];
  /** Literal secret strings to redact from all emitted output. */
  secretValues: string[];
  onEvent: (event: RunnerEvent) => void;
  /**
   * Registers the process so it can be stopped; returns an unregister fn.
   * `kill(true)` skips the grace period and sends SIGKILL immediately, for
   * callers that are about to exit and cannot wait for the escalation timer.
   */
  register?: (kill: (force?: boolean) => void) => () => void;
}

export interface RunCliResult {
  exitCode: number | null;
  ok: boolean;
  output: string;
  json: unknown;
}

/** Grace period between SIGTERM and SIGKILL for a timed-out CLI process. */
const SIGKILL_GRACE_MS = 10_000;

/** Named in the timeout message so an operator knows exactly what to raise. */
const TIMEOUT_ENV_VAR: Record<CliCommand, string> = {
  build: "LIFECYCLE_BUILD_TIMEOUT_MS",
  publish: "LIFECYCLE_PUBLISH_TIMEOUT_MS",
  deploy: "LIFECYCLE_DEPLOY_TIMEOUT_MS",
  unpublish: "LIFECYCLE_UNPUBLISH_TIMEOUT_MS",
  undeploy: "LIFECYCLE_UNDEPLOY_TIMEOUT_MS",
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** The child needs a real cwd on every path, bundle or not. */
function assertWorkingDir(projectDir: string): void {
  if (!projectDir || !path.isAbsolute(projectDir)) {
    throw new Error("Project directory must be an absolute path.");
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(projectDir);
  } catch {
    throw new Error(`Project directory does not exist: ${projectDir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${projectDir}`);
  }
}

function assertProjectBundle(projectDir: string): void {
  if (!fs.existsSync(path.join(projectDir, DESCRIPTOR_FILE))) {
    throw new Error(`Not an Agent Network project — ${DESCRIPTOR_FILE} not found.`);
  }
}

/** Pull the last top-level JSON value out of mixed log/JSON output. */
function extractLastJson(text: string): unknown {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // scan backwards for a balanced block
  }
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const ch = trimmed[i];
    if (ch !== "{" && ch !== "[") continue;
    try {
      return JSON.parse(trimmed.slice(i));
    } catch {
      // keep scanning
    }
  }
  return null;
}

export async function runCli(options: RunCliOptions): Promise<RunCliResult> {
  const { command, projectDir, deploy, removal, extraEnv, unsetEnv, secretValues, onEvent, register } =
    options;

  const spec = COMMANDS[command];
  if (!spec) {
    return Promise.reject(new Error(`Unsupported command: ${command}`));
  }
  assertWorkingDir(projectDir);

  // --gav and --path are mutually exclusive: a GAV-targeted removal resolves
  // the asset remotely and has no bundle on disk to point at.
  const removalCommand = isRemovalCommand(command);
  const targetsGav = removalCommand && Boolean(removal?.gav);
  if (!targetsGav) {
    assertProjectBundle(projectDir);
  }

  const argv: string[] = [...spec.argv];
  if (!targetsGav) {
    argv.push("--path", projectDir);
  }
  if (command === "deploy") {
    appendDeployArgv(argv, deploy);
  }
  if (removalCommand) {
    appendRemovalArgv(argv, command, removal);
  }
  const debugUnsupported = config.anypointCliDebug && !spec.debug;
  if (config.anypointCliDebug && spec.debug) {
    argv.push("--debug");
  }
  if (spec.json) {
    argv.push("--json");
  }

  const redact = (text: string): string => redactValues(redactSecrets(text), secretValues);

  // Say so rather than silently dropping it, so an operator who turned debug on
  // is not left wondering why this step produced no extra diagnostics.
  if (debugUnsupported) {
    onEvent({
      type: "output",
      channel: "meta",
      chunk: `ANYPOINT_CLI_DEBUG is on, but the ${command} command does not accept --debug — running without it.\n`,
    });
  }

  // Cancelling before this step has actually spawned (still queued behind
  // another CLI step on this machine, see cli-lock.ts) has nothing to kill —
  // route it through the same abort signal the lock checks before spawning.
  const abortController = new AbortController();
  let killChild: ((force?: boolean) => void) | null = null;
  const terminate = (force = false) => {
    if (killChild) {
      killChild(force);
    } else {
      abortController.abort();
    }
  };
  const unregister = register?.(terminate);

  try {
    return await withCliLock(
      abortController.signal,
      () =>
        new Promise<RunCliResult>((resolve) => {
          onEvent({
            type: "start",
            commandLine: redact(`${config.anypointCliPath} ${argv.join(" ")}`),
          });

          // Inherit the ambient env (PATH, HOME, …), but first drop any conflicting
          // auth vars so the resolved credentials are the only auth the CLI sees.
          const childEnv: NodeJS.ProcessEnv = { ...process.env };
          for (const key of unsetEnv ?? []) {
            delete childEnv[key];
          }
          Object.assign(childEnv, extraEnv, deployContextEnv(deploy), { FORCE_COLOR: "0" });

          const child = spawn(config.anypointCliPath, argv, {
            cwd: projectDir,
            shell: false,
            windowsHide: true,
            env: childEnv,
            // No stdin: the CLI must never be able to block forever on an interactive
            // prompt, since nothing is attached to answer it.
            stdio: ["ignore", "pipe", "pipe"],
          });

          const startedAt = Date.now();
          let lastOutputAt = startedAt;

          const emitMetaLine = (text: string) =>
            onEvent({ type: "output", channel: "meta", chunk: `${text}\n` });

          const signal = (sig: NodeJS.Signals) => {
            try {
              child.kill(sig);
            } catch {
              // already gone
            }
          };

          // Every path that stops a run (timeout, cancel, shutdown) escalates: a
          // process wedged in a syscall may ignore SIGTERM, and leaving it alive
          // would hold a worker slot indefinitely.
          let killTimer: NodeJS.Timeout | null = null;
          killChild = (force = false) => {
            if (force) {
              signal("SIGKILL");
              return;
            }
            signal("SIGTERM");
            if (killTimer) return;
            killTimer = setTimeout(() => signal("SIGKILL"), SIGKILL_GRACE_MS);
          };

          let output = "";
          let emittedBytes = 0;
          let capped = false;
          const collect = (stream: NodeJS.ReadableStream | null, channel: "stdout" | "stderr") => {
            if (!stream) return;
            stream.setEncoding("utf8");
            stream.on("data", (chunk: string) => {
              const clean = redact(chunk);
              lastOutputAt = Date.now();

              // Keep only a bounded tail: enough for the final JSON payload and
              // error scanning, without letting a chatty or looping CLI grow
              // unbounded.
              output = (output + clean).slice(-config.maxStepOutputBytes);

              if (capped) return;
              emittedBytes += clean.length;
              if (emittedBytes > config.maxStepOutputBytes) {
                capped = true;
                emitMetaLine(
                  `Output exceeded ${Math.round(config.maxStepOutputBytes / 1024)} KB — further output is not being streamed. The final result is still reported.`
                );
                return;
              }
              onEvent({ type: "output", channel, chunk: clean });
            });
          };
          collect(child.stdout, "stdout");
          collect(child.stderr, "stderr");

          // A CLI call to Anypoint can hang indefinitely (no client-side socket
          // timeout), which would otherwise occupy a worker slot forever and stall
          // every queued job behind it. Terminate it instead so the job can fail.
          const timeoutMs = config.cliTimeoutMsFor[command];
          const timeoutTimer = setTimeout(() => {
            emitMetaLine(
              `The ${command} step timed out after ${formatDuration(timeoutMs)} — terminating the CLI. ` +
                `A healthy run finishes in a couple of minutes, so this usually means the Anypoint request is hanging: retry. ` +
                `If this project is genuinely slower, raise ${TIMEOUT_ENV_VAR[command]}.`
            );
            terminate();
          }, timeoutMs);

          // `--json` steps print nothing until they finish, so report liveness to
          // keep the activity view from looking stalled.
          const heartbeatTimer = setInterval(() => {
            if (Date.now() - lastOutputAt < config.cliHeartbeatMs) return;
            emitMetaLine(`… still running (${formatDuration(Date.now() - startedAt)} elapsed)`);
          }, config.cliHeartbeatMs);

          const clearTimers = () => {
            clearTimeout(timeoutTimer);
            clearInterval(heartbeatTimer);
            if (killTimer) clearTimeout(killTimer);
          };

          child.on("error", (err) => {
            clearTimers();
            onEvent({ type: "error", message: redact(err.message) });
            resolve({ exitCode: null, ok: false, output, json: null });
          });
          child.on("close", (exitCode) => {
            clearTimers();
            const json = spec.json ? extractLastJson(output) : null;
            const ok = exitCode === 0;
            onEvent({ type: "end", exitCode, ok, json });
            resolve({ exitCode, ok, output, json });
          });
        }),
      () => ({ exitCode: null, ok: false, output: "", json: null })
    );
  } finally {
    unregister?.();
  }
}
