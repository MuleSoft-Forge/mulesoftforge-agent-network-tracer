import { safeFetch } from "@/lib/api/url-safety";

/**
 * Some A2A brokers (CloudFront/WAF-fronted sandbox environments in
 * particular) block requests from third-party hosting providers like Fly.io
 * by IP reputation while accepting requests that originate from AWS's own IP
 * space. INVOKE_PROXY_URL/INVOKE_PROXY_SECRET point at a small Vercel
 * function (invoke-egress-proxy/) that gives Invoke a second egress path for
 * exactly those brokers. Callers try the direct path first — this is a
 * fallback, not the primary route, so the common case pays no extra latency.
 */

export interface NormalizedResponse {
  status: number;
  statusText: string;
  ok: boolean;
  headers: Record<string, string>;
  text: string;
}

export interface InvokeFetchInit {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export function egressProxyConfigured(): boolean {
  return Boolean(process.env.INVOKE_PROXY_URL && process.env.INVOKE_PROXY_SECRET);
}

export async function normalizeDirectResponse(res: Response): Promise<NormalizedResponse> {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { status: res.status, statusText: res.statusText, ok: res.ok, headers, text: await res.text() };
}

/** Direct fetch, normalized to the same shape the egress proxy returns. */
export async function fetchDirect(url: string, init: InvokeFetchInit): Promise<NormalizedResponse> {
  const res = await safeFetch(
    url,
    { method: init.method, headers: init.headers, body: init.body, signal: AbortSignal.timeout(init.timeoutMs) },
    { allowHttp: false }
  );
  return normalizeDirectResponse(res);
}

/** Relay through the Vercel egress proxy. Throws if unconfigured or the proxy call itself fails. */
export async function fetchViaEgressProxy(url: string, init: InvokeFetchInit): Promise<NormalizedResponse> {
  const proxyUrl = process.env.INVOKE_PROXY_URL;
  const secret = process.env.INVOKE_PROXY_SECRET;
  if (!proxyUrl || !secret) {
    throw new Error("Egress proxy is not configured");
  }
  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-proxy-secret": secret },
    body: JSON.stringify({ url, method: init.method, headers: init.headers, body: init.body, timeoutMs: init.timeoutMs }),
    // Headroom over the proxy's own internal timeout, so a slow upstream surfaces
    // the proxy's own clear timeout message instead of us aborting first.
    signal: AbortSignal.timeout(init.timeoutMs + 10_000),
  });
  const data = (await res.json().catch(() => null)) as
    | { status: number; statusText: string; headers: Record<string, string>; body: string }
    | { error: string }
    | null;
  if (!data) throw new Error(`Egress proxy returned ${res.status} with no body`);
  if ("error" in data) throw new Error(data.error);
  return { status: data.status, statusText: data.statusText, ok: data.status >= 200 && data.status < 300, headers: data.headers, text: data.body };
}
