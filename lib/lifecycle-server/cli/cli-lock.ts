/**
 * anypoint-cli-v4 can't tolerate two of its own invocations starting at the
 * same instant on one machine — verified by reproduction, concurrent launches
 * intermittently hang instead of running (and once the ops-page probe hit
 * this, both "CLI detected" and "plugin detected" read false with no useful
 * error). The lifecycle worker runs jobs at concurrency > 1, so this
 * serializes actual CLI spawns per process: callers queue behind each other
 * instead of racing.
 */

let queue: Promise<void> = Promise.resolve();

export async function withCliLock<T>(
  signal: AbortSignal,
  fn: () => Promise<T>,
  whenAborted: () => T
): Promise<T> {
  const turn = queue;
  let release!: () => void;
  queue = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await turn;
    if (signal.aborted) return whenAborted();
    return await fn();
  } finally {
    release();
  }
}
