/**
 * Helpers for building Log Search identifiers from Runtime Manager API metadata.
 * HY / Flex-routed brokers often log under a shared gateway appId while the
 * broker identity appears in the endpoint path or Exchange assetId.
 */

/** Last non-empty path segment from an RM endpoint URI (e.g. agent_broker_get_date). */
export function parseBrokerRouteFromEndpoint(uri: string | undefined): string | undefined {
  if (!uri?.trim()) return undefined;
  const trimmed = uri.trim();
  try {
    const normalized = trimmed.replace(/^http:\/\//i, "https://");
    const path = new URL(normalized).pathname;
    const segments = path.split("/").filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : undefined;
  } catch {
    const match = trimmed.match(/\/([^/?#]+)\/?(?:[?#]|$)/);
    return match?.[1];
  }
}

/** Unique appId / route values plus hyphen ↔ underscore variants for Lucene queries. */
export function logSearchAppIdCandidates(...values: Array<string | undefined>): string[] {
  const out = new Set<string>();
  for (const raw of values) {
    if (!raw?.trim()) continue;
    const value = raw.trim();
    out.add(value);
    const hyphenated = value.replace(/_/g, "-");
    const underscored = value.replace(/-/g, "_");
    if (hyphenated !== value) out.add(hyphenated);
    if (underscored !== value) out.add(underscored);
  }
  return [...out];
}

export function isHyperscaleDeploymentType(deploymentType: string | undefined): boolean {
  if (!deploymentType) return false;
  const upper = deploymentType.toUpperCase();
  return upper === "HY" || upper === "RR" || upper === "RF";
}
