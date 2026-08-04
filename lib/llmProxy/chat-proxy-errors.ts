import { parseChatProxyErrorDetail } from "./route-trace";

/** User-visible line for the semantic deny list (inline in chat). */
export function formatDenyListInlineMessage(body: Record<string, unknown>): string {
  const o = parseChatProxyErrorDetail(body);
  if (o) {
    const main = String(o.error ?? "").trim();
    const topic = typeof o.topic === "string" ? o.topic.trim() : "";
    const score =
      typeof o.score === "number" && Number.isFinite(o.score)
        ? `score ${o.score.toFixed(3)}`
        : "";
    const bits = [main, topic && `Topic: ${topic}`, score].filter(Boolean);
    if (bits.length > 0) return bits.join(" · ");
  }
  return String(body.error ?? "This prompt matched a semantic deny topic and was blocked.");
}

export function implementationErrorCopy(status: number): {
  title: string;
  hint: string;
} {
  if (status === 502 || status === 503 || status === 504) {
    return {
      title: "Could not reach the LLM Proxy",
      hint: "The tracer could not complete a request to your Flex public URL. Check network, DNS, and that the worker is up.",
    };
  }
  if (status >= 500) {
    return {
      title: "Downstream LLM or gateway error",
      hint: "The LLM Proxy accepted the request but the upstream model or gateway returned an error. Check provider keys, quotas, and model names in Anypoint.",
    };
  }
  if (status === 404 || status === 405) {
    return {
      title: "MuleSoft LLM Proxy configuration error",
      hint: "The route or API shape does not match what the runtime exposes (base path, /responses vs /chat/completions, or Flex policy order). Review the API instance in Anypoint.",
    };
  }
  if (status === 401) {
    return {
      title: "Authentication error",
      hint: "Flex rejected client_id / client_secret or the API policy chain. Verify credentials and policies in Anypoint.",
    };
  }
  if (status === 403) {
    return {
      title: "MuleSoft LLM Proxy entitlement error",
      hint: "The proxy returned 403 without a semantic deny-list payload. Check contracts, policies, and environment access in Anypoint.",
    };
  }
  return {
    title: "MuleSoft LLM Proxy error",
    hint: "Inspect the full response payload and your Anypoint / Flex Gateway configuration.",
  };
}
