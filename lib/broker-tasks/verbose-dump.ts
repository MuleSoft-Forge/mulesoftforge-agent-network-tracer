/**
 * Loud structured dumps for POST /api/broker-tasks debugging (orgId, tokens, session flags).
 *
 * Development-only (`NODE_ENV=development`). Never runs on Vercel production/preview.
 * Requires BROKER_TASKS_VERBOSE_LOG=1 in addition.
 */

export function brokerTasksVerboseDumpEnabled(): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  return (
    process.env.BROKER_TASKS_VERBOSE_LOG === "1" ||
    process.env.BROKER_TASKS_VERBOSE_LOG === "true"
  );
}

export function dumpBrokerTasksVerbose(tag: string, payload: Record<string, unknown>): void {
  if (!brokerTasksVerboseDumpEnabled()) return;
  console.log(`[BROKER-TASKS-DUMP] ${tag}`, JSON.stringify(payload, null, 2));
}
