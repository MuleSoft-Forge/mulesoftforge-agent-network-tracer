/**
 * Loud structured dumps for POST /api/broker-tasks debugging (orgId, tokens, session flags).
 *
 * These dumps include access/refresh tokens, so they are restricted to local
 * development only. The opt-in must ALSO set BROKER_TASKS_VERBOSE_LOG to avoid
 * accidentally printing secrets, and it never activates outside development —
 * even if the env var is set in a deployed environment.
 *
 * This bypasses ENABLE_API_LOGGING so you still see dumps when API logging is off.
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
