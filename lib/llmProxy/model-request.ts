import type { LlmProxyUpstream } from "@/lib/llmProxy/types";

/**
 * Format a route's model for Flex Gateway when `model` is sent in chat requests.
 * With multiple providers, the gateway requires `provider/model` (e.g. `azureopenai/gpt-5-mini`).
 */
export function formatLlmProxyModelForRequest(u: LlmProxyUpstream): string {
  const raw = u.targetModel?.trim() ?? "";
  if (raw.length === 0) return "";
  if (raw.includes("/")) return raw;
  const p = u.provider?.trim();
  if (p && p.length > 0) {
    return `${p.toLowerCase()}/${raw}`;
  }
  return raw;
}

/** Deduplicated sorted list of formatted model strings for datalist / pickers. */
export function collectModelOptions(upstreams: LlmProxyUpstream[]): string[] {
  const opts = new Set<string>();
  for (const u of upstreams) {
    const s = formatLlmProxyModelForRequest(u);
    if (s.length > 0) opts.add(s);
  }
  return Array.from(opts).sort((a, b) => a.localeCompare(b));
}

/**
 * If `bareOrQualified` has no `/`, find upstreams whose bare `targetModel` matches
 * and return the formatted string when exactly one match exists.
 */
export function resolveBareModelViaSingleUpstream(
  bareOrQualified: string,
  upstreams: LlmProxyUpstream[]
): string | null {
  const t = bareOrQualified.trim();
  if (t.length === 0 || t.includes("/")) return null;
  const matches = upstreams.filter(
    (u) => u.targetModel?.trim() === t
  );
  if (matches.length !== 1) return null;
  return formatLlmProxyModelForRequest(matches[0]);
}
