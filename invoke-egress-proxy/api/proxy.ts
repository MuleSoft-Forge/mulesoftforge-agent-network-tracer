import { isSafePublicUrl, safeFetch } from "../lib/url-safety";

/**
 * Minimal shape of what this handler actually uses from Vercel's Node
 * serverless request/response — avoids depending on @vercel/node purely for
 * types (its transitive deps pull in flagged tar/undici/esbuild versions,
 * and Vercel's own build pipeline doesn't need this package to deploy a
 * plain (req, res) function).
 */
interface MinimalRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface MinimalResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Generic authenticated egress relay for the main app's Invoke feature.
 *
 * Some A2A brokers (CloudFront/WAF-fronted sandbox environments in
 * particular) allowlist by network/IP reputation and reject requests from
 * third-party hosting providers like Fly.io while accepting requests that
 * originate from AWS's own IP space. This function runs on Vercel (AWS Lambda
 * under the hood) specifically so the main app has a second egress path that
 * originates from an IP range those brokers are more likely to accept.
 *
 * Protected by a shared secret (PROXY_SHARED_SECRET) — this is not a public
 * open proxy. The SSRF guard still applies here too: a leaked secret should
 * not turn this into an internal-network probe.
 */

interface ProxyRequestBody {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

const MAX_TIMEOUT_MS = 280_000; // stay under this function's 300s maxDuration (see vercel.json)
const DEFAULT_TIMEOUT_MS = 15_000;

export default async function handler(req: MinimalRequest, res: MinimalResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.PROXY_SHARED_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Proxy is not configured (missing PROXY_SHARED_SECRET)" });
    return;
  }
  if (req.headers["x-proxy-secret"] !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { url, method, headers, body, timeoutMs } = (req.body ?? {}) as ProxyRequestBody;
  if (!url || !method) {
    res.status(400).json({ error: "Missing required fields: url, method" });
    return;
  }

  const safety = isSafePublicUrl(url, { allowHttp: false });
  if (!safety.ok) {
    res.status(400).json({ error: `Unsafe url: ${safety.reason}` });
    return;
  }

  const effectiveTimeout = Math.min(timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  try {
    const upstream = await safeFetch(
      safety.url.toString(),
      {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(effectiveTimeout),
      },
      { allowHttp: false }
    );
    const text = await upstream.text();
    const responseHeaders: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    res.status(200).json({
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
      body: text,
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    res.status(502).json({
      error: isTimeout
        ? `Upstream did not respond within ${effectiveTimeout}ms (proxy limit)`
        : err instanceof Error
          ? err.message
          : "Upstream fetch failed",
    });
  }
}
