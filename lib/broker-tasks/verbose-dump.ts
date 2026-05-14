/**
 * Loud structured dumps for POST /api/broker-tasks debugging (orgId, tokens, session flags).
 *
 * - On by default when NODE_ENV=development.
 * - In production, set BROKER_TASKS_VERBOSE_LOG=1 (logs secrets — use only locally).
 *
 * This bypasses ENABLE_API_LOGGING so you still see dumps when API logging is off.
 */

export function brokerTasksVerboseDumpEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.BROKER_TASKS_VERBOSE_LOG === "1" ||
    process.env.BROKER_TASKS_VERBOSE_LOG === "true"
  );
}

export function dumpBrokerTasksVerbose(tag: string, payload: Record<string, unknown>): void {
  if (!brokerTasksVerboseDumpEnabled()) return;
  console.log(`[BROKER-TASKS-DUMP] ${tag}`, JSON.stringify(payload, null, 2));
}
