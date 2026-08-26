/**
 * Lightweight SSRF guard for user-supplied URLs that this proxy will fetch.
 *
 * Copied from the main app's lib/api/url-safety.ts (kept dependency-free so
 * this project has no import across the monorepo boundary). Keep both copies
 * in sync if the guard logic changes.
 */

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./, // link-local / cloud metadata
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
];

function isPrivateIpv4(host: string): boolean {
  return PRIVATE_IPV4_PATTERNS.some((p) => p.test(host));
}

function isPrivateIpv6(host: string): boolean {
  const stripped = host.startsWith("[") ? host.slice(1, -1) : host;
  const lower = stripped.toLowerCase();
  return (
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80:") ||
    lower.startsWith("::ffff:") // IPv4-mapped — could be private
  );
}

export function isSafePublicUrl(
  candidate: string,
  opts: { allowHttp?: boolean } = {}
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }

  if (url.protocol !== "https:" && !(opts.allowHttp && url.protocol === "http:")) {
    return { ok: false, reason: "Only https URLs are allowed" };
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "ip6-localhost" ||
    hostname.endsWith(".localhost")
  ) {
    return { ok: false, reason: "Localhost is not allowed" };
  }

  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    return { ok: false, reason: "Private/internal addresses are not allowed" };
  }

  return { ok: true, url };
}

/** Thrown by `safeFetch` when an initial URL or a redirect target fails the SSRF guard. */
export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(`Blocked by SSRF guard: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

/**
 * Fetch a user-supplied URL while keeping the SSRF guard intact across redirects.
 *
 * `isSafePublicUrl` only validates the *initial* hostname; a public URL can
 * still 3xx-redirect to `127.0.0.1` / `169.254.169.254`. This follows redirects
 * manually and re-validates every hop, so the guard cannot be bypassed.
 */
export async function safeFetch(
  initialUrl: string,
  init: RequestInit = {},
  opts: { allowHttp?: boolean; maxRedirects?: number } = {}
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const safety = isSafePublicUrl(currentUrl, { allowHttp: opts.allowHttp });
    if (!safety.ok) throw new SsrfBlockedError(safety.reason);

    const res = await fetch(currentUrl, { ...init, redirect: "manual" });

    const isRedirect = res.status >= 300 && res.status < 400;
    const location = res.headers.get("location");
    if (!isRedirect || !location) return res;

    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new SsrfBlockedError("Too many redirects");
}
