import type { LlmProxyRoutingRule } from "./types";

/**
 * Normalizes API Manager `apis[].routing` (see Flex LLM Proxy asset JSON) into UI-friendly rows.
 */
export function parseApiManagerRouting(routing: unknown): LlmProxyRoutingRule[] | undefined {
  if (!Array.isArray(routing) || routing.length === 0) {
    return undefined;
  }

  const out: LlmProxyRoutingRule[] = [];

  for (const raw of routing) {
    if (!raw || typeof raw !== "object") continue;
    const label = (raw as { label?: unknown }).label;
    if (typeof label !== "string" || !label.trim()) continue;

    const rules = (raw as { rules?: { headers?: Record<string, unknown> } }).rules;
    const headers = rules?.headers;
    let matchSummary: string | null = null;
    if (headers && typeof headers === "object") {
      const parts = Object.entries(headers)
        .filter(([, v]) => typeof v === "string" || typeof v === "number")
        .map(([k, v]) => `${k}: ${String(v)}`);
      if (parts.length > 0) {
        matchSummary = parts.join(", ");
      }
    }

    const upstreams = (raw as { upstreams?: unknown }).upstreams;
    const upstreamIds: string[] = [];
    if (Array.isArray(upstreams)) {
      for (const u of upstreams) {
        if (u && typeof u === "object" && "id" in u) {
          const id = (u as { id?: unknown }).id;
          if (typeof id === "string" || typeof id === "number") {
            upstreamIds.push(String(id));
          }
        }
      }
    }

    out.push({ label: label.trim(), matchSummary, upstreamIds });
  }

  return out.length > 0 ? out : undefined;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** API Manager uses `denyTopicIDs` on `globalRouting.llmConfigs`. */
function parseDenyTopicIds(cfg: Record<string, unknown>): string[] {
  const raw = cfg.denyTopicIDs ?? cfg.denyTopicIds;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id === "string" && id.trim()) out.push(id.trim());
    else if (typeof id === "number" && Number.isFinite(id)) out.push(String(id));
  }
  return out;
}

/**
 * Reads `metadata.globalRouting.llmConfigs` from API Manager (list/detail).
 * Fallback fields match Flex docs / asset JSON (`fallbackRoute`, `fallbackModel`, `fallbackThreshold`).
 */
export function parseGlobalRoutingMeta(metadata: unknown): {
  routingStrategy: "model-based" | "semantic" | "unknown";
  fallbackRoute: string | null;
  fallbackModel: string | null;
  fallbackThreshold: number | null;
  /** From `llmConfigs.denyTopicIDs` — semantic Prompt Guard deny-list topic ids. */
  denyTopicIds: string[];
} {
  const empty = {
    routingStrategy: "unknown" as const,
    fallbackRoute: null,
    fallbackModel: null,
    fallbackThreshold: null,
    denyTopicIds: [] as string[],
  };
  if (!metadata || typeof metadata !== "object") {
    return empty;
  }
  const gr = (metadata as { globalRouting?: unknown }).globalRouting;
  if (!gr || typeof gr !== "object") {
    return empty;
  }
  const llmConfigs = (gr as { llmConfigs?: unknown }).llmConfigs;
  if (!llmConfigs || typeof llmConfigs !== "object") {
    return empty;
  }
  const cfg = llmConfigs as {
    routingType?: string;
    fallbackRoute?: string;
    fallbackModel?: string;
    fallbackThreshold?: unknown;
  };
  const denyTopicIds = parseDenyTopicIds(llmConfigs as Record<string, unknown>);
  const rt = (cfg.routingType ?? "").toLowerCase();
  let routingStrategy: "model-based" | "semantic" | "unknown" = "unknown";
  if (rt.includes("semantic")) routingStrategy = "semantic";
  else if (rt.includes("model")) routingStrategy = "model-based";

  const fr = cfg.fallbackRoute;
  const fallbackRoute = typeof fr === "string" && fr.trim() ? fr.trim() : null;
  const fm = cfg.fallbackModel;
  const fallbackModel = typeof fm === "string" && fm.trim() ? fm.trim() : null;
  const fallbackThreshold = numOrNull(cfg.fallbackThreshold);

  return { routingStrategy, fallbackRoute, fallbackModel, fallbackThreshold, denyTopicIds };
}
