/**
 * Agent cards published via Exchange sometimes use a literal placeholder instead of
 * a real URL, e.g. `${ingressgw.url}/agentBrokerGetTime`. Substitute with the
 * **public** Flex ingress URL — not CloudHub internal DNS (`*.internal-*.cloudhub.io`).
 */

/** Matches `${ingressgw.url}` (case-insensitive on the token name). */
const INGRESS_PLACEHOLDER = /\$\{\s*ingressgw\.url\s*\}/gi;

/** Upstream LLM/provider URLs sometimes appear in nested config — never use as ingress. */
const UPSTREAM_HOST_HINT =
  /openai\.com|anthropic|googleapis\.com|api\.azure|cohere\.ai|mistral|groq\.com/i;

export function urlContainsIngressPlaceholder(url: string): boolean {
  INGRESS_PLACEHOLDER.lastIndex = 0;
  return INGRESS_PLACEHOLDER.test(url);
}

/**
 * Replace `${ingressgw.url}` with `gatewayBase` (scheme+host, no trailing slash).
 * Does not validate the result URL.
 */
export function substituteIngressGatewayPlaceholder(cardUrl: string, gatewayBase: string): string {
  const base = gatewayBase.replace(/\/+$/, "");
  return cardUrl.replace(INGRESS_PLACEHOLDER, base);
}

/**
 * CloudHub internal worker DNS, bind addresses, and cluster-internal hosts —
 * not reachable as the public Flex ingress consumers use.
 */
export function isNonPublicRuntimeHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h === "0.0.0.0" || h === "[::]" || h === "::1") return true;
  if (h.endsWith(".svc.cluster.local")) return true;
  // CloudHub internal app hostname e.g. *.internal-c9oec.deu-c1.cloudhub.io
  if (h.includes(".internal-") && h.includes("cloudhub.io")) return true;
  if (h.includes(".internal-")) return true;
  if (h.endsWith(".internal")) return true;
  return false;
}

function isProbablyUpstreamProviderHost(hostname: string): boolean {
  return UPSTREAM_HOST_HINT.test(hostname.toLowerCase());
}

function originFromUrlString(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const url = new URL(s);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** Collect http(s) URL strings from an object tree (for proxyConfiguration listeners, etc.). */
function collectHttpUrls(value: unknown, out: string[], depth: number): void {
  if (depth > 12 || out.length > 120) return;
  if (typeof value === "string") {
    const t = value.trim();
    if (/^https?:\/\//i.test(t)) {
      try {
        new URL(t);
        out.push(t);
      } catch {
        /* ignore */
      }
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) collectHttpUrls(v, out, depth + 1);
    return;
  }
  for (const v of Object.values(value)) collectHttpUrls(v, out, depth + 1);
}

type EndpointCandidateSource = "endpointUriTopLevel" | "endpointNested" | "proxyConfig";

function scoreCandidateOrigin(origin: string, source: EndpointCandidateSource): number {
  try {
    const u = new URL(origin);
    const h = u.hostname.toLowerCase();
    if (isNonPublicRuntimeHostname(h)) return -1;
    let score = 0;
    if (u.protocol === "https:") score += 100;
    else score += 40;
    if (isProbablyUpstreamProviderHost(h)) score -= 200;
    // Root `endpointUri` is the consumer-facing ingress URL; nested `endpoint.uri`
    // is often internal CloudHub DNS — prefer top-level when both parse as “public”.
    if (source === "endpointUriTopLevel") score += 40;
    else if (source === "endpointNested") score += 8;
    return score;
  } catch {
    return -1;
  }
}

/**
 * Pick the best **public** ingress origin from API Manager `GET .../apis/{id}` response.
 * Pass the JSON with `includeProxyConfiguration=true` so Flex listener URLs are present.
 *
 * Order: gather **both** root `endpointUri` (public ingress) and nested `endpoint.uri`
 * (often internal) as separate candidates — do **not** coalesce with `??` or the internal
 * URL wins. Then `endpoint.proxyUri`, then `proxyConfiguration`.
 */
export function pickPublicIngressOriginFromApiManagerInstance(
  inst: Record<string, unknown>
): string | null {
  const candidates: { origin: string; source: EndpointCandidateSource }[] = [];

  const endpoint = inst.endpoint as Record<string, unknown> | undefined;
  const topLevelEndpointUri = inst.endpointUri as string | undefined;
  const nestedEndpointUri = endpoint?.uri as string | undefined;
  const proxyUri = endpoint?.proxyUri as string | undefined;

  const push = (raw: string | undefined, source: EndpointCandidateSource) => {
    const o = originFromUrlString(raw);
    if (o) candidates.push({ origin: o, source });
  };

  push(topLevelEndpointUri, "endpointUriTopLevel");
  push(nestedEndpointUri, "endpointNested");
  push(proxyUri, "endpointNested");

  const fromProxyConfig: string[] = [];
  collectHttpUrls(inst.proxyConfiguration, fromProxyConfig, 0);
  for (const raw of fromProxyConfig) {
    const o = originFromUrlString(raw);
    if (o) candidates.push({ origin: o, source: "proxyConfig" });
  }

  let best: { origin: string; score: number } | null = null;
  for (const c of candidates) {
    const score = scoreCandidateOrigin(c.origin, c.source);
    if (score < 0) continue;
    if (!best || score > best.score) best = { origin: c.origin, score };
  }

  return best?.origin ?? null;
}

/** @deprecated Use pickPublicIngressOriginFromApiManagerInstance with full instance JSON. */
export function publicGatewayOriginFromApiInstance(inst: {
  endpoint?: { uri?: string; proxyUri?: string };
  endpointUri?: string;
}): string | null {
  return pickPublicIngressOriginFromApiManagerInstance(inst as Record<string, unknown>);
}
