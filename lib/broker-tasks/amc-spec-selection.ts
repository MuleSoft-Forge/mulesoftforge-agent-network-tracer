/**
 * AMC deployment-spec selection.
 *
 * AMC keeps per-spec logs (`/deployments/{id}/specs/{specId}/logs`), and a
 * task's log lines live under the spec that was *running when it executed* —
 * not under the deployment's current `desiredVersion`. After a redeploy the
 * old lines are still retained, just keyed to the previous spec. To fetch a
 * task's runtime logs we therefore have to pick the spec whose lifetime
 * covered the task, i.e. the newest spec created at or before the task time.
 *
 * The `/specs` endpoint returns `createdAt` as an epoch-millisecond *number*
 * (other platform surfaces occasionally use ISO strings), so timestamp parsing
 * must accept both.
 */
export interface AmcSpecDescriptor {
  id?: string;
  version?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  deployedAt?: string | number;
  lastModified?: string | number;
  creationDate?: string | number;
  dateCreated?: string | number;
  created?: string | number;
  timestamp?: string | number;
}

/** Normalize an ISO string or epoch-ms number to epoch ms, or null. */
export function parseEpochMs(hint?: string | number | null): number | null {
  if (hint == null) return null;
  if (typeof hint === "number") return Number.isFinite(hint) ? hint : null;
  const parsed = Date.parse(hint);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Extract a spec's creation timestamp (epoch ms) from whichever field carries it. */
export function parseSpecTimestamp(spec: AmcSpecDescriptor): number | null {
  // `createdAt` is the field AMC actually returns, so check it first.
  const candidates = [
    spec.createdAt,
    spec.deployedAt,
    spec.updatedAt,
    spec.lastModified,
    spec.creationDate,
    spec.dateCreated,
    spec.created,
    spec.timestamp,
  ];
  for (const value of candidates) {
    if (value == null) continue;
    if (typeof value === "number") {
      if (Number.isFinite(value)) return value;
      continue;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

/**
 * Choose the spec id whose logs should contain a task that ran at `atMs`:
 * the newest spec created at or before `atMs`. Falls back to the newest dated
 * spec, then the first spec, when timestamps are missing or `atMs` is unknown.
 */
export function chooseSpecIdAtOrBefore(
  specs: AmcSpecDescriptor[],
  atMs: number | null
): string | null {
  const candidates = specs
    .map((spec) => ({
      id: spec.version?.trim() || spec.id?.trim() || "",
      at: parseSpecTimestamp(spec),
    }))
    .filter((row) => row.id !== "");
  if (candidates.length === 0) return null;

  if (atMs != null) {
    const atOrBefore = candidates
      .filter((row) => row.at != null && (row.at as number) <= atMs)
      .sort((a, b) => (b.at as number) - (a.at as number));
    if (atOrBefore.length > 0) return atOrBefore[0].id;
  }

  const dated = candidates
    .filter((row) => row.at != null)
    .sort((a, b) => (b.at as number) - (a.at as number));
  if (dated.length > 0) return dated[0].id;
  return candidates[0].id;
}
