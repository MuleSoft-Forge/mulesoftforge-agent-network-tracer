/**
 * Phase timing for slow API routes.
 *
 * The agent-network task routes fan out to many Anypoint endpoints, so "the
 * request took 12s" is useless on its own — we need to know which phase owned
 * the time. A timer collects named phases plus arbitrary counters (upstream
 * calls, documents fetched, bytes parsed) and renders them two ways:
 *
 *   - `summary()` for the dev server console
 *   - `toServerTiming()` for the `Server-Timing` response header, which browser
 *     devtools renders inline on the network row
 *
 * Timing is always collected (it is a few `performance.now()` calls); only the
 * console output is gated behind development.
 */

interface Phase {
  name: string;
  ms: number;
}

export class PhaseTimer {
  private readonly label: string;
  private readonly startedAt = performance.now();
  private readonly phases: Phase[] = [];
  private readonly counters = new Map<string, number>();
  private readonly notes = new Map<string, string>();

  constructor(label: string) {
    this.label = label;
  }

  /** Start a phase; call the returned function when it finishes. */
  start(name: string): () => void {
    const from = performance.now();
    return () => {
      this.phases.push({ name, ms: performance.now() - from });
    };
  }

  /** Time an async operation and return its result. */
  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const done = this.start(name);
    try {
      return await fn();
    } finally {
      done();
    }
  }

  /** Add to a named counter (upstream calls, hits fetched, bytes, …). */
  count(name: string, delta = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + delta);
  }

  /**
   * Record a non-numeric fact about the request (resolved region, cache hit or
   * miss, chosen strategy). A phase time tells us *where* the time went; a note
   * tells us *which branch* spent it, which is usually what turns a timing line
   * into a diagnosis.
   */
  note(name: string, value: string): void {
    this.notes.set(name, value);
  }

  get totalMs(): number {
    return performance.now() - this.startedAt;
  }

  /**
   * Compact one-line breakdown, slowest phase first, e.g.
   * `[TIMING] broker-tasks total=8421ms | runtime-logs=5310ms msearch=2740ms … | upstreamCalls=37 hits=6102`
   */
  summary(): string {
    const sorted = [...this.phases].sort((a, b) => b.ms - a.ms);
    const parts = sorted.map((p) => `${p.name}=${Math.round(p.ms)}ms`).join(" ");
    const counts = [...this.counters.entries()].map(([k, v]) => `${k}=${v}`).join(" ");
    const notes = [...this.notes.entries()].map(([k, v]) => `${k}=${v}`).join(" ");
    return `[TIMING] ${this.label} total=${Math.round(this.totalMs)}ms | ${parts}${counts ? ` | ${counts}` : ""}${notes ? ` | ${notes}` : ""}`;
  }

  /**
   * Print {@link summary} to the dev console. Deliberately not routed through
   * `debugLog`: that is gated behind `ENABLE_API_LOGGING`, which also turns on
   * full request/response body logging — and serialising multi-megabyte
   * log-search payloads distorts the very timings being measured. One line per
   * request is cheap enough to always emit in development.
   */
  logSummary(): void {
    if (process.env.NODE_ENV !== "development") return;
    console.log(this.summary());
  }

  /**
   * `Server-Timing` header value. Phase names are sanitised to the token
   * characters the header grammar allows.
   */
  toServerTiming(): string {
    const entries = this.phases.map(
      (p) => `${p.name.replace(/[^a-zA-Z0-9_-]/g, "-")};dur=${p.ms.toFixed(1)}`
    );
    entries.push(`total;dur=${this.totalMs.toFixed(1)}`);
    return entries.join(", ");
  }
}

/**
 * Time `fn` when a timer was supplied, otherwise just run it. Lets library code
 * take an optional timer without wrapping every call site in a null check.
 */
export function measurePhase<T>(
  timer: PhaseTimer | undefined,
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  return timer != null ? timer.measure(name, fn) : fn();
}
