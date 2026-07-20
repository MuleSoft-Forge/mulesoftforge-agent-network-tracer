import { NextRequest, NextResponse } from "next/server";
import { loggedFetch, debugLog, debugError } from "@/lib/api-logger";
import { requireAuth } from "@/lib/api/auth-middleware";
import { resolveAllowedUrl } from "@/lib/api/allowed-hosts";
import {
  extractProtocolVersionFromCardPayload,
  inferA2AVersionFromCardClassifier,
} from "@/lib/invoke/a2a-version";
import {
  pickPublicEndpointUriFromApiManagerInstance,
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

interface ExchangeAssetInstance {
  id?: string | number;
  environmentId?: string;
  endpointUri?: string | null;
}

interface ExchangeAsset {
  files?: ExchangeFile[];
  instances?: ExchangeAssetInstance[];
}

const A2A_CARD_CLASSIFIERS = [
  "a2a-card",
  "a2a-v2-card",
  "a2a-v1-card",
  "agent-card",
] as const;

function isA2aCardFile(file: ExchangeFile): boolean {
  const classifier = file.classifier?.toLowerCase();
  const packaging = file.packaging?.toLowerCase();
  return (
    typeof classifier === "string" &&
    A2A_CARD_CLASSIFIERS.some(
      (candidate) =>
        classifier === candidate || classifier.startsWith(`${candidate}-`)
    ) &&
    ["json", "yaml", "yml"].includes(packaging ?? "")
  );
}

async function fetchApiManagerInstance(
  baseUrl: string,
  accessToken: string,
  orgId: string,
  envId: string,
  apiInstanceId: string
): Promise<Record<string, unknown> | null> {
  // The documented param is `includeProxyTemplate`; `includeProxyConfiguration`
  // is undocumented but is what this code currently reads the response with.
  // Send both so we get the data regardless of which one the backend honors,
  // until the response shape (`proxyConfiguration` vs `proxyTemplate`) is
  // confirmed live.
  const apiUrl =
    `${baseUrl}/apimanager/api/v1/organizations/${encodeURIComponent(orgId)}` +
    `/environments/${encodeURIComponent(envId)}/apis/${encodeURIComponent(apiInstanceId)}` +
    `?includeProxyTemplate=true&includeProxyConfiguration=true&includeTlsContexts=true`;
  const res = await loggedFetch(apiUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    debugLog("[BROKER-URL] RM apis/{id} failed:", res.status);
    return null;
  }
  return (await res.json()) as Record<string, unknown>;
}

async function fetchGatewayOriginFromRm(
  baseUrl: string,
  accessToken: string,
  orgId: string,
  envId: string,
  apiInstanceId: string
): Promise<string | null> {
  const inst = await fetchApiManagerInstance(
    baseUrl,
    accessToken,
    orgId,
    envId,
    apiInstanceId
  );
  if (!inst) return null;
  const origin = pickPublicIngressOriginFromApiManagerInstance(inst);
  debugLog("[BROKER-URL] RM public ingress origin:", origin ?? "(none)");
  return origin;
}

function endpointUriFromExchangeInstances(
  instances: ExchangeAssetInstance[] | undefined,
  envId: string,
  apiInstanceId: string
): string | null {
  if (!instances?.length) return null;
  const byInstance = instances.find((instance) => String(instance.id) === apiInstanceId);
  const byEnv = instances.find((instance) => instance.environmentId === envId);
  const candidate = byInstance?.endpointUri ?? byEnv?.endpointUri;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function extractUrlFromCardPayload(card: unknown): string | null {
  if (!card || typeof card !== "object" || Array.isArray(card)) return null;
  const record = card as Record<string, unknown>;
  const direct = record.url;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const endpoint = record.endpoint;
  if (typeof endpoint === "string" && endpoint.trim()) return endpoint.trim();
  if (endpoint && typeof endpoint === "object" && !Array.isArray(endpoint)) {
    const nestedUrl = (endpoint as Record<string, unknown>).url;
    if (typeof nestedUrl === "string" && nestedUrl.trim()) return nestedUrl.trim();
  }

  return null;
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

    const cardFile = files.find(isA2aCardFile);

    if (!cardFile) {
      return NextResponse.json({ url: null, reason: "no_a2a_card" });
    }
    debugLog(
      "[BROKER-URL] Selected card file:",
      `${cardFile.classifier}.${cardFile.packaging}`
    );

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
    let card: unknown = {};
    try {
      card = JSON.parse(text) as unknown;
    } catch {
      const match = /^url:\s*["']?([^\s"'\n]+)/m.exec(text);
      if (match) card = { url: match[1] };
    }

    let brokerUrl = extractUrlFromCardPayload(card);
    debugLog("[BROKER-URL] Raw card URL for", assetId, "→", brokerUrl ?? "(none)");

    // V2 broker cards (`a2a-v1-card`) often omit `url`; resolve from deployment metadata.
    if (!brokerUrl && envId && apiInstanceId) {
      brokerUrl = endpointUriFromExchangeInstances(asset.instances, envId, apiInstanceId);
      if (brokerUrl) {
        debugLog("[BROKER-URL] Exchange instance endpointUri →", brokerUrl);
      } else {
        const inst = await fetchApiManagerInstance(
          baseUrl,
          accessToken,
          orgId,
          envId,
          apiInstanceId
        );
        brokerUrl = inst ? pickPublicEndpointUriFromApiManagerInstance(inst) : null;
        debugLog("[BROKER-URL] API Manager endpointUri →", brokerUrl ?? "(none)");
      }
    }

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

    if (!brokerUrl) {
      return NextResponse.json({
        url: null,
        reason: "no_broker_url",
        message:
          "The Exchange A2A card did not include a URL. Select org/env and a deployed broker instance so we can read endpointUri from API Manager.",
      });
    }

    const protocolVersion =
      extractProtocolVersionFromCardPayload(card) ??
      inferA2AVersionFromCardClassifier(cardFile.classifier) ??
      "0.3";

    return NextResponse.json({ url: brokerUrl, protocolVersion });
  } catch (err) {
    debugError("[BROKER-URL] Error:", err);
    return NextResponse.json({ error: "Failed to resolve broker URL", url: null }, { status: 500 });
  }
}
