import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";
import { resolveAllowedUrl } from "@/lib/api/allowed-hosts";
import {
  pickPublicIngressOriginFromApiManagerInstance,
  substituteIngressGatewayPlaceholder,
  urlContainsIngressPlaceholder,
} from "@/lib/invoke/ingress-gateway-url";

export const dynamic = "force-dynamic";

interface ExchangeFile {
  classifier?: string;
  packaging?: string;
  externalLink?: string;
  downloadURL?: string;
}

interface ExchangeAsset {
  files?: ExchangeFile[];
}

async function fetchGatewayOriginFromRm(
  baseUrl: string,
  accessToken: string,
  orgId: string,
  envId: string,
  apiInstanceId: string
): Promise<string | null> {
  const apiUrl =
    `${baseUrl}/apimanager/api/v1/organizations/${encodeURIComponent(orgId)}` +
    `/environments/${encodeURIComponent(envId)}/apis/${encodeURIComponent(apiInstanceId)}` +
    `?includeProxyConfiguration=true&includeTlsContexts=true`;
  const res = await loggedFetch(apiUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    debugLog("[BROKER-URL] RM apis/{id} failed:", res.status);
    return null;
  }
  const inst = (await res.json()) as Record<string, unknown>;
  const origin = pickPublicIngressOriginFromApiManagerInstance(inst);
  debugLog("[BROKER-URL] RM public ingress origin:", origin ?? "(none)");
  return origin;
}

/**
 * Resolves the A2A endpoint URL for a broker:
 * - Reads `a2a-card.json` from Exchange (`orgId` + `assetId`).
 * - If the card contains `${ingressgw.url}`, substitutes the **public** gateway
 *   base from API Manager (`GET .../apis/{apiInstanceId}` → `endpoint.uri`).
 *
 * Query params:
 * - `orgId`, `assetId` — Exchange lookup (required unless `resolveUrl` is used).
 * - Optional `envId`, `apiInstanceId` — required to expand `${ingressgw.url}`.
 *
 * **Resolve-only mode:** `resolveUrl` + `orgId` + `envId` + `apiInstanceId` — no Exchange;
 * substitutes placeholders in a pasted URL (Invoke **Load** button).
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { baseUrl, accessToken } = authResult;
  const { searchParams } = request.nextUrl;
  const orgId = searchParams.get("orgId");
  const assetId = searchParams.get("assetId");
  const envId = searchParams.get("envId");
  const apiInstanceId = searchParams.get("apiInstanceId");
  const resolveUrlRaw = searchParams.get("resolveUrl");

  const authHeader = `Bearer ${accessToken}`;

  try {
    // --- Resolve-only: pasted URL with placeholder ---
    if (resolveUrlRaw != null && resolveUrlRaw !== "") {
      if (!orgId || !envId || !apiInstanceId) {
        return NextResponse.json(
          { error: "resolveUrl requires orgId, envId, and apiInstanceId", url: null },
          { status: 400 }
        );
      }
      const candidate = resolveUrlRaw.trim();
      if (!urlContainsIngressPlaceholder(candidate)) {
        return NextResponse.json({ url: candidate, substituted: false });
      }
      const origin = await fetchGatewayOriginFromRm(baseUrl, accessToken, orgId, envId, apiInstanceId);
      if (!origin) {
        return NextResponse.json({
          url: null,
          reason: "gateway_origin_unavailable",
          message:
            "Could not read a public Flex ingress URL from API Manager (internal CloudHub URIs are ignored). Check env/instance or proxy configuration.",
        });
      }
      const url = substituteIngressGatewayPlaceholder(candidate, origin);
      debugLog("[BROKER-URL] resolveUrl substituted →", url);
      return NextResponse.json({ url, substituted: true, gatewayOrigin: origin });
    }

    if (!orgId || !assetId) {
      return NextResponse.json({ error: "orgId and assetId are required (unless resolveUrl is used)" }, { status: 400 });
    }

    const assetUrl = `${baseUrl}/exchange/api/v2/assets/${encodeURIComponent(orgId)}/${encodeURIComponent(assetId)}`;
    const assetRes = await loggedFetch(assetUrl, { headers: { Authorization: authHeader } });
    if (!assetRes.ok) {
      const text = await assetRes.text();
      return NextResponse.json(
        { error: `Exchange asset fetch failed: ${assetRes.status}`, url: null },
        { status: assetRes.status }
      );
    }

    const asset = (await assetRes.json()) as ExchangeAsset;
    const files = asset.files ?? [];

    debugLog("[BROKER-URL] Exchange files for", assetId, ":", files.map((f) => `${f.classifier}.${f.packaging}`));

    const cardFile = files.find(
      (f) =>
        f.classifier?.toLowerCase() === "a2a-card" &&
        ["json", "yaml", "yml"].includes(f.packaging?.toLowerCase() ?? "")
    );

    if (!cardFile) {
      return NextResponse.json({ url: null, reason: "no_a2a_card" });
    }

    const fileUrl = cardFile.downloadURL ?? cardFile.externalLink;
    if (!fileUrl) {
      return NextResponse.json({ url: null, reason: "no_download_url" });
    }

    // Validate the download host before attaching the user's bearer token —
    // a compromised Exchange asset could otherwise point `downloadURL` /
    // `externalLink` at an attacker host and exfiltrate the OAuth token.
    const safeFileUrl = resolveAllowedUrl(fileUrl, baseUrl);
    if (!safeFileUrl) {
      debugLog("[BROKER-URL] a2a-card download host not allowlisted:", fileUrl);
      return NextResponse.json({ url: null, reason: "download_host_not_allowed" });
    }

    const fileRes = await loggedFetch(safeFileUrl.toString(), { headers: { Authorization: authHeader } });
    if (!fileRes.ok) {
      return NextResponse.json({ url: null, reason: "download_failed" });
    }

    const text = await fileRes.text();
    let card: { url?: string } = {};
    try {
      card = JSON.parse(text) as { url?: string };
    } catch {
      const match = /^url:\s*["']?([^\s"'\n]+)/m.exec(text);
      if (match) card = { url: match[1] };
    }

    let brokerUrl = typeof card.url === "string" ? card.url.trim() : null;
    debugLog("[BROKER-URL] Raw card URL for", assetId, "→", brokerUrl ?? "(none)");

    if (brokerUrl && urlContainsIngressPlaceholder(brokerUrl)) {
      if (envId && apiInstanceId) {
        const origin = await fetchGatewayOriginFromRm(baseUrl, accessToken, orgId, envId, apiInstanceId);
        if (origin) {
          brokerUrl = substituteIngressGatewayPlaceholder(brokerUrl, origin);
          debugLog("[BROKER-URL] After ingress substitution →", brokerUrl);
        } else {
          debugLog("[BROKER-URL] Placeholder in card but RM did not return gateway origin — returning raw");
          return NextResponse.json({
            url: brokerUrl,
            reason: "ingress_placeholder_unresolved",
            message:
              "Card URL uses ${ingressgw.url} but the public gateway could not be read from API Manager. Ensure envId and apiInstanceId match the deployed API.",
          });
        }
      } else {
        return NextResponse.json({
          url: brokerUrl,
          reason: "ingress_placeholder_needs_instance",
          message:
            "Card URL uses ${ingressgw.url}. Select org/env and a broker so we can resolve the gateway from API Manager.",
        });
      }
    }

    return NextResponse.json({ url: brokerUrl });
  } catch (err) {
    debugError("[BROKER-URL] Error:", err);
    return NextResponse.json({ error: "Failed to resolve broker URL", url: null }, { status: 500 });
  }
}
