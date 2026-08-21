import { parseGavFromMetadataSource, type Gav } from "@/lib/mulesoft/parse-gav";

/** An API Manager instance whose deploy metadata traces back to an agent-network GAV. */
export interface AgenticApiInstance {
  id: string;
  assetId: string;
  name?: string;
}

/** An approved (i.e. active) contract that would block removal of its API instance. */
export interface ActiveContractSummary {
  contractId: string;
  apiInstanceId: string;
  apiInstanceName?: string;
  applicationId?: string;
  applicationName?: string;
  approvedDate?: string | null;
}

interface ApiManagerInstanceRaw {
  id?: number | string;
  assetId?: string;
  instanceLabel?: string | null;
  metadata?: { source?: string } | null;
  apiAsset?: { assetId?: string | null; name?: string | null } | null;
}

interface ApiManagerAssetRaw {
  assetId?: string;
  apis?: ApiManagerInstanceRaw[];
}

interface ApiManagerListResponse {
  total?: number;
  assets?: ApiManagerAssetRaw[];
  instances?: ApiManagerInstanceRaw[];
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const PAGE_SIZE = 500;
const MAX_OFFSET_GUARD = 10_000;

function flattenPage(body: ApiManagerListResponse): ApiManagerInstanceRaw[] {
  const flat: ApiManagerInstanceRaw[] = [];
  if (Array.isArray(body.assets)) {
    for (const asset of body.assets) {
      for (const inst of asset.apis ?? []) {
        flat.push({ ...inst, assetId: inst.assetId ?? asset.assetId });
      }
    }
  }
  if (Array.isArray(body.instances)) flat.push(...body.instances);
  return flat;
}

/**
 * Paginate `/apimanager/api/v1/.../apis`, optionally scoped to `family=agentic`.
 * Deliberately independent from the similar listing in
 * `app/api/brokers-in-environment/route.ts` — that route needs to inner-join
 * against the fabric graph, this one only needs metadata.source, so sharing a
 * helper would couple two API routes for little benefit.
 */
async function listAllApiManagerInstances(
  baseUrl: string,
  orgId: string,
  envId: string,
  authHeader: string,
  family: "agentic" | undefined,
  fetchFn: FetchLike
): Promise<ApiManagerInstanceRaw[]> {
  const results: ApiManagerInstanceRaw[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url =
      `${baseUrl}/apimanager/api/v1/organizations/${encodeURIComponent(orgId)}` +
      `/environments/${encodeURIComponent(envId)}/apis` +
      `?${family ? `family=${family}&` : ""}fullInfo=true&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetchFn(url, { headers: { Authorization: authHeader } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API Manager list failed: ${res.status} ${text}`);
    }
    const body = (await res.json()) as ApiManagerListResponse;
    const page = flattenPage(body);
    results.push(...page);
    if (page.length < PAGE_SIZE) break;
    if (typeof body.total === "number" && results.length >= body.total) break;
    if (offset > MAX_OFFSET_GUARD) break;
  }
  return results;
}

/**
 * API Manager instances deployed from the given agent-network GAV. A network
 * can register more than one instance — one per broker/agent that exposes an
 * A2A endpoint — so undeploy needs to check contracts on all of them, not
 * just an instance matching the network's own asset id.
 */
export async function listInstancesForGav(
  baseUrl: string,
  orgId: string,
  envId: string,
  gav: Gav,
  authHeader: string,
  fetchFn: FetchLike = fetch
): Promise<AgenticApiInstance[]> {
  const matches = (instances: ApiManagerInstanceRaw[]) =>
    instances.filter((inst) => {
      const parsed = parseGavFromMetadataSource(inst.metadata?.source);
      return (
        parsed &&
        parsed.groupId === gav.groupId &&
        parsed.assetId === gav.assetId &&
        parsed.version === gav.version
      );
    });

  let instances = await listAllApiManagerInstances(baseUrl, orgId, envId, authHeader, "agentic", fetchFn);
  let matched = matches(instances);
  if (matched.length === 0) {
    // Some tenants return nothing for family=agentic; retry unfiltered before
    // concluding there is nothing deployed, matching brokers-in-environment.
    instances = await listAllApiManagerInstances(baseUrl, orgId, envId, authHeader, undefined, fetchFn);
    matched = matches(instances);
  }

  return matched
    .filter((inst) => inst.id != null)
    .map((inst) => ({
      id: String(inst.id),
      assetId: inst.assetId ?? inst.apiAsset?.assetId ?? "",
      name: inst.instanceLabel ?? inst.apiAsset?.name ?? inst.assetId ?? undefined,
    }));
}

interface ContractRaw {
  id?: number | string;
  status?: string;
  approvedDate?: string | null;
  applicationId?: number | string;
  application?: { id?: number | string; name?: string | null } | null;
}

interface ContractListResponse {
  contracts?: ContractRaw[];
}

/** Contracts still granting access (status APPROVED) — these are what block undeploy. */
async function listApprovedContractsForInstance(
  baseUrl: string,
  orgId: string,
  envId: string,
  instance: AgenticApiInstance,
  authHeader: string,
  fetchFn: FetchLike
): Promise<ActiveContractSummary[]> {
  const url =
    `${baseUrl}/apimanager/api/v1/organizations/${encodeURIComponent(orgId)}` +
    `/environments/${encodeURIComponent(envId)}/apis/${encodeURIComponent(instance.id)}/contracts?limit=200`;
  const res = await fetchFn(url, { headers: { Authorization: authHeader } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Contracts lookup failed for API instance ${instance.id}: ${res.status} ${text}`);
  }
  const body = (await res.json()) as ContractListResponse;
  return (body.contracts ?? [])
    .filter((c) => String(c.status ?? "").toUpperCase() === "APPROVED")
    .map((c) => ({
      contractId: String(c.id ?? ""),
      apiInstanceId: instance.id,
      apiInstanceName: instance.name,
      applicationId:
        c.applicationId != null
          ? String(c.applicationId)
          : c.application?.id != null
            ? String(c.application.id)
            : undefined,
      applicationName: c.application?.name ?? undefined,
      approvedDate: c.approvedDate ?? null,
    }))
    .filter((c) => c.contractId);
}

/**
 * Active (APPROVED) contracts across every API instance deployed from the
 * given agent-network GAV. Best-effort across instances: if some instances
 * fail to answer (e.g. a scope gap) but others succeed, the successful ones
 * are still reported rather than losing the whole check.
 */
export async function listActiveContractsForGav(
  baseUrl: string,
  orgId: string,
  envId: string,
  gav: Gav,
  authHeader: string,
  fetchFn: FetchLike = fetch
): Promise<ActiveContractSummary[]> {
  const instances = await listInstancesForGav(baseUrl, orgId, envId, gav, authHeader, fetchFn);
  if (instances.length === 0) return [];

  const outcomes = await Promise.allSettled(
    instances.map((instance) =>
      listApprovedContractsForInstance(baseUrl, orgId, envId, instance, authHeader, fetchFn)
    )
  );
  const succeeded = outcomes.filter(
    (o): o is PromiseFulfilledResult<ActiveContractSummary[]> => o.status === "fulfilled"
  );
  if (succeeded.length === 0) {
    const failed = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
    throw failed?.reason instanceof Error ? failed.reason : new Error("Contract lookup failed");
  }
  return succeeded.flatMap((o) => o.value);
}

/**
 * Revoke a contract (PATCH status → REVOKED). This blocks the application's
 * access without deleting the contract record — matching what the API
 * Manager UI's "Revoke" action does, and what Anypoint requires before an
 * API instance with that contract can be removed.
 */
export async function revokeContract(
  baseUrl: string,
  orgId: string,
  envId: string,
  apiInstanceId: string,
  contractId: string,
  authHeader: string,
  fetchFn: FetchLike = fetch
): Promise<void> {
  const url =
    `${baseUrl}/apimanager/api/v1/organizations/${encodeURIComponent(orgId)}` +
    `/environments/${encodeURIComponent(envId)}/apis/${encodeURIComponent(apiInstanceId)}` +
    `/contracts/${encodeURIComponent(contractId)}`;
  const res = await fetchFn(url, {
    method: "PATCH",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "REVOKED" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Revoke failed (${res.status}). ${text}`.trim());
  }
}
