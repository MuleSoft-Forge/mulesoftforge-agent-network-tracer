/**
 * Lifecycle worker process: consumes lifecycle jobs, runs the allowlisted CLI
 * command in an isolated workspace, streams redacted output into the job event
 * log, and records a final status.
 *
 * Runs as its own process (separate from the Next.js web server) from the same
 * image: `node --import tsx lifecycle-worker.ts`.
 */

import { Worker } from "bullmq";
import { config } from "./lib/lifecycle-server/config";
import { createRedis } from "./lib/lifecycle-server/redis";
import { JobStore, CANCEL_CHANNEL } from "./lib/lifecycle-server/store";
import {
  createScratchWorkspace,
  createWorkspace,
  sweepStaleWorkspaces,
} from "./lib/lifecycle-server/workspace";
import { runCli, type RunnerEvent } from "./lib/lifecycle-server/cli/runner";
import { bearerCredentials } from "./lib/lifecycle-server/credentials/resolver";
import { finalizeJob } from "./lib/lifecycle-server/finalize";
import { logger } from "./lib/lifecycle-server/logger";
import { redactSecrets, redactValues } from "./lib/lifecycle-server/redaction";
import { fetchDeployFailureLogs } from "./lib/lifecycle-server/runtime-manager-logs";
import type { LifecycleJobData } from "./lib/lifecycle-server/queue";
import {
  isRemovalCommand,
  isTerminal,
  type CliCommand,
  type JobCommand,
  type JobEvent,
} from "./lib/lifecycle-server/contracts";
import { diagnoseDeployOutput, primaryDiagnosis } from "./lib/lifecycle/deploy-diagnostics";

/**
 * Steps to run, in order, in a single shared workspace for a requested command.
 *
 * Build output (target/) lives on disk, and each job gets a fresh workspace that
 * is deleted afterwards — so publish/deploy must be preceded by a build within
 * the same job, mirroring the desktop flow where all commands hit one folder.
 */
function commandsFor(command: JobCommand): CliCommand[] {
  switch (command) {
    case "build":
      return ["build"];
    case "publish":
      return ["build", "publish"];
    case "deploy":
      return ["build", "deploy"];
    // Teardown acts on what is already published or deployed, so building the
    // local project first would be wasted work — and impossible in GAV mode,
    // where there is no project.
    case "unpublish":
      return ["unpublish"];
    case "undeploy":
      return ["undeploy"];
    // Composite: undeploy first (unpublish refuses while resources are still
    // deployed — errorCode 2007), then unpublish. Same shared `removal`
    // payload serves both; undeploy already requires `environment`, and
    // unpublish picks it up too for its own active-instance safety check.
    case "teardown":
      return ["undeploy", "unpublish"];
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
}

const storeRedis = createRedis();
const store = new JobStore(storeRedis);

/** Running jobs -> kill fn, so a cancel message or shutdown can stop the child. */
const running = new Map<string, (force?: boolean) => void>();

const cancelSub = createRedis();
void cancelSub.subscribe(CANCEL_CHANNEL);
cancelSub.on("message", (_channel, jobId) => {
  const kill = running.get(jobId);
  if (kill) kill();
});

async function processJob(data: LifecycleJobData): Promise<void> {
  const { jobId, command, orgId, project, deploy, removal, userToken, baseUrl } = data;

  // Cancelling a job that hasn't started yet only marks the record; the queue
  // entry survives, so honour that cancellation instead of running it now.
  const existing = await store.getJob(jobId);
  if (existing && isTerminal(existing.status)) {
    logger.info("skipping job that is already finished", {
      jobId,
      command,
      status: existing.status,
    });
    return;
  }

  await store.setStatus(jobId, "running");
  await store.patchJob(jobId, { startedAt: new Date().toISOString() });

  // Event writes are best-effort: they are fired without awaiting in the hot
  // output path, so an unguarded rejection (a Redis blip) would surface as an
  // unhandled rejection and take the whole worker down mid-job.
  const safeAppend = (event: JobEvent): Promise<void> =>
    store.appendEvent(jobId, event).catch((err) => {
      logger.error("job event write failed", {
        jobId,
        error: redactSecrets(err instanceof Error ? err.message : String(err)),
      });
    });

  const emitMeta = (text: string) =>
    safeAppend({
      type: "log",
      channel: "meta",
      chunk: redactSecrets(text),
      at: new Date().toISOString(),
    });

  let workspace: { dir: string; cleanup: () => Promise<void> } | null = null;
  try {
    if (!userToken?.trim()) {
      throw new Error(
        "Missing user token for lifecycle job. Re-authenticate and try again."
      );
    }
    const credentials = bearerCredentials(userToken, baseUrl);
    void emitMeta(
      `Authenticated as ${data.actor.label ?? data.actor.userId} (org ${orgId}) via user token.`
    );
    // A GAV-targeted removal carries no bundle, so there is nothing to write —
    // it still gets a job directory to run in, and to be swept afterwards.
    const gav = removal?.gav;
    workspace = gav ? await createScratchWorkspace(jobId) : await createWorkspace(jobId, project);
    if (gav) {
      void emitMeta(`Targeting remote asset ${gav} — no project bundle needed.`);
    }

    const onEvent = (event: RunnerEvent) => {
      switch (event.type) {
        case "start":
          void emitMeta(`$ ${event.commandLine ?? command}`);
          break;
        case "output":
          void safeAppend({
            type: "log",
            channel: event.channel ?? "stdout",
            chunk: event.chunk ?? "",
            at: new Date().toISOString(),
          });
          break;
        case "error":
          void emitMeta(`Error: ${event.message ?? "unknown error"}`);
          break;
        case "end":
          break;
        default: {
          const _exhaustive: never = event.type;
          void _exhaustive;
          break;
        }
      }
    };

    // Run build (and, for publish/deploy, the prerequisite build) in the same
    // workspace so on-disk artifacts carry across steps. Stop at the first
    // failure and report that step's result.
    const steps = commandsFor(command);
    let failedStep: CliCommand | null = null;
    let result = { exitCode: null as number | null, ok: false, output: "", json: null as unknown };
    for (const step of steps) {
      if (steps.length > 1) void emitMeta(`— ${step} —`);
      result = await runCli({
        command: step,
        projectDir: workspace.dir,
        deploy: step === "deploy" ? deploy : undefined,
        removal: isRemovalCommand(step) ? removal : undefined,
        extraEnv: credentials.env,
        unsetEnv: credentials.unsetEnv,
        secretValues: credentials.secretValues,
        onEvent,
        register: (kill) => {
          running.set(jobId, kill);
          return () => running.delete(jobId);
        },
      });
      if (!result.ok) {
        failedStep = step;
        break;
      }
    }

    // A cancel marks the record terminal and then kills the child, so the exit
    // we just observed is the *result* of cancelling. Reporting it as a failure
    // would contradict the "Cancelled" the user already saw.
    const afterRun = await store.getJob(jobId);
    if (afterRun && isTerminal(afterRun.status)) {
      logger.info("job stopped by cancel", { jobId, command, status: afterRun.status });
      return;
    }

    // A failed deploy usually means the app was created but never went healthy
    // in Runtime Manager — the CLI's generic timeout / "aborted" text hides the
    // real cause, which lives in the app's own log. Pull that log in, stream it
    // into the event log, and feed it to the diagnosis catalog so both this
    // worker's summary and the web popup can name the actual failure.
    let runtimeManagerLog = "";
    if (failedStep === "deploy" && deploy && userToken && baseUrl) {
      const redactLine = (text: string) =>
        redactValues(redactSecrets(text), credentials.secretValues);
      try {
        void emitMeta("Deploy failed — checking Runtime Manager for the deployment's own logs…");
        const rmLogs = await fetchDeployFailureLogs({
          baseUrl,
          orgId,
          accessToken: userToken,
          environmentName: deploy.environment,
          project,
        });
        if (!rmLogs.environmentFound) {
          void emitMeta(
            `Couldn't match the deploy environment "${deploy.environment}" in Runtime Manager, so its logs weren't fetched.`
          );
        } else if (rmLogs.bundles.length === 0) {
          void emitMeta(
            "Couldn't find this deployment's logs in Runtime Manager (no name match, no permission, or nothing logged yet). Open Runtime Manager → your app → Logs to see the runtime error."
          );
        } else {
          const collected: string[] = [];
          for (const bundle of rmLogs.bundles) {
            void emitMeta(`— Runtime Manager log · ${bundle.deploymentName} —`);
            for (const line of bundle.lines) {
              const clean = redactLine(line);
              collected.push(clean);
              void safeAppend({
                type: "log",
                channel: "stderr",
                chunk: `${clean}\n`,
                at: new Date().toISOString(),
              });
            }
          }
          // A closing marker so the client can always tell where the streamed
          // log block ends, even when no diagnosis line follows it.
          void emitMeta("— end of Runtime Manager log —");
          runtimeManagerLog = collected.join("\n");
        }
      } catch (err) {
        void emitMeta(
          `Couldn't read Runtime Manager logs automatically: ${redactSecrets(
            err instanceof Error ? err.message : String(err)
          )}`
        );
      }
    }

    // Scan the finished-job output (plus any Runtime Manager log we pulled in)
    // for known error signatures and, when one is recognized, drop a
    // plain-language summary into the log. The web panel runs the same catalog
    // to surface the full explanation and fixes in a popup.
    const diagnosis = primaryDiagnosis(
      diagnoseDeployOutput({
        command: failedStep,
        orgId,
        resultJson: result.json,
        output: `${result.output}\n${runtimeManagerLog}`,
      })
    );
    if (diagnosis) {
      await emitMeta(`${diagnosis.title} — ${diagnosis.summary}`);
    }

    await store.patchJob(jobId, {
      finishedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      ok: result.ok,
      resultJson: result.json,
    });
    await store.appendEvent(jobId, {
      type: "result",
      ok: result.ok,
      exitCode: result.exitCode,
      json: result.json,
      // The failed step, or the last step run on success — a composite
      // command like "teardown" never appears here, only the real CLI step
      // that produced this result, so the client can diagnose against it.
      command: failedStep ?? steps[steps.length - 1],
      at: new Date().toISOString(),
    });
    await store.setStatus(jobId, result.ok ? "succeeded" : "failed");
    logger.info("job finished", { jobId, command, ok: result.ok, exitCode: result.exitCode });
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
    await store.patchJob(jobId, { finishedAt: new Date().toISOString(), ok: false, error: message });
    await emitMeta(`Failed: ${message}`);
    await store.setStatus(jobId, "failed");
    logger.error("job errored", { jobId, command, error: message });
  } finally {
    running.delete(jobId);
    if (workspace) {
      await workspace.cleanup().catch(() => undefined);
    }
  }
}

const worker = new Worker<LifecycleJobData>(
  config.queueName,
  async (job) => {
    await processJob(job.data);
  },
  {
    connection: createRedis(),
    concurrency: config.workerConcurrency,
    lockDuration: config.lockDurationMs,
  }
);

// processJob records its own failures, so reaching here means the failure was at
// the queue level (lock lost, stalled, payload rejected) and no terminal event
// has been written for the client.
worker.on("failed", (job, err) => {
  const jobId = job?.data?.jobId;
  const message = redactSecrets(err?.message ?? String(err));
  logger.error("bullmq job failed", { jobId, error: message });
  if (!jobId) return;
  void finalizeJob({
    store,
    jobId,
    status: "failed",
    message: `The worker could not complete this job: ${message}`,
  }).catch(() => undefined);
});

worker.on("error", (err) => {
  logger.error("worker error", { error: redactSecrets(err?.message ?? String(err)) });
});

worker.on("ready", () =>
  logger.info("worker ready", {
    queue: config.queueName,
    concurrency: config.workerConcurrency,
    cliTimeoutMs: config.cliTimeoutMsFor,
  })
);

/**
 * Fail jobs that can no longer be running.
 *
 * A worker killed mid-job (deploy, OOM, machine restart) leaves its job marked
 * `running` forever, and a client watching that job would wait forever. Any
 * non-terminal job older than the CLI timeout plus slack is provably abandoned:
 * a healthy worker would have timed it out by then. Jobs this process is
 * actively running are always skipped.
 */
const ABANDON_AFTER_MS = config.maxCliTimeoutMs + config.abandonSlackMs;

async function reapAbandonedJobs(): Promise<void> {
  const cutoff = Date.now() - ABANDON_AFTER_MS;
  for (const jobId of await store.listJobIds()) {
    if (running.has(jobId)) continue;
    const record = await store.getJob(jobId);
    if (!record || isTerminal(record.status)) continue;

    const since = Date.parse(record.startedAt ?? record.createdAt);
    if (Number.isFinite(since) && since > cutoff) continue;

    const finalized = await finalizeJob({
      store,
      jobId,
      status: "failed",
      message:
        record.status === "queued"
          ? "No worker ever picked this job up, so it was abandoned. Submit it again."
          : "The worker running this job stopped before it finished (restart, deploy, or crash), so it was abandoned. Submit it again.",
    });
    if (finalized) logger.warn("reaped abandoned job", { jobId, wasStatus: record.status });
  }
}

const REAP_INTERVAL_MS = 60_000;
const reaper = setInterval(() => {
  void reapAbandonedJobs().catch((err) => {
    logger.error("reaper failed", {
      error: redactSecrets(err instanceof Error ? err.message : String(err)),
    });
  });
}, REAP_INTERVAL_MS);

async function bootstrap(): Promise<void> {
  const removed = await sweepStaleWorkspaces(config.workspaceMaxAgeMs);
  if (removed > 0) logger.info("swept stale workspaces", { removed });
  await reapAbandonedJobs();
}

void bootstrap().catch((err) => {
  logger.error("bootstrap failed", {
    error: redactSecrets(err instanceof Error ? err.message : String(err)),
  });
});

/**
 * Staying alive is better than dying: a crash strands every in-flight job until
 * the reaper catches it, so we log and keep serving instead.
 */
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled rejection", {
    error: redactSecrets(reason instanceof Error ? reason.message : String(reason)),
  });
});
process.on("uncaughtException", (err) => {
  logger.error("uncaught exception", { error: redactSecrets(err.message) });
});

/**
 * Shutdown budget. Every stage is bounded: an unreachable Redis makes ioredis
 * queue commands indefinitely, so an unbounded `quit()` would hang the process
 * until the platform SIGKILLs it — losing the in-flight bookkeeping that this
 * path exists to do. Must stay under fly.toml's kill_timeout.
 */
const SHUTDOWN_DEADLINE_MS = 25_000;
/** Long enough for a child to ignore SIGTERM and be SIGKILLed, then wrap up. */
const DRAIN_TIMEOUT_MS = 13_000;
const FINALIZE_TIMEOUT_MS = 3_000;
const REDIS_QUIT_TIMEOUT_MS = 2_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves when `work` settles or `ms` elapses, whichever comes first. */
async function within(work: Promise<unknown>, ms: number): Promise<void> {
  await Promise.race([work.catch(() => undefined), delay(ms)]);
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("worker shutting down", { signal, inFlight: running.size });

  const deadline = setTimeout(() => {
    logger.error("shutdown exceeded its deadline — exiting now", { signal });
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS);

  try {
    clearInterval(reaper);

    // Terminating the children lets each processJob finish normally and write
    // its own terminal state; we only step in for what hasn't finished in time.
    for (const kill of running.values()) kill();
    await within(worker.close(), DRAIN_TIMEOUT_MS);

    // Anything still registered has a child that outlived the drain — SIGKILL it
    // now, because the runner's escalation timer dies with this process and the
    // CLI would otherwise be orphaned, still holding its Anypoint connection.
    for (const [jobId, kill] of running) {
      logger.warn("force killing CLI that survived shutdown", { jobId });
      kill(true);
    }

    for (const jobId of [...running.keys()]) {
      await within(
        finalizeJob({
          store,
          jobId,
          status: "failed",
          message: "The worker shut down while this job was running. Submit it again.",
        }),
        FINALIZE_TIMEOUT_MS
      );
    }

    await within(
      Promise.allSettled([storeRedis.quit(), cancelSub.quit()]),
      REDIS_QUIT_TIMEOUT_MS
    );
  } catch (err) {
    logger.error("shutdown failed", {
      error: redactSecrets(err instanceof Error ? err.message : String(err)),
    });
  } finally {
    clearTimeout(deadline);
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
