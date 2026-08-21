"use client";

/**
 * Operator view of the Fly deployment: platform health, the machines behind it,
 * and the lifecycle build queue running on them — with the handful of actions
 * that fix the common failures, so a stuck build does not require `flyctl`.
 *
 * Everything rendered here is read live on each refresh. Nothing is cached
 * client-side, because a stale ops page is worse than no ops page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Cpu,
  Database,
  Layers,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Server,
  Square,
  Terminal,
  Trash2,
  XCircle,
} from "lucide-react";
import type { JobEvent, JobRecord } from "@/lib/lifecycle/types";
import type {
  FlyMachineAction,
  FlyMachineSummary,
  OpsActionResponse,
  OpsCheck,
  OpsCheckLevel,
  OpsReport,
  QueueActionRequest,
  QueueJobSummary,
} from "@/lib/ops/types";
import { formatAgo, formatBytes, formatClock, formatDuration, formatSeconds, shortId } from "./format";

const REFRESH_INTERVAL_MS = 10_000;

const LEVEL_STYLES: Record<OpsCheckLevel, { border: string; badge: string; Icon: typeof CheckCircle2 }> = {
  ok: { border: "border-emerald-200 bg-emerald-50/60", badge: "text-emerald-700", Icon: CheckCircle2 },
  warn: { border: "border-amber-200 bg-amber-50/60", badge: "text-amber-700", Icon: AlertTriangle },
  fail: { border: "border-red-200 bg-red-50/60", badge: "text-red-700", Icon: XCircle },
  unknown: { border: "border-gray-200 bg-gray-50/60", badge: "text-gray-600", Icon: CircleHelp },
};

const MACHINE_STATE_STYLES: Record<string, string> = {
  started: "bg-emerald-100 text-emerald-700",
  stopped: "bg-gray-200 text-gray-700",
  starting: "bg-blue-100 text-blue-700",
  stopping: "bg-amber-100 text-amber-700",
  suspended: "bg-amber-100 text-amber-700",
  destroyed: "bg-red-100 text-red-700",
  failed: "bg-red-100 text-red-700",
};

const JOB_STATE_STYLES: Record<QueueJobSummary["state"], string> = {
  active: "bg-blue-100 text-blue-700",
  waiting: "bg-amber-100 text-amber-700",
  delayed: "bg-purple-100 text-purple-700",
  failed: "bg-red-100 text-red-700",
  completed: "bg-emerald-100 text-emerald-700",
};

function Pill({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {label}
    </span>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  disabled,
  tone = "neutral",
  Icon,
  title,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
  tone?: "neutral" | "danger" | "primary";
  Icon: typeof RefreshCw;
  title?: string;
}) {
  const tones = {
    neutral: "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
    danger: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
    primary: "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      title={title ?? label}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

function Section({
  title,
  subtitle,
  Icon,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  Icon: typeof Server;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Icon className="h-4.5 w-4.5 text-gray-400" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
            {subtitle ? <p className="text-xs text-gray-500">{subtitle}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-6 text-sm text-gray-500">{children}</p>;
}

function JobDetailsDialog({
  jobId,
  record,
  events,
  loading,
  error,
  onClose,
}: {
  jobId: string;
  record: JobRecord | null;
  events: JobEvent[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="job-details-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h2 id="job-details-title" className="text-sm font-semibold text-gray-900">
              Build details
            </h2>
            <p className="font-mono text-[11px] text-gray-500">{jobId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading logs…
            </div>
          ) : null}
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}
          {!loading && !error && !record ? (
            <p className="text-sm text-gray-500">No job record found.</p>
          ) : null}

          {record ? (
            <div className="mb-3 grid gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 sm:grid-cols-2">
              <p>
                <span className="font-medium">Command:</span> {record.command}
              </p>
              <p>
                <span className="font-medium">Status:</span> {record.status}
              </p>
              <p>
                <span className="font-medium">Org:</span> {record.orgId}
              </p>
              <p>
                <span className="font-medium">Actor:</span> {record.actor?.label ?? record.actor?.userId}
              </p>
              <p>
                <span className="font-medium">Started:</span> {record.startedAt ?? "—"}
              </p>
              <p>
                <span className="font-medium">Finished:</span> {record.finishedAt ?? "—"}
              </p>
              {record.error ? (
                <p className="sm:col-span-2">
                  <span className="font-medium">Error:</span> {record.error}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-lg border border-gray-200">
            <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700">
              Event log ({events.length})
            </div>
            <pre className="max-h-[50vh] overflow-auto bg-gray-950 p-3 text-[11px] leading-relaxed text-gray-200">
              {events.length === 0
                ? "No events recorded."
                : events
                    .map((event) => {
                      if (event.type === "log") {
                        const chunk = event.chunk.endsWith("\n") ? event.chunk.slice(0, -1) : event.chunk;
                        return `[${event.at}] [${event.channel}] ${chunk}`;
                      }
                      if (event.type === "status") return `[${event.at}] [status] ${event.status}`;
                      return `[${event.at}] [result] ok=${event.ok} exit=${event.exitCode ?? "null"} json=${JSON.stringify(event.json)}`;
                    })
                    .join("\n")}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChecksGrid({ checks }: { checks: OpsCheck[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {checks.map((check) => {
        const style = LEVEL_STYLES[check.level];
        return (
          <div key={check.id} className={`rounded-xl border p-4 ${style.border}`}>
            <div className="flex items-start gap-2.5">
              <style.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.badge}`} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{check.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-700">{check.detail}</p>
                {check.action ? (
                  <p className="mt-2 text-xs leading-relaxed text-gray-500">{check.action}</p>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function OpsDashboard() {
  const [report, setReport] = useState<OpsReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<OpsActionResponse | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobDetails, setJobDetails] = useState<{ record: JobRecord | null; events: JobEvent[] } | null>(null);
  const [jobDetailsLoading, setJobDetailsLoading] = useState(false);
  const [jobDetailsError, setJobDetailsError] = useState<string | null>(null);

  // Refresh runs on a timer and after every action; the guard stops those
  // overlapping into a queue of requests against an already-struggling backend.
  const inFlight = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const res = await fetch("/api/ops/diagnostics", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setLoadError(body?.message ?? `Diagnostics request failed (${res.status}).`);
        return;
      }
      setReport((await res.json()) as OpsReport);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, refresh]);

  const post = useCallback(
    async (key: string, url: string, body: unknown): Promise<void> => {
      setPendingAction(key);
      setActionResult(null);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await res.json().catch(() => null)) as Partial<OpsActionResponse> | null;
        setActionResult({
          ok: res.ok && payload?.ok !== false,
          message: payload?.message ?? (res.ok ? "Done." : `Request failed (${res.status}).`),
        });
      } catch (err) {
        setActionResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
      } finally {
        setPendingAction(null);
        await refresh();
      }
    },
    [refresh]
  );

  const queueAction = useCallback(
    (key: string, request: QueueActionRequest) => void post(key, "/api/ops/queue", request),
    [post]
  );

  const flyAction = useCallback(
    (machineId: string, action: FlyMachineAction) =>
      void post(`fly:${action}:${machineId}`, "/api/ops/fly", { action, machineId }),
    [post]
  );

  const openJobDetails = useCallback(async (jobId: string): Promise<void> => {
    setSelectedJobId(jobId);
    setJobDetails(null);
    setJobDetailsError(null);
    setJobDetailsLoading(true);
    try {
      const [recordRes, eventsRes] = await Promise.all([
        fetch(`/api/lifecycle/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" }),
        fetch(`/api/lifecycle/jobs/${encodeURIComponent(jobId)}/events?start=0`, { cache: "no-store" }),
      ]);
      if (!recordRes.ok) {
        throw new Error(`Could not read job record (${recordRes.status}).`);
      }
      if (!eventsRes.ok) {
        throw new Error(`Could not read job events (${eventsRes.status}).`);
      }
      const recordBody = (await recordRes.json()) as { job?: JobRecord };
      const eventsBody = (await eventsRes.json()) as { events?: JobEvent[] };
      setJobDetails({
        record: recordBody.job ?? null,
        events: Array.isArray(eventsBody.events) ? eventsBody.events : [],
      });
    } catch (err) {
      setJobDetailsError(err instanceof Error ? err.message : String(err));
    } finally {
      setJobDetailsLoading(false);
    }
  }, []);

  if (!report) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-gray-500">
        {loadError ? (
          <>
            <XCircle className="h-4 w-4 text-red-500" />
            {loadError}
          </>
        ) : (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading Fly, Redis, and the build queue…
          </>
        )}
      </div>
    );
  }

  const { checks, fly, queue, stuckJobs, redis, mulesoft } = report;
  const worst: OpsCheckLevel = checks.some((check) => check.level === "fail")
    ? "fail"
    : checks.some((check) => check.level === "warn")
      ? "warn"
      : "ok";

  return (
    <div className="space-y-6">
      {selectedJobId ? (
        <JobDetailsDialog
          jobId={selectedJobId}
          record={jobDetails?.record ?? null}
          events={jobDetails?.events ?? []}
          loading={jobDetailsLoading}
          error={jobDetailsError}
          onClose={() => setSelectedJobId(null)}
        />
      ) : null}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Ops</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Live view of the Fly deployment and the lifecycle build queue: what is running, what is stuck,
            and what to do about it.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
            />
            Auto-refresh
          </label>
          <ActionButton
            label={`Refresh · ${formatClock(report.generatedAt)}`}
            Icon={RefreshCw}
            busy={refreshing}
            onClick={() => void refresh()}
          />
        </div>
      </header>

      {loadError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </p>
      ) : null}

      {actionResult ? (
        <p
          className={`rounded-xl border px-4 py-3 text-sm ${
            actionResult.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {actionResult.message}
        </p>
      ) : null}

      <div
        className={`rounded-2xl border px-5 py-4 ${LEVEL_STYLES[worst].border}`}
        role="status"
      >
        <div className="flex items-center gap-2.5">
          {(() => {
            const { Icon, badge } = LEVEL_STYLES[worst];
            return <Icon className={`h-5 w-5 ${badge}`} aria-hidden="true" />;
          })()}
          <p className="text-sm font-semibold text-gray-900">
            {worst === "ok"
              ? "Everything checks out."
              : worst === "warn"
                ? "Running, with things worth looking at."
                : "Something is broken — see the failing checks below."}
          </p>
        </div>
      </div>

      <ChecksGrid checks={checks} />

      <Section
        title="Fly machines"
        subtitle={
          fly.configured && fly.appName
            ? `${fly.appName}${fly.organization ? ` · ${fly.organization}` : ""}${fly.appStatus ? ` · ${fly.appStatus}` : ""}`
            : "Machines API not available from this process"
        }
        Icon={Server}
      >
        {!fly.configured || fly.error ? (
          <EmptyRow>{fly.error ?? fly.hint ?? "Fly API access is not configured."}</EmptyRow>
        ) : fly.machines.length === 0 ? (
          <EmptyRow>The Fly API returned no machines for this app.</EmptyRow>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Process</th>
                  <th className="px-3 py-2.5 font-medium">State</th>
                  <th className="px-3 py-2.5 font-medium">Region</th>
                  <th className="px-3 py-2.5 font-medium">Image</th>
                  <th className="px-3 py-2.5 font-medium">Size</th>
                  <th className="px-3 py-2.5 font-medium">Updated</th>
                  <th className="px-5 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {fly.machines.map((machine: FlyMachineSummary) => {
                  const stateStyle =
                    MACHINE_STATE_STYLES[machine.state ?? ""] ?? "bg-gray-100 text-gray-700";
                  const problem = machine.alwaysOn && machine.state !== "started";
                  return (
                    <tr key={machine.id} className={problem ? "bg-red-50/40" : undefined}>
                      <td className="px-5 py-3">
                        <p className="font-medium text-gray-900">
                          {machine.processGroup ?? machine.name ?? "—"}
                          {machine.isSelf ? (
                            <span className="ml-2 text-[11px] font-normal text-gray-500">
                              (serving this page)
                            </span>
                          ) : null}
                        </p>
                        <p className="font-mono text-[11px] text-gray-500">{machine.id}</p>
                        {machine.checks.length > 0 ? (
                          <p className="mt-1 text-[11px] text-gray-500">
                            {machine.checks
                              .map((check) => `${check.name ?? "check"}: ${check.status ?? "?"}`)
                              .join(" · ")}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <Pill label={machine.state ?? "unknown"} className={stateStyle} />
                        {machine.alwaysOn ? (
                          <p className="mt-1 text-[11px] text-gray-500">always-on</p>
                        ) : (
                          <p className="mt-1 text-[11px] text-gray-500">autostops</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-gray-700">{machine.region ?? "—"}</td>
                      <td className="px-3 py-3 font-mono text-[11px] text-gray-600">
                        {machine.imageTag ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-600">
                        {machine.cpus ?? "?"}× {machine.cpuKind ?? "cpu"} · {machine.memoryMb ?? "?"}MB
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-600">{formatAgo(machine.updatedAt)}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <ActionButton
                            label="Start"
                            Icon={Play}
                            tone={problem ? "primary" : "neutral"}
                            busy={pendingAction === `fly:start:${machine.id}`}
                            disabled={machine.state === "started"}
                            onClick={() => flyAction(machine.id, "start")}
                          />
                          <ActionButton
                            label="Restart"
                            Icon={RotateCw}
                            busy={pendingAction === `fly:restart:${machine.id}`}
                            onClick={() => flyAction(machine.id, "restart")}
                          />
                          <ActionButton
                            label="Stop"
                            Icon={Square}
                            tone="danger"
                            busy={pendingAction === `fly:stop:${machine.id}`}
                            disabled={machine.state === "stopped"}
                            onClick={() => flyAction(machine.id, "stop")}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Build queue"
        subtitle={
          queue
            ? `${queue.name}${queue.paused ? " · paused" : ""} · ${queue.workers.length} worker connection(s)`
            : "Queue unavailable"
        }
        Icon={Layers}
        actions={
          queue ? (
            <>
              <ActionButton
                label={queue.paused ? "Resume" : "Pause"}
                Icon={queue.paused ? Play : Pause}
                tone={queue.paused ? "primary" : "neutral"}
                busy={pendingAction === "queue:pause"}
                onClick={() =>
                  queueAction("queue:pause", { action: queue.paused ? "resume" : "pause" })
                }
              />
              <ActionButton
                label="Clear waiting"
                Icon={Trash2}
                tone="danger"
                busy={pendingAction === "queue:drain"}
                disabled={(queue.counts.waiting ?? 0) === 0}
                onClick={() => queueAction("queue:drain", { action: "drain-waiting" })}
              />
              <ActionButton
                label="Clean failed"
                Icon={Trash2}
                busy={pendingAction === "queue:clean-failed"}
                onClick={() => queueAction("queue:clean-failed", { action: "clean-failed" })}
              />
              <ActionButton
                label="Clean completed"
                Icon={Trash2}
                busy={pendingAction === "queue:clean-completed"}
                onClick={() => queueAction("queue:clean-completed", { action: "clean-completed" })}
              />
            </>
          ) : null
        }
      >
        {!queue ? (
          <EmptyRow>{report.queueError ?? "The queue could not be read from Redis."}</EmptyRow>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-px border-b border-gray-100 bg-gray-100 sm:grid-cols-5">
              {(["active", "waiting", "delayed", "failed", "completed"] as const).map((state) => (
                <div key={state} className="bg-white px-5 py-3">
                  <dt className="text-xs uppercase tracking-wide text-gray-500">{state}</dt>
                  <dd className="mt-0.5 text-xl font-semibold text-gray-900">
                    {queue.counts[state] ?? 0}
                  </dd>
                </div>
              ))}
            </dl>
            {queue.jobs.length === 0 ? (
              <EmptyRow>No jobs in the queue.</EmptyRow>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Job</th>
                      <th className="px-3 py-2.5 font-medium">State</th>
                      <th className="px-3 py-2.5 font-medium">Requested by</th>
                      <th className="px-3 py-2.5 font-medium">Target</th>
                      <th className="px-3 py-2.5 font-medium">Age</th>
                      <th className="px-5 py-2.5 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {queue.jobs.map((job) => (
                      <tr key={`${job.state}:${job.id}`}>
                        <td className="px-5 py-3">
                          <p className="font-medium text-gray-900">{job.command}</p>
                          <p className="font-mono text-[11px] text-gray-500" title={job.id}>
                            {shortId(job.id)} · {job.fileCount} files
                          </p>
                          {job.failedReason ? (
                            <p className="mt-1 max-w-md truncate text-[11px] text-red-600" title={job.failedReason}>
                              {job.failedReason}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          <Pill label={job.state} className={JOB_STATE_STYLES[job.state]} />
                          {job.storeStatus && job.storeStatus !== job.state ? (
                            <p className="mt-1 text-[11px] text-gray-500">store: {job.storeStatus}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-700">
                          <p>{job.actor ?? "—"}</p>
                          <p className="font-mono text-[11px] text-gray-500">{job.orgId ?? "—"}</p>
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-700">
                          {job.deployEnvironment ? (
                            <>
                              <p>{job.deployEnvironment}</p>
                              <p className="text-[11px] text-gray-500">{job.deployTarget ?? "—"}</p>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-700">{formatDuration(job.ageMs)}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {job.state === "active" || job.state === "waiting" || job.state === "delayed" ? (
                              <ActionButton
                                label="Cancel"
                                Icon={XCircle}
                                tone="danger"
                                busy={pendingAction === `queue:cancel:${job.id}`}
                                onClick={() =>
                                  queueAction(`queue:cancel:${job.id}`, {
                                    action: "cancel",
                                    jobId: job.id,
                                  })
                                }
                              />
                            ) : null}
                            {job.state === "failed" ? (
                              <ActionButton
                                label="Retry"
                                Icon={RotateCw}
                                busy={pendingAction === `queue:retry:${job.id}`}
                                onClick={() =>
                                  queueAction(`queue:retry:${job.id}`, { action: "retry", jobId: job.id })
                                }
                              />
                            ) : null}
                            {job.state !== "active" ? (
                              <ActionButton
                                label="Remove"
                                Icon={Trash2}
                                busy={pendingAction === `queue:remove:${job.id}`}
                                onClick={() =>
                                  queueAction(`queue:remove:${job.id}`, {
                                    action: "remove",
                                    jobId: job.id,
                                  })
                                }
                              />
                            ) : null}
                            <ActionButton
                              label="View logs"
                              Icon={Activity}
                              busy={jobDetailsLoading && selectedJobId === job.id}
                              onClick={() => void openJobDetails(job.id)}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Section>

      <Section
        title="MuleSoft CLI and plugin"
        subtitle="Runtime dependency audit for lifecycle publish/deploy"
        Icon={Terminal}
      >
        <div className="grid gap-4 px-5 py-4 lg:grid-cols-2">
          <dl className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {[
              ["CLI path", mulesoft.cliPath],
              ["CLI installed", mulesoft.cliInstalledVersion ?? "not detected"],
              ["CLI latest (npm)", mulesoft.cliLatestVersion ?? "unknown"],
              ["Plugin installed", mulesoft.pluginInstalledVersion ?? "not detected"],
              ["Plugin latest (npm)", mulesoft.pluginLatestVersion ?? "unknown"],
              [
                "Updates",
                mulesoft.cliUpdateAvailable || mulesoft.pluginUpdateAvailable
                  ? "available"
                  : "none detected",
              ],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
                <dt className="text-gray-500">{label}</dt>
                <dd className="text-right font-mono text-xs text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-xs leading-relaxed text-blue-900">
            <p className="font-semibold">Update checklist (persistent path)</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Check latest: `npm view anypoint-cli-v4 version` and `npm view mulesoft-anypoint-cli-agent-fabric-plugin version`.</li>
              <li>Update pinned versions in `Dockerfile` (`ANYPOINT_CLI_VERSION` and plugin version).</li>
              <li>Deploy a new image with `flyctl deploy --local-only`.</li>
              <li>Refresh this page and confirm installed matches latest.</li>
            </ol>
            <p className="mt-3 text-blue-800">
              Runtime installs done manually in a live container are ephemeral and will be lost on restart/scale/replacement.
            </p>
            {mulesoft.notes.length > 0 ? (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                Probe notes: {mulesoft.notes.join(" ")}
              </p>
            ) : null}
          </div>
        </div>
      </Section>

      <Section
        title="Abandoned job records"
        subtitle={`Non-terminal for longer than ${formatDuration(report.process.abandonAfterMs)} — anyone watching one of these is stuck waiting`}
        Icon={Activity}
      >
        {stuckJobs.length === 0 ? (
          <EmptyRow>Nothing stranded.</EmptyRow>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Job</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Requested by</th>
                  <th className="px-3 py-2.5 font-medium">Age</th>
                  <th className="px-5 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stuckJobs.map((job) => (
                  <tr key={job.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900">{job.command}</p>
                      <p className="font-mono text-[11px] text-gray-500" title={job.id}>
                        {shortId(job.id)}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <Pill label={job.status} className="bg-amber-100 text-amber-700" />
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-700">
                      <p>{job.actor ?? "—"}</p>
                      <p className="font-mono text-[11px] text-gray-500">{job.orgId}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-700">{formatDuration(job.ageMs)}</td>
                    <td className="px-5 py-3">
                      <ActionButton
                        label="Mark abandoned"
                        Icon={XCircle}
                        tone="danger"
                        busy={pendingAction === `queue:finalize:${job.id}`}
                        onClick={() =>
                          queueAction(`queue:finalize:${job.id}`, {
                            action: "finalize",
                            jobId: job.id,
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Redis" subtitle="Job store, event log, and queue backing" Icon={Database}>
          <dl className="divide-y divide-gray-100 text-sm">
            {[
              ["Reachable", redis.reachable ? "yes" : "no"],
              ["PING", redis.pingMs === null ? "—" : `${redis.pingMs}ms`],
              ["Version", redis.version ?? "—"],
              ["Uptime", formatSeconds(redis.uptimeSeconds)],
              ["Memory used", redis.usedMemoryHuman ?? "—"],
              ["Connected clients", redis.connectedClients?.toString() ?? "—"],
              ...(redis.error ? ([["Error", redis.error]] as [string, string][]) : []),
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4 px-5 py-2.5">
                <dt className="text-gray-500">{label}</dt>
                <dd className="text-right text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="This process" subtitle="The web machine serving this page" Icon={Cpu}>
          <dl className="divide-y divide-gray-100 text-sm">
            {[
              ["Fly machine", fly.self.machineId ?? "not on Fly"],
              ["Region", fly.self.region ?? "—"],
              ["Process group", fly.self.processGroup ?? "—"],
              ["Image", fly.self.imageRef ?? "—"],
              ["Node", `${report.process.nodeVersion} · ${report.process.nodeEnv}`],
              ["Uptime", formatSeconds(report.process.uptimeSeconds)],
              [
                "Memory",
                `${formatBytes(report.process.rssBytes)} rss · ${formatBytes(report.process.heapUsedBytes)} heap`,
              ],
              ["Worker concurrency", report.process.workerConcurrency.toString()],
              ["REDIS_URL set", report.process.redisConfigured ? "yes" : "no"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4 px-5 py-2.5">
                <dt className="shrink-0 text-gray-500">{label}</dt>
                <dd className="truncate text-right font-mono text-xs text-gray-900" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </div>
  );
}
