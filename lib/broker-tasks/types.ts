/**
 * Shared types for broker-task discovery.
 * Both strategies (msearch and runtime-logs) produce the same BrokerTask shape
 * so the route handler and UI don't care which path was used.
 */

/** Mutable accumulator used while parsing logs/hits. */
export interface BrokerTaskAccumulator {
  taskId: string;
  contextId: string;
  broker: string;
  firstTool: string;
  startTime: string;
  endTime: string | null;
  maxIteration: number;
  toolsUsed: Set<string>;
  appId: string;
  apiInstanceId: string;
  logCount: number;
}

/** Serialised task returned to the client. */
export interface BrokerTask {
  taskId: string;
  contextId: string;
  broker: string;
  firstTool: string;
  startTime: string;
  endTime: string | null;
  duration: string | null;
  maxIteration: number;
  toolsUsed: string[];
  appId: string;
  apiInstanceId: string;
  logCount: number;
}

/** Unified result from either strategy. */
export interface BrokerTasksResult {
  tasks: BrokerTask[];
  source: "msearch" | "runtime-logs";
  totalLogs: number;
  mode?: "no-entitlement";
}

/** Convert accumulator → serialised task, computing duration. */
export function finaliseTasks(
  accumulators: BrokerTaskAccumulator[],
  filterApiInstanceId?: string
): BrokerTask[] {
  const filtered = filterApiInstanceId
    ? accumulators.filter((t) => t.apiInstanceId === filterApiInstanceId)
    : accumulators;

  return filtered
    .map((t) => {
      let duration: string | null = null;
      if (t.startTime && t.endTime) {
        try {
          const s = new Date(t.startTime).getTime();
          const e = new Date(t.endTime).getTime();
          duration = ((e - s) / 1000).toFixed(1);
        } catch {
          /* ignore */
        }
      }
      return {
        taskId: t.taskId,
        contextId: t.contextId,
        broker: t.broker,
        firstTool: t.firstTool,
        startTime: t.startTime,
        endTime: t.endTime,
        duration,
        maxIteration: t.maxIteration,
        toolsUsed: Array.from(t.toolsUsed),
        appId: t.appId,
        apiInstanceId: t.apiInstanceId,
        logCount: t.logCount,
      };
    })
    .sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""));
}
