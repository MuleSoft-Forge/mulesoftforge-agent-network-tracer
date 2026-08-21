import { NextRequest, NextResponse } from "next/server";
import { debugLog, debugError } from "@/lib/api-logger";
import { BrokerTasksRequestSchema } from "@/lib/schemas";
import { requireAuth } from "@/lib/api/auth-middleware";
import { orgHasTitaniumMonitoring } from "@/lib/api/log-search-entitlement";
import { isOrgLogSearchEntitled } from "@/lib/api/log-search";
import { validationError } from "@/lib/api/error-responses";
import { resolveBrokerContext } from "@/lib/broker-context";
import { dumpBrokerTasksVerbose } from "@/lib/broker-tasks/verbose-dump";
import type { BrokerTask, MsearchDiagnostics } from "@/lib/broker-tasks/types";
import { fetchTasksViaMSearch, fetchTasksViaRuntimeLogs } from "@/lib/broker-tasks";
import { PhaseTimer } from "@/lib/api/timing";

export const dynamic = "force-dynamic";

const MAX_TIME_RANGE_MS = 7 * 24 * 3600 * 1000; // 7 days

/**
 * POST /api/broker-tasks
 *
 * Thin orchestrator: authenticate, validate, resolve broker context, then
 * delegate to one of two **independent** strategies:
 *
 *   A) _msearch (Monitoring Center Premium)  → lib/broker-tasks/msearch-strategy.ts
 *   B) Runtime logs (no entitlement)         → lib/broker-tasks/runtime-logs-strategy.ts
 *
 * The two strategies share only the BrokerTask type (lib/broker-tasks/types.ts).
 * Fix one without breaking the other.
 */
export async function POST(request: NextRequest) {
  debugLog("[BROKER-TASKS] ========== START ==========");
  const timer = new PhaseTimer("broker-tasks");

  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { baseUrl, accessToken, session } = authResult;
  debugLog(`[BROKER-TASKS] session: baseUrl=${baseUrl} token=${accessToken.slice(0, 8)}… productSKU=${session.monitoringProductSKU ?? "unknown"}`);
  dumpBrokerTasksVerbose("auth-session", {
    baseUrl,
    accessToken,
    refreshToken: session.refreshToken ?? null,
    expiresAt: session.expiresAt ?? null,
    monitoringCenterEnabled: session.monitoringCenterEnabled ?? null,
    monitoringProductSKU: session.monitoringProductSKU ?? null,
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parseResult = BrokerTasksRequestSchema.safeParse(body);
  if (!parseResult.success) return validationError(parseResult.error);

  const {
    orgId,
    apiInstanceId,
    envId,
    timeRangeMs = 3 * 24 * 3600 * 1000,
    includeMsearchDiagnostics = false,
  } = parseResult.data;
  const timeRange = Math.min(timeRangeMs, MAX_TIME_RANGE_MS);
  let brokerAppName: string | undefined;
  let brokerDeploymentId: string | undefined;
  let brokerLogAppIds: string[] | undefined;
  let brokerRouteSegment: string | undefined;
  let brokerDeploymentType: string | undefined;

  // The entitlement check and the broker-context resolve share only their
  // inputs, so they run together rather than one after the other.
  const [hasMsearch] = await Promise.all([
    // Entitlement is decided for the *queried* org (handles business-group /
    // multi-org switches), not a login-time flag.
    timer.measure("entitlement", () => isOrgLogSearchEntitled(baseUrl, orgId, accessToken)),
    (async () => {
      if (!envId) {
        dumpBrokerTasksVerbose("broker-context-skip", { reason: "envId not sent", orgId, apiInstanceId });
        return;
      }
      try {
        const ctx = await timer.measure("broker-context", () =>
          resolveBrokerContext(orgId, envId, apiInstanceId, accessToken, baseUrl)
        );
        brokerAppName = ctx?.appName;
        brokerDeploymentId = ctx?.deploymentId;
        brokerLogAppIds = ctx?.logAppIds;
        brokerRouteSegment = ctx?.routeSegment;
        brokerDeploymentType = ctx?.deploymentType;
        debugLog(`[BROKER-TASKS] resolveBrokerContext result: appName=${ctx?.appName ?? "null"}, deploymentId=${ctx?.deploymentId ?? "null"}, deploymentType=${ctx?.deploymentType ?? "null"}, targetId=${ctx?.targetId ?? "null"}, routeSegment=${ctx?.routeSegment ?? "null"}, assetId=${ctx?.assetId ?? "null"}`);
        dumpBrokerTasksVerbose(
          "broker-context",
          ctx
            ? { orgId, envId, apiInstanceId, ...ctx }
            : { orgId, envId, apiInstanceId, resolved: false }
        );
      } catch (e) {
        debugLog("[BROKER-TASKS] resolveBrokerContext failed (continuing):", e);
        dumpBrokerTasksVerbose("broker-context-error", {
          orgId,
          envId,
          apiInstanceId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })(),
  ]);

  debugLog(
    `[BROKER-TASKS] orgId=${orgId} apiInstanceId=${apiInstanceId} envId=${envId ?? "none"} timeRange=${timeRange}ms logSearchEntitled=${hasMsearch} includeMsearchDiagnostics=${includeMsearchDiagnostics}`
  );

  dumpBrokerTasksVerbose("request-body", {
    orgId,
    apiInstanceId,
    envId: envId ?? null,
    timeRangeMs: timeRange,
    includeMsearchDiagnostics,
    monitoringCenterEnabled: hasMsearch,
  });

  let msearchDiagnostics: MsearchDiagnostics | undefined;
  let msearchTasks: BrokerTask[] = [];
  let msearchTotalLogs = 0;

  try {
    // Strategy A and B are complementary — Flex API gateway records and broker
    // runtime records use different appIds, so a non-empty result from one must
    // never hide tasks found by the other. They share no state, so they run
    // concurrently: the combined latency is the slower of the two rather than
    // their sum.
    const msearchPromise = hasMsearch
      ? timer.measure("msearch", () =>
          fetchTasksViaMSearch({
            orgId,
            apiInstanceId,
            accessToken,
            baseUrl,
            timeRangeMs: timeRange,
            envId: envId ?? undefined,
            brokerAppName,
            logAppIds: brokerLogAppIds,
            brokerRouteSegments: brokerRouteSegment ? [brokerRouteSegment] : undefined,
            deploymentType: brokerDeploymentType,
            includeDiagnostics: includeMsearchDiagnostics,
            timer,
          })
        )
      : Promise.resolve(null);
    if (!hasMsearch) debugLog("[BROKER-TASKS] Skipping msearch (monitoringCenterEnabled=false)");

    debugLog("[BROKER-TASKS] Using runtime-logs strategy");
    const runtimePromise = timer.measure("runtime-logs", () =>
      fetchTasksViaRuntimeLogs({
        orgId,
        apiInstanceId,
        accessToken,
        baseUrl,
        timeRangeMs: timeRange,
        envId: envId ?? undefined,
        brokerAppName,
        brokerDeploymentId,
        brokerRouteSegments: brokerRouteSegment ? [brokerRouteSegment] : undefined,
        deploymentType: brokerDeploymentType,
        logSearchEntitled: hasMsearch || orgHasTitaniumMonitoring(session),
        timer,
      })
    );

    const [msearchResult, runtimeResult] = await Promise.all([msearchPromise, runtimePromise]);

    msearchDiagnostics = msearchResult?.msearchDiagnostics;
    if (msearchResult) {
      msearchTasks = msearchResult.tasks;
      msearchTotalLogs = msearchResult.totalLogs;
      debugLog(
        `[BROKER-TASKS] msearch returned ${msearchTasks.length} tasks (totalLogs=${msearchTotalLogs}) — merging with runtime-logs`
      );
      dumpBrokerTasksVerbose("msearch-before-runtime-merge", {
        totalLogs: msearchResult.totalLogs,
        taskCount: msearchResult.tasks.length,
        msearchDiagnostics: msearchDiagnostics ?? null,
        brokerAppName: brokerAppName ?? null,
        brokerDeploymentId: brokerDeploymentId ?? null,
      });
    }

    debugLog(`[BROKER-TASKS] runtime-logs returned ${runtimeResult.tasks.length} tasks`);
    const tasksById = new Map<string, BrokerTask>(
      msearchTasks.map((task) => [task.taskId, task])
    );
    for (const task of runtimeResult.tasks) {
      const existing = tasksById.get(task.taskId);
      if (!existing) {
        tasksById.set(task.taskId, task);
        continue;
      }
      tasksById.set(task.taskId, {
        ...existing,
        startTime: existing.startTime < task.startTime ? existing.startTime : task.startTime,
        endTime: existing.endTime ?? task.endTime,
        maxIteration: Math.max(existing.maxIteration, task.maxIteration),
        toolsUsed: [...new Set([...existing.toolsUsed, ...task.toolsUsed])],
        logCount: existing.logCount + task.logCount,
      });
    }
    const mergedTasks = [...tasksById.values()].sort((a, b) => b.startTime.localeCompare(a.startTime));

    debugLog(
      `[BROKER-TASKS] merged ${msearchTasks.length} msearch + ${runtimeResult.tasks.length} runtime tasks = ${mergedTasks.length} unique tasks`
    );
    debugLog("[BROKER-TASKS] ========== END ==========");
    dumpBrokerTasksVerbose("response-merged", {
      totalTasks: mergedTasks.length,
      msearchTasks: msearchTasks.length,
      runtimeTasks: runtimeResult.tasks.length,
      totalLogs: msearchTotalLogs + runtimeResult.totalLogs,
      mode: runtimeResult.mode ?? null,
      filters: { apiInstanceId },
      msearchDiagnostics: msearchDiagnostics ?? null,
      brokerAppName: brokerAppName ?? null,
      brokerDeploymentId: brokerDeploymentId ?? null,
      mergedSources: hasMsearch ? ["msearch", "runtime-logs"] : ["runtime-logs"],
    });
    timer.count("tasks", mergedTasks.length);
    timer.logSummary();
    return NextResponse.json(
      {
        tasks: mergedTasks,
        source: hasMsearch ? "msearch+runtime-logs" : runtimeResult.source,
        totalTasks: mergedTasks.length,
        totalLogs: msearchTotalLogs + runtimeResult.totalLogs,
        filters: { apiInstanceId },
        mode: runtimeResult.mode,
        ...(msearchDiagnostics ? { msearchDiagnostics } : {}),
      },
      { headers: { "Server-Timing": timer.toServerTiming() } }
    );
  } catch (error) {
    debugError("[BROKER-TASKS] Unhandled error:", error);
    dumpBrokerTasksVerbose("fatal-error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch broker tasks" },
      { status: 500 }
    );
  }
}
