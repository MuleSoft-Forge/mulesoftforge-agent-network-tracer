"use client";

/**
 * Client driver for the remote (Railway) lifecycle backend.
 *
 * Mirrors the log/state shape of the desktop `useAgentNetworkCli` hook so the
 * same activity views can render it — but instead of local bridge execution,
 * it POSTs a project bundle to /api/lifecycle/jobs and streams
 * the job's events back over Server-Sent Events.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { LogLine } from "@/lib/lifecycle/log-lines";
import { deployOptionsReady } from "@/lib/desktop/deploy-options";
import type {
  DeployOptions,
  JobCommand,
  JobEvent,
  JobStatus,
  ProjectFileEntry,
  RemoteJobAccepted,
  RemovalOptions,
} from "@/lib/lifecycle/types";
import { isRemovalCommand, isTerminalStatus } from "@/lib/lifecycle/types";
import type { ProjectDeployVariable } from "@/lib/desktop/deploy-options";

export interface RemoteRunResult {
  command: JobCommand;
  ok: boolean;
  error?: string;
  jobId?: string;
}

interface SubmitArgs {
  command: JobCommand;
  project: ProjectFileEntry[];
  deploy?: DeployOptions;
  /** Required for unpublish / undeploy. */
  removal?: RemovalOptions;
  /** Variables for the deploy-readiness pre-check (deploy only). */
  variables?: ProjectDeployVariable[];
  /** When true, keep existing log and append this run's events. */
  appendLog?: boolean;
}

/** How often to verify a running job against its record on the server. */
const STATUS_POLL_MS = 10_000;

export function useRemoteAgentNetworkCli() {
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState<JobCommand | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<RemoteRunResult | null>(null);

  const sourceRef = useRef<EventSource | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef<JobCommand | null>(null);

  const append = useCallback((line: LogLine) => {
    setLog((prev) => [...prev, line]);
  }, []);

  const closeStream = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  /** Stop waiting on a run, from either the event stream or the watchdog. */
  const finishRun = useCallback(() => {
    runningRef.current = null;
    setRunning(null);
    closeStream();
  }, [closeStream]);

  useEffect(() => closeStream, [closeStream]);

  const handleEvent = useCallback(
    (event: JobEvent, command: JobCommand) => {
      switch (event.type) {
        case "log":
          append({ channel: event.channel, text: event.chunk });
          break;
        case "status":
          setStatus(event.status);
          if (event.status === "cancelled") {
            append({ channel: "stderr", text: "Cancelled." });
          }
          if (isTerminalStatus(event.status)) {
            finishRun();
          }
          break;
        case "result": {
          // For a composite command (teardown) the event names the specific
          // step that produced this result, so diagnosis keys off the step
          // that actually ran/failed rather than the umbrella job command.
          const resolvedCommand = event.command ?? command;
          append({
            channel: event.ok ? "meta" : "stderr",
            text: event.ok ? "✅ Completed successfully." : `❌ The ${resolvedCommand} run failed.`,
          });
          setLastResult({ command: resolvedCommand, ok: event.ok });
          finishRun();
          break;
        }
        default: {
          const _exhaustive: never = event;
          void _exhaustive;
          break;
        }
      }
    },
    [append, finishRun]
  );

  /**
   * Independent check on the job record, so the UI stops waiting even if the
   * event stream never delivers a terminal event — a dropped SSE connection, a
   * server restart mid-stream, or a job reaped by the worker.
   */
  const pollJobStatus = useCallback(
    async (id: string, command: JobCommand) => {
      if (!runningRef.current) return;
      let res: Response;
      try {
        res = await fetch(`/api/lifecycle/jobs/${encodeURIComponent(id)}`);
      } catch {
        return; // Transient — try again on the next tick.
      }
      if (!runningRef.current) return;

      if (res.status === 404) {
        append({ channel: "stderr", text: "This job is no longer available on the server." });
        setLastResult({ command, ok: false, error: "job_not_found" });
        finishRun();
        return;
      }
      if (!res.ok) return;

      const body = (await res.json().catch(() => null)) as { job?: { status?: JobStatus } } | null;
      const status = body?.job?.status;
      if (!status || !isTerminalStatus(status) || !runningRef.current) return;

      append({
        channel: status === "succeeded" ? "meta" : "stderr",
        text: `Job ${status} (detected by status check — the live log stream ended early).`,
      });
      setStatus(status);
      setLastResult({ command, ok: status === "succeeded" });
      finishRun();
    },
    [append, finishRun]
  );

  const openStream = useCallback(
    (id: string, command: JobCommand) => {
      closeStream();
      const source = new EventSource(`/api/lifecycle/jobs/${encodeURIComponent(id)}/stream`);
      sourceRef.current = source;

      source.onmessage = (message) => {
        if (!message.data) return;
        try {
          handleEvent(JSON.parse(message.data) as JobEvent, command);
        } catch {
          // ignore malformed frames
        }
      };
      source.onerror = () => {
        // EventSource reconnects on its own (the stream route replays the log),
        // so this is only worth reporting while the job is still running.
        if (sourceRef.current === source && runningRef.current) {
          append({ channel: "stderr", text: "Log stream disconnected — retrying." });
        }
      };

      watchdogRef.current = setInterval(() => {
        void pollJobStatus(id, command);
      }, STATUS_POLL_MS);
    },
    [append, closeStream, handleEvent, pollJobStatus]
  );

  const submit = useCallback(
    async (args: SubmitArgs): Promise<RemoteRunResult | null> => {
      const { command, project, deploy, removal, variables, appendLog } = args;

      const reject = (reason: string): RemoteRunResult => {
        setLog([{ channel: "stderr", text: reason }]);
        setLastResult({ command, ok: false, error: reason });
        return { command, ok: false, error: reason };
      };

      if (command === "deploy") {
        const readiness = deployOptionsReady(
          deploy ?? ({ environment: "", targetKind: "shared", properties: [] } as DeployOptions),
          variables ?? []
        );
        if (!readiness.ok) return reject(readiness.reason);
      }

      // Mirror the server's refinements so a mistargeted teardown fails here
      // rather than as an opaque 400.
      if (isRemovalCommand(command)) {
        // "teardown" runs undeploy first, so it needs the environment too.
        if ((command === "undeploy" || command === "teardown") && !removal?.environment?.trim()) {
          return reject("Choose the environment the network is deployed to.");
        }
        if (!removal?.gav?.trim() && project.length === 0) {
          return reject("Load a project or enter a GAV to identify what to remove.");
        }
      }

      if (!appendLog) {
        setLog([]);
      }
      setLastResult(null);
      setStatus("queued");
      runningRef.current = command;
      setRunning(command);

      try {
        const res = await fetch("/api/lifecycle/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, project, deploy, removal }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`Failed to submit job (${res.status}). ${detail}`.trim());
        }
        const accepted = (await res.json()) as RemoteJobAccepted;
        setJobId(accepted.jobId);
        setStatus(accepted.status);
        openStream(accepted.jobId, command);
        return { command, ok: true, jobId: accepted.jobId };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        append({ channel: "stderr", text: message });
        setLastResult({ command, ok: false, error: message });
        finishRun();
        return null;
      }
    },
    [append, finishRun, openStream]
  );

  const cancel = useCallback(async () => {
    if (!jobId) return false;
    append({ channel: "meta", text: "Cancelling…" });
    try {
      await fetch(`/api/lifecycle/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
      return true;
    } catch {
      return false;
    }
  }, [jobId, append]);

  const clearLog = useCallback(() => {
    setLog([]);
    setLastResult(null);
    setStatus(null);
  }, []);

  return {
    log,
    running,
    status,
    jobId,
    lastResult,
    submit,
    cancel,
    clearLog,
    busy: running !== null,
  };
}
