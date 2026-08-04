export interface ManagedGateway {
  id: string;
  name: string;
  status?: string;
  /** When present, the CloudHub 2.0 shared/private space this gateway belongs to. */
  derivedTargetSpace?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readGatewayName(item: Record<string, unknown>): string | null {
  if (typeof item.name === "string" && item.name.trim()) return item.name.trim();
  if (typeof item.gatewayName === "string" && item.gatewayName.trim()) return item.gatewayName.trim();
  return null;
}

function readGatewayId(item: Record<string, unknown>, name: string): string {
  if (typeof item.id === "string" && item.id.trim()) return item.id.trim();
  if (typeof item.gatewayId === "string" && item.gatewayId.trim()) return item.gatewayId.trim();
  return name;
}

function readNestedName(value: unknown): string | null {
  const obj = asRecord(value);
  if (!obj) return null;
  for (const key of ["name", "targetName", "label"]) {
    const nested = obj[key];
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return null;
}

/** Best-effort parse of the runtime target space associated with a gateway. */
function readDerivedTargetSpace(item: Record<string, unknown>): string | undefined {
  for (const key of [
    "targetName",
    "derivedTargetSpace",
    "targetSpace",
    "deploymentTarget",
    "runtimeTarget",
    "spaceName",
    "privateSpaceName",
    "sharedSpaceName",
  ]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    const nested = readNestedName(value);
    if (nested) return nested;
  }
  const target = asRecord(item.target);
  const fromTarget = target ? readNestedName(target) ?? (typeof target.targetSpace === "string" ? target.targetSpace.trim() : null) : null;
  return fromTarget || undefined;
}

/** Normalize Gateway Manager list response shapes into { id, name }. */
export function parseManagedGatewaysResponse(body: unknown): ManagedGateway[] {
  const root = asRecord(body);
  const candidates: unknown[] = [];

  if (Array.isArray(body)) candidates.push(body);
  if (root) {
    for (const key of ["data", "content", "items", "gateways", "managedGateways"]) {
      const value = root[key];
      if (Array.isArray(value)) candidates.push(value);
    }
  }

  const list = candidates.find(Array.isArray) as unknown[] | undefined;
  if (!list) return [];

  const seen = new Set<string>();
  const out: ManagedGateway[] = [];
  for (const entry of list) {
    const item = asRecord(entry);
    if (!item) continue;
    const name = readGatewayName(item);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      id: readGatewayId(item, name),
      name,
      status: typeof item.status === "string" ? item.status : undefined,
      derivedTargetSpace: readDerivedTargetSpace(item),
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function gatewayDescriptionUrl(
  baseUrl: string,
  orgId: string,
  envId: string,
  gatewayId: string
): string {
  return (
    `${baseUrl}/gatewaymanager/api/v1/organizations/${encodeURIComponent(orgId)}` +
    `/environments/${encodeURIComponent(envId)}/gateways/${encodeURIComponent(gatewayId)}`
  );
}

/** Parse target space from a gateway detail response (matches CLI getGatewayDescription). */
export function parseGatewayTargetName(body: unknown): string | undefined {
  const item = asRecord(body);
  return item ? readDerivedTargetSpace(item) : undefined;
}

/** Fetch gateway detail when the list response omits targetName (same lookup the CLI uses). */
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function enrichManagedGatewaysWithTargetSpaces(
  baseUrl: string,
  orgId: string,
  envId: string,
  gateways: ManagedGateway[],
  accessToken: string,
  fetchFn: FetchLike = fetch
): Promise<ManagedGateway[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  return Promise.all(
    gateways.map(async (gw) => {
      if (gw.derivedTargetSpace) return gw;
      try {
        const res = await fetchFn(gatewayDescriptionUrl(baseUrl, orgId, envId, gw.id), {
          headers,
        });
        if (!res.ok) return gw;
        const derivedTargetSpace = parseGatewayTargetName(await res.json());
        return derivedTargetSpace ? { ...gw, derivedTargetSpace } : gw;
      } catch {
        return gw;
      }
    })
  );
}

export async function fetchManagedGateways(
  baseUrl: string,
  orgId: string,
  envId: string,
  accessToken: string,
  fetchFn: FetchLike = fetch
): Promise<ManagedGateway[]> {
  const url =
    `${baseUrl}/gatewaymanager/api/v1/organizations/${encodeURIComponent(orgId)}` +
    `/environments/${encodeURIComponent(envId)}/gateways?pageSize=100`;

  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gateways failed: ${res.status} ${text}`);
  }

  const parsed = parseManagedGatewaysResponse(await res.json());
  return enrichManagedGatewaysWithTargetSpaces(
    baseUrl,
    orgId,
    envId,
    parsed,
    accessToken,
    fetchFn
  );
}
