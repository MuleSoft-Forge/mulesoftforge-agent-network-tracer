/**
 * Assembles the Ops report: everything an operator would otherwise open a
 * terminal for (`fly status`, `fly machines list`, `redis-cli`, queue pokes),
 * plus a verdict on each signal so the page leads with what is actually wrong.
 *
 * Every section degrades independently — an unreachable Redis must not hide the
 * Fly machine list, and a missing Fly token must not hide the queue.
 */

import "server-only";
import { config } from "@/lib/lifecycle-server/config";
import {
  expectsAlwaysOn,
  getApp,
  imageTagOf,
  listMachines,
  processGroupOf,
  readFlyConfig,
  readFlySelfInfo,
  type FlyMachine,
} from "@/lib/fly/machines";
import { ABANDON_AFTER_MS, readQueueSnapshot, readRedisHealth, readStuckJobs } from "./queue-inspector";
import type {
  FlyMachineSummary,
  FlySnapshot,
  OpsCheck,
  OpsReport,
  QueueSnapshot,
  RedisHealth,
  StuckJobSummary,
} from "./types";

const FLY_TOKEN_HINT =
  'Set a Fly API token on the app so this page can read the Machines API: fly secrets set FLY_API_TOKEN="$(fly tokens create deploy -x 8760h)"';

function summarizeMachine(machine: FlyMachine, selfMachineId: string | null): FlyMachineSummary {
  return {
    id: machine.id,
    name: machine.name ?? null,
    state: machine.state ?? null,
    region: machine.region ?? null,
    processGroup: processGroupOf(machine),
    imageTag: imageTagOf(machine),
    cpuKind: machine.config?.guest?.cpu_kind ?? null,
    cpus: machine.config?.guest?.cpus ?? null,
    memoryMb: machine.config?.guest?.memory_mb ?? null,
    createdAt: machine.created_at ?? null,
    updatedAt: machine.updated_at ?? null,
    alwaysOn: expectsAlwaysOn(machine),
    checks: (machine.checks ?? []).map((check) => ({
      name: check.name ?? null,
      status: check.status ?? null,
      output: check.output ?? null,
    })),
    isSelf: selfMachineId !== null && machine.id === selfMachineId,
  };
}

async function readFlySnapshot(): Promise<FlySnapshot> {
  const self = readFlySelfInfo();
  const flyConfig = readFlyConfig();

  if (!flyConfig) {
    const missingApp = self.appName === null;
    return {
      configured: false,
      appName: self.appName,
      appStatus: null,
      organization: null,
      machines: [],
      self,
      error: null,
      hint: missingApp
        ? "This process is not running on Fly, so there are no machines to inspect. The queue and Redis sections below still apply to whatever Redis this process is pointed at."
        : FLY_TOKEN_HINT,
    };
  }

  try {
    const [machines, app] = await Promise.all([
      listMachines(flyConfig),
      getApp(flyConfig).catch(() => null),
    ]);
    return {
      configured: true,
      appName: flyConfig.appName,
      appStatus: app?.status ?? null,
      organization: app?.organization?.slug ?? app?.organization?.name ?? null,
      machines: machines
        .map((machine) => summarizeMachine(machine, self.machineId))
        .sort((a, b) => (a.processGroup ?? "").localeCompare(b.processGroup ?? "")),
      self,
      error: null,
      hint: null,
    };
  } catch (err) {
    return {
      configured: true,
      appName: flyConfig.appName,
      appStatus: null,
      organization: null,
      machines: [],
      self,
      error: err instanceof Error ? err.message : String(err),
      hint: "If this is a 401, the token has expired or lacks access to this app — mint a new one with `fly tokens create deploy`.",
    };
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function agree(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

function redisCheck(redis: RedisHealth): OpsCheck {
  if (!redis.reachable) {
    return {
      id: "redis",
      title: "Redis",
      level: "fail",
      detail: redis.error ?? "Redis did not respond to PING.",
      action:
        "Nothing can be queued or streamed while Redis is down. Check the Upstash/Redis instance and the REDIS_URL secret on the app.",
    };
  }
  const slow = redis.pingMs !== null && redis.pingMs > 250;
  return {
    id: "redis",
    title: "Redis",
    level: slow ? "warn" : "ok",
    detail: `PING ${redis.pingMs}ms · v${redis.version ?? "?"} · ${redis.usedMemoryHuman ?? "?"} used · ${redis.connectedClients ?? "?"} clients`,
    action: slow ? "Round-trips over 250ms will make job log streaming feel laggy." : null,
  };
}

function workerCheck(queue: QueueSnapshot): OpsCheck {
  const waiting = queue.counts.waiting ?? 0;

  if (queue.workersUnavailable) {
    return {
      id: "workers",
      title: "Lifecycle workers",
      level: "unknown",
      detail: "This Redis does not allow CLIENT LIST, so connected workers cannot be counted.",
      action: "Use the queue counts below: a waiting count that never drops means no worker is consuming.",
    };
  }

  if (queue.workers.length === 0) {
    return {
      id: "workers",
      title: "Lifecycle workers",
      level: waiting > 0 ? "fail" : "warn",
      detail:
        waiting > 0
          ? `No worker is connected and ${plural(waiting, "job")} ${agree(waiting, "is", "are")} waiting — nothing will run.`
          : "No worker is connected to the queue.",
      action:
        "Start the worker machine from the Fly machines list below, or check `fly logs -a <app>` for a crash loop on the worker process group.",
    };
  }

  const youngest = queue.workers.reduce<number | null>((min, worker) => {
    if (worker.ageSeconds === null) return min;
    return min === null ? worker.ageSeconds : Math.min(min, worker.ageSeconds);
  }, null);

  return {
    id: "workers",
    title: "Lifecycle workers",
    level: "ok",
    detail:
      `${plural(queue.workers.length, "worker connection")} on queue "${queue.name}"` +
      (youngest !== null ? ` · newest connected ${formatDuration(youngest * 1000)} ago` : ""),
    action: null,
  };
}

function backlogCheck(queue: QueueSnapshot): OpsCheck {
  const waiting = queue.counts.waiting ?? 0;
  const active = queue.counts.active ?? 0;
  const capacity = config.workerConcurrency;

  if (queue.paused) {
    return {
      id: "backlog",
      title: "Build queue",
      level: "warn",
      detail: `Queue is paused with ${plural(waiting, "job")} waiting and ${active} running.`,
      action: "Resume the queue to let waiting jobs start.",
    };
  }
  if (waiting > capacity) {
    return {
      id: "backlog",
      title: "Build queue",
      level: "warn",
      detail: `${plural(waiting, "job")} waiting behind ${active} running, against a worker capacity of ${capacity}.`,
      action: "Builds will queue up. Cancel anything stale below, or scale the worker process group.",
    };
  }
  return {
    id: "backlog",
    title: "Build queue",
    level: "ok",
    detail: `${active} running · ${waiting} waiting · ${queue.counts.failed ?? 0} failed in history`,
    action: null,
  };
}

function stalledCheck(queue: QueueSnapshot): OpsCheck {
  const stalled = queue.jobs.filter(
    (job) => job.state === "active" && job.ageMs !== null && job.ageMs > ABANDON_AFTER_MS
  );
  if (stalled.length === 0) {
    return {
      id: "stalled",
      title: "Long-running jobs",
      level: "ok",
      detail: `No job has been running longer than ${formatDuration(ABANDON_AFTER_MS)}.`,
      action: null,
    };
  }
  return {
    id: "stalled",
    title: "Long-running jobs",
    level: "warn",
    detail: `${plural(stalled.length, "job")} ${agree(stalled.length, "has", "have")} been running longer than ${formatDuration(ABANDON_AFTER_MS)}, which is past every CLI timeout.`,
    action: "Cancel them from the queue table — the CLI child is wedged rather than slow.",
  };
}

function abandonedCheck(stuckJobs: StuckJobSummary[]): OpsCheck {
  if (stuckJobs.length === 0) {
    return {
      id: "abandoned",
      title: "Abandoned job records",
      level: "ok",
      detail: "No job record is stranded in a non-terminal state.",
      action: null,
    };
  }
  return {
    id: "abandoned",
    title: "Abandoned job records",
    level: "warn",
    detail: `${plural(stuckJobs.length, "job record")} ${agree(stuckJobs.length, "is", "are")} still marked running or queued past the ${formatDuration(ABANDON_AFTER_MS)} abandon window — usually a worker that was killed mid-job by a deploy or OOM.`,
    action: "The worker's reaper clears these once a minute. Mark them abandoned here to unblock anyone watching now.",
  };
}

function flyChecks(fly: FlySnapshot): OpsCheck[] {
  if (!fly.configured) {
    return [
      {
        id: "fly-api",
        title: "Fly Machines API",
        level: "unknown",
        detail: fly.hint ?? "Fly API access is not configured.",
        action: fly.appName === null ? null : FLY_TOKEN_HINT,
      },
    ];
  }
  if (fly.error) {
    return [
      {
        id: "fly-api",
        title: "Fly Machines API",
        level: "fail",
        detail: fly.error,
        action: fly.hint,
      },
    ];
  }

  const checks: OpsCheck[] = [];

  const down = fly.machines.filter((machine) => machine.alwaysOn && machine.state !== "started");
  checks.push(
    down.length === 0
      ? {
          id: "fly-machines",
          title: "Machines",
          level: "ok",
          detail: `${plural(fly.machines.length, "machine")} in ${fly.appName}, and every always-on machine is started.`,
          action: null,
        }
      : {
          id: "fly-machines",
          title: "Machines",
          level: "fail",
          detail: `${down
            .map((machine) => `${machine.processGroup ?? machine.name ?? machine.id} is ${machine.state ?? "unknown"}`)
            .join(", ")}. These have no HTTP service, so nothing will autostart them.`,
          action: "Start them from the machines table below. If they stop again immediately, the process is crash-looping.",
        }
  );

  const failing = fly.machines.flatMap((machine) =>
    machine.checks
      .filter((check) => check.status !== null && check.status !== "passing")
      .map((check) => `${machine.processGroup ?? machine.id}/${check.name ?? "check"} is ${check.status}`)
  );
  if (failing.length > 0) {
    checks.push({
      id: "fly-health-checks",
      title: "Health checks",
      level: "fail",
      detail: failing.join(", "),
      action: "A failing check keeps the machine out of the load balancer even while it is started.",
    });
  }

  const tags = new Set(
    fly.machines.map((machine) => machine.imageTag).filter((tag): tag is string => tag !== null)
  );
  if (tags.size > 1) {
    checks.push({
      id: "fly-release-skew",
      title: "Release skew",
      level: "warn",
      detail: `Machines are running ${tags.size} different images: ${[...tags].join(", ")}.`,
      action:
        "A partial deploy left process groups on different releases. Re-run `flyctl deploy --local-only` to converge them.",
    });
  }

  return checks;
}

export async function buildOpsReport(): Promise<OpsReport> {
  const [redis, fly] = await Promise.all([readRedisHealth(), readFlySnapshot()]);

  let queue: QueueSnapshot | null = null;
  let queueError: string | null = null;
  let stuckJobs: StuckJobSummary[] = [];

  // Both walk Redis, so a healthy PING is the precondition for either being
  // meaningful; without it they would just hang until their socket timeout.
  if (redis.reachable) {
    try {
      [queue, stuckJobs] = await Promise.all([readQueueSnapshot(), readStuckJobs()]);
    } catch (err) {
      queueError = err instanceof Error ? err.message : String(err);
    }
  }

  const checks: OpsCheck[] = [redisCheck(redis)];
  if (queue) {
    checks.push(workerCheck(queue), backlogCheck(queue), stalledCheck(queue));
  } else if (redis.reachable) {
    checks.push({
      id: "queue",
      title: "Build queue",
      level: "fail",
      detail: queueError ?? "The queue could not be read.",
      action: "Redis answered PING but the BullMQ keys could not be read.",
    });
  }
  if (redis.reachable && queue) {
    checks.push(abandonedCheck(stuckJobs));
  }
  checks.push(...flyChecks(fly));

  const memory = process.memoryUsage();

  return {
    generatedAt: new Date().toISOString(),
    checks,
    redis,
    queue,
    queueError,
    stuckJobs,
    fly,
    process: {
      nodeVersion: process.version,
      nodeEnv: process.env.NODE_ENV ?? "unknown",
      uptimeSeconds: Math.round(process.uptime()),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      redisConfigured: Boolean(process.env.REDIS_URL),
      queueName: config.queueName,
      workerConcurrency: config.workerConcurrency,
      abandonAfterMs: ABANDON_AFTER_MS,
    },
  };
}
