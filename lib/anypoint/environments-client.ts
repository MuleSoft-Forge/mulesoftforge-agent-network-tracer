/**
 * Client-side accessor for an org's Anypoint environments.
 *
 * The environment list is needed by the selector, by the fabric graph (to decide
 * `production` vs `sandbox`), and indirectly by anything keyed on the selected
 * environment. Each caller used to fetch it independently, so a single page load
 * hit `/api/accounts/organizations/{orgId}/environments` several times — and the
 * graph path ignored the cache the selector had just populated.
 *
 * Two layers, both keyed by org:
 *   - an in-flight promise map, so concurrent callers share one request
 *   - `sessionStorage`, so a remount or tab return does not refetch
 *
 * Design environments are filtered out once, here, because no caller wants them.
 */

import { parseJson } from "@/lib/parsers";

export interface AnypointEnvironment {
  id: string;
  name: string;
  organizationId: string;
  isProduction: boolean;
  type: "production" | "sandbox" | "design";
  clientId?: string;
  arcNamespace?: string | null;
}

interface EnvironmentsResponse {
  data?: AnypointEnvironment[];
  total?: number;
}

const CACHE_PREFIX = "agent-network-envs-";

const inFlight = new Map<string, Promise<AnypointEnvironment[]>>();

export function readCachedEnvironments(orgId: string): AnypointEnvironment[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + orgId);
    if (!raw) return null;
    const parsed = parseJson(raw);
    if (!Array.isArray(parsed)) return null;
    return (parsed as AnypointEnvironment[]).filter((e) => e.type !== "design");
  } catch {
    return null;
  }
}

function writeCachedEnvironments(orgId: string, list: AnypointEnvironment[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CACHE_PREFIX + orgId, JSON.stringify(list));
  } catch {
    /* sessionStorage full or unavailable — the network path still works */
  }
}

/**
 * Drop every cached environment list.
 *
 * These entries are keyed by org but not by account, and `sessionStorage`
 * outlives a reload. Two accounts with access to the same org can be entitled to
 * different environments, so once the signed-in account changes, anything cached
 * for the previous one has to go rather than be shown as the new account's.
 */
export function clearCachedEnvironments(): void {
  if (typeof window === "undefined") return;
  inFlight.clear();
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    /* sessionStorage unavailable — nothing cached to clear */
  }
}

/**
 * Fetch (or reuse) the non-design environments for an org.
 *
 * Pass `preferCache` when a slightly stale list is acceptable — the environment
 * selector wants to revalidate on mount, whereas the graph only needs to know
 * whether the chosen environment is production.
 */
export function fetchEnvironments(
  orgId: string,
  { preferCache = false }: { preferCache?: boolean } = {}
): Promise<AnypointEnvironment[]> {
  if (preferCache) {
    const cached = readCachedEnvironments(orgId);
    if (cached && cached.length > 0) return Promise.resolve(cached);
  }

  const existing = inFlight.get(orgId);
  if (existing) return existing;

  const request = fetch(`/api/accounts/organizations/${encodeURIComponent(orgId)}/environments`)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((body: EnvironmentsResponse) => {
      const list = (Array.isArray(body.data) ? body.data : []).filter((e) => e.type !== "design");
      writeCachedEnvironments(orgId, list);
      return list;
    })
    .finally(() => {
      inFlight.delete(orgId);
    });

  inFlight.set(orgId, request);
  return request;
}
