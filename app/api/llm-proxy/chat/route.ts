import { NextRequest, NextResponse } from "next/server";
import { debugError, debugLog } from "@/lib/api-logger";
import { isAuthenticated } from "@/lib/session";
import { isSafePublicUrl, safeFetch, SsrfBlockedError } from "@/lib/api/url-safety";
import type { LlmProxyChatRequest } from "@/lib/llmProxy/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Proxy a single chat request to the Flex Gateway LLM Proxy endpoint.
 *
 * Forwards `client_id` / `client_secret` headers provided by the browser (from
 * localStorage); we do not persist them server-side.
 *
 * Surfaces Flex Gateway response headers (`x-llm-proxy-*`) on both paths:
 * - Non-streaming: wraps body as `{ data, headers }`.
 * - Upstream error: returns JSON with raw `detail` (body text), optional
 *   `upstreamJson` when the body was JSON, `upstreamStatus`, `headers`, and a
 *   short `error` summary so the client can show a modal vs inline deny-list.
 * - Streaming: forwards `x-llm-proxy-*` headers verbatim on the SSE response
 *   AND appends a final `event: llm-proxy-meta\n data: {...}` chunk with the
 *   captured headers, so clients can always recover metadata even if an edge
 *   strips custom headers. Upstream body is otherwise passed through byte-for-byte.
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: LlmProxyChatRequest;
  try {
    body = (await request.json()) as LlmProxyChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { endpoint, publicEndpoint, basePath, clientId, clientSecret, payload } = body;
  if (!endpoint || !publicEndpoint || !basePath || !clientId || !clientSecret || !payload) {
    return NextResponse.json(
      {
        error:
          "Missing required fields: endpoint, publicEndpoint, basePath, clientId, clientSecret, payload",
      },
      { status: 400 }
    );
  }
  if (endpoint !== "/chat/completions" && endpoint !== "/responses") {
    return NextResponse.json(
      { error: "endpoint must be '/chat/completions' or '/responses'" },
      { status: 400 }
    );
  }

  const targetUrl = joinUrl(publicEndpoint, basePath, endpoint);

  // SSRF guard: Flex Gateway LLM Proxies live on customer-controlled hosts, so
  // we can't allowlist them. But we *can* refuse private/loopback hosts and
  // non-https URLs — this stops the common attack (forge a request that points
  // the server at 169.254.169.254 / 127.0.0.1 with user credentials attached).
  const safety = isSafePublicUrl(targetUrl);
  if (!safety.ok) {
    return NextResponse.json(
      { error: `publicEndpoint rejected: ${safety.reason}` },
      { status: 400 }
    );
  }

  const wantsStream = Boolean((payload as Record<string, unknown>).stream);

  debugLog("[LLM-PROXY/CHAT] forwarding", {
    target: targetUrl,
    stream: wantsStream,
    payloadKeys: Object.keys(payload),
  });

  try {
    const upstream = await safeFetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: wantsStream ? "text/event-stream" : "application/json",
        client_id: clientId,
        client_secret: clientSecret,
      },
      body: JSON.stringify(payload),
    });

    const proxyHeaders = collectProxyHeaders(upstream.headers);

    if (!upstream.ok) {
      const contentType = upstream.headers.get("Content-Type") ?? "";
      const text = await upstream.text();
      let upstreamJson: unknown = undefined;
      if (contentType.includes("application/json") && text.trim().length > 0) {
        try {
          upstreamJson = JSON.parse(text) as unknown;
        } catch {
          /* keep text in detail only */
        }
      }

      let errorSummary = `LLM Proxy returned ${upstream.status}`;
      if (upstreamJson !== undefined && typeof upstreamJson === "object" && upstreamJson !== null) {
        const o = upstreamJson as Record<string, unknown>;
        const er = o.error;
        const msg = o.message;
        if (typeof er === "string" && er.trim()) errorSummary = er;
        else if (typeof msg === "string" && msg.trim()) errorSummary = msg;
      }

      debugError("[LLM-PROXY/CHAT] upstream error", upstream.status, text.slice(0, 500));
      return NextResponse.json(
        {
          error: errorSummary,
          detail: text.slice(0, 1000),
          upstreamJson,
          upstreamStatus: upstream.status,
          upstreamContentType: contentType || undefined,
          headers: proxyHeaders,
        },
        { status: upstream.status }
      );
    }

    if (wantsStream && upstream.body) {
      const responseHeaders = new Headers({
        "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      for (const [k, v] of Object.entries(proxyHeaders)) {
        responseHeaders.set(k, v);
      }
      responseHeaders.set("X-Llm-Proxy-Headers", JSON.stringify(proxyHeaders));

      const passthrough = wrapStreamWithMetaEvent(upstream.body, proxyHeaders);
      return new NextResponse(passthrough, {
        status: 200,
        headers: responseHeaders,
      });
    }

    const contentType = upstream.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const json = (await upstream.json()) as unknown;
      return NextResponse.json({ data: json, headers: proxyHeaders });
    }
    const text = await upstream.text();
    return NextResponse.json({ data: text, headers: proxyHeaders });
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      return NextResponse.json(
        { error: "LLM Proxy URL resolves to a disallowed address" },
        { status: 400 }
      );
    }
    debugError("[LLM-PROXY/CHAT] proxy error", error);
    const message = error instanceof Error ? error.message : "Unknown proxy error";
    return NextResponse.json(
      { error: "Failed to reach LLM Proxy", detail: message },
      { status: 502 }
    );
  }
}

function joinUrl(publicEndpoint: string, basePath: string, endpoint: string): string {
  const trimmedBase = publicEndpoint.replace(/\/+$/, "");
  const normalizedBasePath = basePath.startsWith("/") ? basePath : `/${basePath}`;
  const trimmedBasePath = normalizedBasePath.replace(/\/+$/, "");
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${trimmedBase}${trimmedBasePath}${normalizedEndpoint}`;
}

/**
 * Pluck `x-llm-proxy-*` headers (plus `x-request-id` and content-type) from
 * the upstream response for downstream observability. Returns a plain object
 * with lower-cased keys.
 */
function collectProxyHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k.startsWith("x-llm-proxy-") || k === "x-request-id" || k === "content-type") {
      out[k] = value;
    }
  });
  return out;
}

/**
 * Pipe the upstream SSE body to the client while appending a final
 * `event: llm-proxy-meta` frame carrying the captured headers. Safe even if
 * the upstream never sends a trailing newline.
 */
function wrapStreamWithMetaEvent(
  upstream: ReadableStream<Uint8Array>,
  meta: Record<string, string>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const reader = upstream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          const trailer =
            `\nevent: llm-proxy-meta\n` +
            `data: ${JSON.stringify(meta)}\n\n`;
          controller.enqueue(encoder.encode(trailer));
          controller.close();
          return;
        }
        if (value) controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {
        /* ignore */
      });
    },
  });
}
