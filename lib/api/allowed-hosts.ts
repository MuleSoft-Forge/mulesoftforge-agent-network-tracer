/**
 * Allowlist of Anypoint / MuleSoft control-plane hosts the server may call
 * on behalf of a signed-in user. Used to block SSRF and prevent leaking the
 * user's bearer token to attacker-controlled URLs (e.g. via ?downloadURL=).
 */
import { REGIONS } from "@/lib/regions";

const STATIC_ALLOWED_HOSTS = new Set<string>([
  ...REGIONS.map((r) => new URL(r.baseUrl).host),
  // Exchange/CDN hosts that sometimes appear in download URLs.
  "exchange2-asset-manager-kprod.s3.amazonaws.com",
  "exchange2-file-repository-kprod.s3.amazonaws.com",
]);

/**
 * Resolve `candidate` against `sessionBaseUrl` (for relative paths) and return
 * a safe absolute URL, or null if the candidate's host is not allowlisted.
 *
 * Accepts:
 *   - relative paths ("/exchange/api/...") → resolved against sessionBaseUrl
 *   - absolute URLs whose host matches the session baseUrl host or an
 *     explicitly allowlisted host (Anypoint regions, Exchange S3 buckets)
 */
export function resolveAllowedUrl(
  candidate: string,
  sessionBaseUrl: string
): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(candidate, sessionBaseUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const sessionHost = (() => {
    try {
      return new URL(sessionBaseUrl).host;
    } catch {
      return null;
    }
  })();

  if (sessionHost && parsed.host === sessionHost) return parsed;
  if (STATIC_ALLOWED_HOSTS.has(parsed.host)) return parsed;
  return null;
}
