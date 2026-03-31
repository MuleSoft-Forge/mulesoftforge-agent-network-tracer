import { NextRequest, NextResponse } from "next/server";
import { debugLog, debugError } from "@/lib/api-logger";
import { BrokerTasksRequestSchema } from "@/lib/schemas";
import { requireAuth } from "@/lib/api/auth-middleware";
import { validationError } from "@/lib/api/error-responses";
import { resolveBrokerContext } from "@/lib/broker-context";
import { fetchTasksViaMSearch, fetchTasksViaRuntimeLogs } from "@/lib/broker-tasks";

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

  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { baseUrl, accessToken, session } = authResult;
  const hasMsearch = session.monitoringCenterEnabled === true;
  debugLog(`[BROKER-TASKS] session: baseUrl=${baseUrl} token=${accessToken.slice(0, 8)}… monitoringCenterEnabled=${hasMsearch}`);

  const body = await request.json();
  const parseResult = BrokerTasksRequestSchema.safeParse(body);
  if (!parseResult.success) return validationError(parseResult.error);

  const { orgId, apiInstanceId, envId, timeRangeMs = 24 * 3600 * 1000 } = parseResult.data;
  const timeRange = Math.min(timeRangeMs, MAX_TIME_RANGE_MS);
  debugLog(`[BROKER-TASKS] orgId=${orgId} apiInstanceId=${apiInstanceId} envId=${envId ?? "none"} timeRange=${timeRange}ms`);

  let brokerAppName: string | undefined;
  if (envId) {
    try {
      const ctx = await resolveBrokerContext(orgId, envId, apiInstanceId, accessToken, baseUrl);
      brokerAppName = ctx?.appName;
      if (brokerAppName) debugLog(`[BROKER-TASKS] brokerAppName=${brokerAppName}`);
    } catch (e) {
      debugLog("[BROKER-TASKS] resolveBrokerContext failed (continuing):", e);
    }
  }

  try {
    // Strategy A: _msearch — only when org has Log Search (productSKU === 1)
    if (hasMsearch) {
      const msearchResult = await fetchTasksViaMSearch({
        orgId,
        apiInstanceId,
        accessToken,
        baseUrl,
        timeRangeMs: timeRange,
        brokerAppName,
      });

      if (msearchResult) {
        debugLog(`[BROKER-TASKS] msearch returned ${msearchResult.tasks.length} tasks`);
        debugLog("[BROKER-TASKS] ========== END (msearch) ==========");
        return NextResponse.json({
          tasks: msearchResult.tasks,
          source: msearchResult.source,
          totalTasks: msearchResult.tasks.length,
          totalLogs: msearchResult.totalLogs,
          filters: { apiInstanceId },
        });
      }
    } else {
      debugLog("[BROKER-TASKS] Skipping msearch (monitoringCenterEnabled=false, productSKU !== 1)");
    }

    // Strategy B: runtime logs (no Log Search entitlement, or msearch signalled fallback)
    debugLog("[BROKER-TASKS] Using runtime-logs strategy");
    const runtimeResult = await fetchTasksViaRuntimeLogs({
      orgId,
      apiInstanceId,
      accessToken,
      baseUrl,
      timeRangeMs: timeRange,
      envId: envId ?? undefined,
      brokerAppName,
    });

    debugLog(`[BROKER-TASKS] runtime-logs returned ${runtimeResult.tasks.length} tasks`);
    debugLog("[BROKER-TASKS] ========== END (runtime-logs) ==========");
    return NextResponse.json({
      tasks: runtimeResult.tasks,
      source: runtimeResult.source,
      totalTasks: runtimeResult.tasks.length,
      totalLogs: runtimeResult.totalLogs,
      filters: { apiInstanceId },
      mode: runtimeResult.mode,
    });
  } catch (error) {
    debugError("[BROKER-TASKS] Unhandled error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch broker tasks" },
      { status: 500 }
    );
  }
}
