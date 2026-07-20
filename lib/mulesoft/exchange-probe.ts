import { parseGavFromMetadataSource } from "@/lib/mulesoft/parse-gav";

/**
 * Exploratory-only shape sniffing for probe responses. Unlike
 * `lib/mulesoft/exchange-search.ts` (which targets the confirmed real
 * pseas/ang endpoints), this probe intentionally still hits unconfirmed/
 * undocumented URL shapes to map out what does and doesn't exist.
 */
interface ProbeListHit {
  groupId: string;
  assetId: string;
  name?: string;
  version?: string;
  type?: string;
}

function normalizeExchangeList(body: unknown): ProbeListHit[] {
  const isHit = (item: unknown): item is ProbeListHit => {
    if (!item || typeof item !== "object") return false;
    const o = item as Record<string, unknown>;
    return typeof o.groupId === "string" && typeof o.assetId === "string";
  };
  if (Array.isArray(body)) return body.filter(isHit);
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o.value)) return o.value.filter(isHit);
    if (Array.isArray(o.items)) return o.items.filter(isHit);
    if (Array.isArray(o.hits)) return o.hits.filter(isHit);
  }
  return [];
}

export interface ExchangeProbeResult {
  label: string;
  url: string;
  ok: boolean;
  status: number;
  hitCount?: number;
  sample?: unknown;
  error?: string;
}

export interface ExchangeAssetCandidate {
  label: string;
  groupId: string;
  assetId: string;
  version?: string;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function summarizeJsonBody(body: unknown, maxItems = 5): unknown {
  if (Array.isArray(body)) {
    return {
      count: body.length,
      items: body.slice(0, maxItems).map((item) => {
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          return {
            groupId: o.groupId,
            assetId: o.assetId,
            version: o.version,
            name: o.name,
            type: o.type,
          };
        }
        return item;
      }),
    };
  }
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const versions = o.versions;
    if (Array.isArray(versions)) {
      return {
        name: o.name,
        type: o.type,
        groupId: o.groupId,
        assetId: o.assetId,
        versionCount: versions.length,
        versions: versions.slice(0, maxItems).map((v) => {
          if (v && typeof v === "object") {
            const vv = v as Record<string, unknown>;
            return { version: vv.version, status: vv.status };
          }
          return v;
        }),
        fileClassifiers: Array.isArray(o.files)
          ? (o.files as Array<{ classifier?: string; packaging?: string }>)
              .slice(0, 8)
              .map((f) => `${f.classifier ?? "?"}.${f.packaging ?? "?"}`)
          : undefined,
      };
    }
    return {
      name: o.name,
      type: o.type,
      groupId: o.groupId,
      assetId: o.assetId,
      version: o.version,
      keys: Object.keys(o).slice(0, 20),
    };
  }
  return body;
}

async function probeGet(
  label: string,
  url: string,
  fetchFn: FetchFn,
  authHeader: Record<string, string>
): Promise<ExchangeProbeResult> {
  try {
    const res = await fetchFn(url, { headers: authHeader });
    const text = await res.text();
    if (!res.ok) {
      return {
        label,
        url,
        ok: false,
        status: res.status,
        error: text.slice(0, 300),
      };
    }
    let body: unknown = text;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text.slice(0, 200);
    }
    const listHits = normalizeExchangeList(body);
    const sample =
      listHits.length > 0
        ? { count: listHits.length, items: listHits.slice(0, 5) }
        : summarizeJsonBody(body);
    const hitCount = listHits.length > 0 ? listHits.length : undefined;
    return { label, url, ok: true, status: res.status, hitCount, sample };
  } catch (e) {
    return {
      label,
      url,
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function mavenBaseFromControlPlane(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  const map: Record<string, string> = {
    "https://anypoint.mulesoft.com": "https://maven.anypoint.mulesoft.com",
    "https://eu1.anypoint.mulesoft.com": "https://maven.eu1.anypoint.mulesoft.com",
    "https://ca1.platform.mulesoft.com": "https://maven.ca1.platform.mulesoft.com",
    "https://jp1.platform.mulesoft.com": "https://maven.jp1.platform.mulesoft.com",
  };
  return map[normalized] ?? "https://maven.anypoint.mulesoft.com";
}

export function buildExchangeAssetCandidates(input: {
  orgId: string;
  brokerAssetId?: string;
  metadataSource?: string | null;
  extraAssetIds?: string[];
}): ExchangeAssetCandidate[] {
  const out: ExchangeAssetCandidate[] = [];
  const seen = new Set<string>();

  const add = (label: string, groupId: string, assetId: string, version?: string) => {
    const key = `${groupId}:${assetId}:${version ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, groupId, assetId, version });
  };

  const gav = parseGavFromMetadataSource(input.metadataSource);
  if (gav) {
    add("metadata.source GAV", gav.groupId, gav.assetId, gav.version);
  }

  if (input.brokerAssetId) {
    add("broker assetId (API Manager)", input.orgId, input.brokerAssetId);
    if (gav?.version) {
      add("broker assetId + metadata version", input.orgId, input.brokerAssetId, gav.version);
    }
  }

  for (const assetId of input.extraAssetIds ?? []) {
    add(`extra:${assetId}`, input.orgId, assetId, gav?.version);
  }

  return out;
}

export async function runExchangeProbes(input: {
  baseUrl: string;
  orgId: string;
  accessToken: string;
  brokerAssetId?: string;
  metadataSource?: string | null;
  fetchFn?: FetchFn;
}): Promise<{
  candidates: ExchangeAssetCandidate[];
  v2AssetLookups: ExchangeProbeResult[];
  v2Searches: ExchangeProbeResult[];
  mavenProbes: ExchangeProbeResult[];
  notes: string[];
}> {
  const fetchFn = input.fetchFn ?? fetch;
  const authHeader = {
    Authorization: `Bearer ${input.accessToken}`,
    "Content-Type": "application/json",
  };
  const enc = encodeURIComponent;
  const notes: string[] = [
    "Exchange v2 path segment is groupId (owner org UUID or Maven group), not necessarily the signed-in org.",
    "metadata.source GAV assetId is often the deployed Maven app name — it may exist only on the Maven facade, not in the Exchange catalog.",
    "Ground truth from mulesoft-mcp-server (MuleSoft's own MCP server source): real search is POST /exchange/api/v2/pseas/_search (primary) falling back to GET /exchange/api/v2/ang/_search — not /assets/search and not /assets?organizationId=.... 'agent-network' is a real, distinct search type (maps to AgentNetworkAsset), not a phantom value; 'agent' (AgentAsset) is a different, separate type.",
    "GET /assets/{groupId}/{assetId} (no version) does not exist — only DELETE/PATCH. Use POST /graph/api/v2/graphql asset(...).otherVersions (confirmed via anypoint-cli-agent-fabric-plugin) or GET /assets/{groupId}/{assetId}/{version} (documented, real) instead.",
  ];

  const candidates = buildExchangeAssetCandidates({
    orgId: input.orgId,
    brokerAssetId: input.brokerAssetId,
    metadataSource: input.metadataSource,
  });

  const v2AssetLookups: ExchangeProbeResult[] = [];
  for (const c of candidates) {
    const listUrl = `${input.baseUrl}/exchange/api/v2/assets/${enc(c.groupId)}/${enc(c.assetId)}`;
    v2AssetLookups.push(
      await probeGet(`v2 versions: ${c.label}`, listUrl, fetchFn, authHeader)
    );

    if (c.version) {
      const detailUrl = `${input.baseUrl}/exchange/api/v2/assets/${enc(c.groupId)}/${enc(c.assetId)}/${enc(c.version)}`;
      v2AssetLookups.push(
        await probeGet(`v2 detail: ${c.label}@${c.version}`, detailUrl, fetchFn, authHeader)
      );

      const metaUrl = `${detailUrl}/agent/metadata`;
      v2AssetLookups.push(
        await probeGet(`v2 agent/metadata: ${c.label}@${c.version}`, metaUrl, fetchFn, authHeader)
      );
    }
  }

  const searchTerm = input.brokerAssetId ?? candidates[0]?.assetId ?? "";
  const v2Searches: ExchangeProbeResult[] = [];
  if (searchTerm) {
    const searchVariants: Array<{ label: string; query: string }> = [
      {
        label: "documented: rootOrganizationId + types=agent",
        query: `rootOrganizationId=${enc(input.orgId)}&types=agent&search=${enc(searchTerm)}&limit=10`,
      },
      {
        label: "documented: rootOrganizationId + types=mcp,agent",
        query: `rootOrganizationId=${enc(input.orgId)}&types=mcp,agent&search=${enc(searchTerm)}&limit=10`,
      },
      {
        label: "observed UI: organizationId + type=agent-network",
        query: `organizationId=${enc(input.orgId)}&type=agent-network&search=${enc(searchTerm)}&limit=10`,
      },
      {
        label: "observed UI: organizationId + type=agent",
        query: `organizationId=${enc(input.orgId)}&type=agent&search=${enc(searchTerm)}&limit=10`,
      },
      {
        label: "no type filter: organizationId + search",
        query: `organizationId=${enc(input.orgId)}&search=${enc(searchTerm)}&limit=10`,
      },
    ];

    for (const variant of searchVariants) {
      const url = `${input.baseUrl}/exchange/api/v2/assets?${variant.query}`;
      const result = await probeGet(`v2 search ${variant.label}`, url, fetchFn, authHeader);
      if (result.ok && result.sample && typeof result.sample === "object") {
        const s = result.sample as { count?: number };
        if (typeof s.count === "number") result.hitCount = s.count;
      }
      v2Searches.push(result);
    }

    for (const t of ["agent-network", "app"] as const) {
      const url = `${input.baseUrl}/exchange/api/v2/assets?organizationId=${enc(input.orgId)}&type=${enc(t)}&search=${enc(searchTerm)}&limit=5`;
      v2Searches.push(await probeGet(`v2 search type=${t}`, url, fetchFn, authHeader));
    }

    for (const t of ["agent", "mcp", "custom"] as const) {
      const url = `${input.baseUrl}/exchange/api/v2/assets?rootOrganizationId=${enc(input.orgId)}&types=${t}&search=${enc(searchTerm)}&limit=5`;
      v2Searches.push(await probeGet(`v2 search types=${t}`, url, fetchFn, authHeader));
    }

    // Ground truth (from mulesoft-mcp-server's own search_asset implementation):
    // Exchange's real search backend is pseas/_search (primary) with ang/_search
    // as fallback — not /assets?... at all. Probe both directly for comparison.
    try {
      const pseasRes = await fetchFn(`${input.baseUrl}/exchange/api/v2/pseas/_search`, {
        method: "POST",
        headers: authHeader,
        body: JSON.stringify({ size: 15, organizationId: [input.orgId], search: searchTerm, types: ["agent-network"] }),
      });
      const pseasText = await pseasRes.text();
      let pseasBody: unknown = pseasText;
      try {
        pseasBody = JSON.parse(pseasText);
      } catch {
        pseasBody = pseasText.slice(0, 200);
      }
      const pseasHits = Array.isArray((pseasBody as { hits?: unknown[] })?.hits)
        ? (pseasBody as { hits: unknown[] }).hits
        : [];
      v2Searches.push({
        label: "real: pseas/_search types=agent-network",
        url: `${input.baseUrl}/exchange/api/v2/pseas/_search`,
        ok: pseasRes.ok,
        status: pseasRes.status,
        hitCount: pseasRes.ok ? pseasHits.length : undefined,
        sample: pseasRes.ok ? pseasHits.slice(0, 5) : pseasBody,
      });
    } catch (e) {
      v2Searches.push({
        label: "real: pseas/_search types=agent-network",
        url: `${input.baseUrl}/exchange/api/v2/pseas/_search`,
        ok: false,
        status: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const angUrl = `${input.baseUrl}/exchange/api/v2/ang/_search?q=${enc(searchTerm)}&_size=15&assets.@type=http://anypoint.com/vocabs/digital-repository%23AgentNetworkAsset&k:assets.AssetNode.organizationId=${enc(input.orgId)}`;
    v2Searches.push(await probeGet("real: ang/_search types=agent-network", angUrl, fetchFn, authHeader));
  }

  const mavenProbes: ExchangeProbeResult[] = [];
  const mavenBase = mavenBaseFromControlPlane(input.baseUrl);
  for (const c of candidates.filter((x) => x.version)) {
    const zipName = `${c.assetId}-${c.version}-agent-network.zip`;
    const url = `${mavenBase}/api/v1/organizations/${enc(input.orgId)}/maven/${enc(c.groupId)}/${enc(c.assetId)}/${enc(c.version!)}/${zipName}`;
    mavenProbes.push(await probeGet(`maven zip: ${c.label}`, url, fetchFn, authHeader));
  }

  return { candidates, v2AssetLookups, v2Searches, mavenProbes, notes };
}
