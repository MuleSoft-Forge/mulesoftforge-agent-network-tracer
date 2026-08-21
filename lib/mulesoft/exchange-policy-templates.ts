/**
 * Exchange policy catalog via API Portal XAPI — the same source API Manager uses
 * when browsing "Add policy" (getExchangePolicyTemplates).
 *
 * Prefer this over Exchange pseas/ang asset search: returns OOTB + org custom
 * templates, supports inbound/outbound injection_point filtering, and includes
 * Exchange GAV coordinates required to apply policies.
 *
 * @see https://dev-portal.mulesoft.com/apis/api-portal-xapi/api.yaml
 */

export type PolicyInjectionPoint = "inbound" | "outbound";

export type PolicyProvider = "mulesoft" | "organization";

/** Normalized policy template row for Composer UI and API responses. */
export interface ExchangePolicyTemplate {
  groupId: string;
  assetId: string;
  name: string;
  version: string | null;
  description?: string;
  category?: string;
  /** From capabilities.assetTypes; empty means applies to all asset kinds. */
  assetTypes: string[];
  provider: PolicyProvider;
  injectionPoint: PolicyInjectionPoint;
}

export interface FetchExchangePolicyTemplatesOptions {
  organizationId: string;
  injectionPoint?: PolicyInjectionPoint;
  latest?: boolean;
  includeConfiguration?: boolean;
  splitModel?: boolean;
  automatedOnly?: boolean;
}

interface RawExchangePolicyTemplate {
  groupId?: string;
  assetId?: string;
  assetVersion?: string;
  version?: string;
  name?: string;
  description?: string;
  type?: string;
  category?: string;
  isOotb?: boolean;
  is_ootb?: boolean;
  capabilities?: {
    assetTypes?: string[];
  };
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function providerFromTemplate(raw: RawExchangePolicyTemplate): PolicyProvider {
  if (raw.type === "system" || raw.isOotb === true || raw.is_ootb === true) {
    return "mulesoft";
  }
  return "organization";
}

function normalizeTemplate(
  raw: RawExchangePolicyTemplate,
  injectionPoint: PolicyInjectionPoint
): ExchangePolicyTemplate | null {
  const groupId = raw.groupId;
  const assetId = raw.assetId;
  if (!groupId || !assetId) return null;
  const version = raw.assetVersion ?? raw.version ?? null;
  const assetTypes = raw.capabilities?.assetTypes ?? [];
  return {
    groupId,
    assetId,
    name: raw.name ?? assetId,
    version,
    ...(raw.description ? { description: raw.description } : {}),
    ...(raw.category ? { category: raw.category } : {}),
    assetTypes,
    provider: providerFromTemplate(raw),
    injectionPoint,
  };
}

function dedupeTemplates(templates: ExchangePolicyTemplate[]): ExchangePolicyTemplate[] {
  const byKey = new Map<string, ExchangePolicyTemplate>();
  for (const t of templates) {
    const key = `${t.injectionPoint}:${t.groupId}:${t.assetId}`;
    if (!byKey.has(key)) byKey.set(key, t);
  }
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function parseTemplatesResponse(body: unknown, injectionPoint: PolicyInjectionPoint): ExchangePolicyTemplate[] {
  const rows = Array.isArray(body) ? body : [];
  return dedupeTemplates(
    rows
      .map((row) => normalizeTemplate(row as RawExchangePolicyTemplate, injectionPoint))
      .filter((t): t is ExchangePolicyTemplate => Boolean(t))
  );
}

/**
 * List policy templates from Exchange for an organization, filtered by
 * injection point. Composer further narrows by asset kind via assetTypes.
 */
export async function fetchExchangePolicyTemplates(
  baseUrl: string,
  accessToken: string,
  options: FetchExchangePolicyTemplatesOptions,
  fetchFn: FetchFn = fetch
): Promise<ExchangePolicyTemplate[]> {
  const {
    organizationId,
    injectionPoint,
    latest = true,
    includeConfiguration = false,
    splitModel = true,
    automatedOnly = false,
  } = options;

  const params = new URLSearchParams();
  if (injectionPoint) params.set("injectionPoint", injectionPoint);
  params.set("latest", latest ? "true" : "false");
  params.set("includeConfiguration", includeConfiguration ? "true" : "false");
  params.set("splitModel", splitModel ? "true" : "false");
  params.set("automatedOnly", automatedOnly ? "true" : "false");

  const qs = params.toString();
  const url = `${baseUrl}/apimanager/xapi/v1/organizations/${encodeURIComponent(organizationId)}/exchange-policy-templates${qs ? `?${qs}` : ""}`;

  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Exchange policy templates failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }

  const body = (await res.json()) as unknown;
  const point: PolicyInjectionPoint = injectionPoint ?? "inbound";
  return parseTemplatesResponse(body, point);
}

export interface ExchangePolicyCatalog {
  inbound: ExchangePolicyTemplate[];
  outbound: ExchangePolicyTemplate[];
}

/** Fetch inbound and outbound catalogs in parallel. */
export async function fetchExchangePolicyCatalog(
  baseUrl: string,
  accessToken: string,
  options: Omit<FetchExchangePolicyTemplatesOptions, "injectionPoint">,
  fetchFn: FetchFn = fetch
): Promise<ExchangePolicyCatalog> {
  const base = { ...options };
  const [inbound, outbound] = await Promise.all([
    fetchExchangePolicyTemplates(baseUrl, accessToken, { ...base, injectionPoint: "inbound" }, fetchFn),
    fetchExchangePolicyTemplates(baseUrl, accessToken, { ...base, injectionPoint: "outbound" }, fetchFn),
  ]);
  return { inbound, outbound };
}

export interface ExchangePolicyTemplateDetail {
  groupId: string;
  assetId: string;
  name: string;
  version: string | null;
  description?: string;
  category?: string;
  /** JSON Schema for context.policies.*.configuration */
  configurationSchema: Record<string, unknown> | null;
}

/** Fetch one policy template including configuration JSON Schema. */
export async function fetchExchangePolicyTemplate(
  baseUrl: string,
  accessToken: string,
  organizationId: string,
  groupId: string,
  assetId: string,
  version: string,
  fetchFn: FetchFn = fetch
): Promise<ExchangePolicyTemplateDetail> {
  const params = new URLSearchParams({
    includeAllVersions: "false",
    splitModel: "true",
  });
  const url = `${baseUrl}/apimanager/xapi/v1/organizations/${encodeURIComponent(organizationId)}/exchange-policy-templates/${encodeURIComponent(groupId)}/${encodeURIComponent(assetId)}/${encodeURIComponent(version)}?${params.toString()}`;

  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Exchange policy template failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }

  const raw = (await res.json()) as RawExchangePolicyTemplate & {
    configuration?: Record<string, unknown>;
  };
  const resolvedVersion = raw.assetVersion ?? raw.version ?? version;
  const configuration = raw.configuration;
  return {
    groupId: raw.groupId ?? groupId,
    assetId: raw.assetId ?? assetId,
    name: raw.name ?? assetId,
    version: resolvedVersion ?? null,
    ...(raw.description ? { description: raw.description } : {}),
    ...(raw.category ? { category: raw.category } : {}),
    configurationSchema:
      configuration && typeof configuration === "object" ? configuration : null,
  };
}
