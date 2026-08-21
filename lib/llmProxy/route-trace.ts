import type { LlmProxyRouteTrace } from "./types";

function looksLikeDenyListPayload(o: Record<string, unknown>): boolean {
  const err = String(o.error ?? "").toLowerCase();
  if (err.includes("deny list")) return true;
  if (err.includes("semantically matches deny")) return true;
  if (err.includes("request denied") && err.includes("deny")) return true;
  return false;
}

/**
 * Parse `detail` from a `/api/llm-proxy/chat` error JSON body when it contains
 * stringified JSON (e.g. Flex semantic guard payload).
 */
export function parseChatProxyErrorDetail(
  body: Record<string, unknown>
): Record<string, unknown> | null {
  const detailRaw = body.detail;
  if (detailRaw != null && typeof detailRaw === "object") {
    return detailRaw as Record<string, unknown>;
  }
  let parsed: unknown = detailRaw;
  if (typeof detailRaw === "string") {
    const s = detailRaw.trim();
    if (!s.startsWith("{")) return null;
    try {
      parsed = JSON.parse(s) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  return parsed as Record<string, unknown>;
}

/** Semantic prompt-guard deny list (403) — show inline in chat, not as a generic modal. */
export function isLlmProxyDenyListChatError(
  status: number,
  body: Record<string, unknown>
): boolean {
  if (status !== 403) return false;
  const o = parseChatProxyErrorDetail(body);
  if (!o) return false;
  return looksLikeDenyListPayload(o);
}

/**
 * Build a trace when `/api/llm-proxy/chat` returns an error body (e.g. upstream 403) so the
 * network diagram can still reflect semantic deny-list blocks when Flex sends JSON in `detail`.
 */
export function routeTraceFromChatProxyError(
  status: number,
  body: Record<string, unknown>
): LlmProxyRouteTrace | null {
  if (status !== 403) return null;
  const o = parseChatProxyErrorDetail(body);
  if (!o) return null;
  if (!looksLikeDenyListPayload(o)) return null;
  const topic = typeof o.topic === "string" ? o.topic : undefined;
  const score =
    typeof o.score === "number" && Number.isFinite(o.score) ? o.score : undefined;
  const subtitle =
    topic != null && score != null
      ? `${topic} · score ${score.toFixed(3)}`
      : topic != null
        ? topic
        : undefined;
  return {
    edges: [true, true, true],
    denyListMatch: true,
    routingFallback: false,
    denyTopicLabel: subtitle ?? topic,
  };
}

/**
 * Build diagram route highlights from Flex `x-llm-proxy-*` headers on the chat response.
 * Call when a message completes (non-streaming headers or `llm-proxy-meta` SSE frame).
 */
export function routeTraceFromProxyHeaders(
  headers: Record<string, string>
): LlmProxyRouteTrace | null {
  if (!headers || Object.keys(headers).length === 0) {
    return null;
  }

  const get = (k: string) => (headers[k] ?? "").trim();
  const blocked = /true|1|yes/i.test(get("x-llm-proxy-request-blocked"));
  const provider = get("x-llm-proxy-llm-provider") || undefined;
  const model = get("x-llm-proxy-llm-model") || undefined;
  const routingFallback = /true|1|yes/i.test(
    get("x-llm-proxy-routing-fallback")
  );

  if (blocked) {
    return {
      edges: [true, true, false],
      provider,
      model,
      routingFallback: false,
    };
  }

  return {
    edges: [true, true, true],
    provider,
    model,
    routingFallback,
  };
}
