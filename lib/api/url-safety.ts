/**
 * Lightweight SSRF guard for user-supplied URLs that the server will fetch
 * with credentials attached.
 *
 * This is a best-effort defense (DNS rebinding, IPv6 edge cases, and host
 * resolution-vs-fetch TOCTOU are *not* fully closed here). It exists to prevent
 * the obvious attack: an authenticated user posting a URL that points at
 * 169.254.169.254 / 127.0.0.1 / an internal RFC1918 address and having the
 * server forward their credentials there.
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
