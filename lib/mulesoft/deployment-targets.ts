export type RuntimeTargetKind = "shared" | "private";

export interface DeploymentTarget {
  id: string;
  name: string;
  kind: RuntimeTargetKind;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** CloudHub 2.0 shared regional spaces use the Cloudhub-* prefix in Runtime Manager. */
export function classifyDeploymentTargetName(name: string): RuntimeTargetKind {
  return name.startsWith("Cloudhub-") ? "shared" : "private";
}

function readTargetName(item: Record<string, unknown>): string | null {
  for (const key of ["name", "targetName", "label", "displayName"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readTargetId(item: Record<string, unknown>, name: string): string {
  for (const key of ["id", "targetId", "uuid"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return name;
}

/** Normalize deployment target list responses into { id, name, kind }. */
export function parseDeploymentTargetsResponse(body: unknown): DeploymentTarget[] {
  const root = asRecord(body);
  const candidates: unknown[] = [];

  if (Array.isArray(body)) candidates.push(body);
  if (root) {
    for (const key of ["data", "content", "items", "targets", "deploymentTargets"]) {
      const value = root[key];
      if (Array.isArray(value)) candidates.push(value);
    }
  }

  const list = candidates.find(Array.isArray) as unknown[] | undefined;
  if (!list) return [];

  const seen = new Set<string>();
  const out: DeploymentTarget[] = [];
  for (const entry of list) {
    const item = asRecord(entry);
    if (!item) continue;
    const name = readTargetName(item);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      id: readTargetId(item, name),
      name,
      kind: classifyDeploymentTargetName(name),
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchDeploymentTargets(
  baseUrl: string,
  orgId: string,
  envId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch
): Promise<DeploymentTarget[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  const urls = [
    `${baseUrl}/proxies/xapi/v1/organizations/${encodeURIComponent(orgId)}/providers/MC/runtime-fabric-deployment-targets?environmentId=${encodeURIComponent(envId)}`,
    `${baseUrl}/runtimefabric/api/organizations/${encodeURIComponent(orgId)}/targets`,
  ];

  for (const url of urls) {
    try {
      const res = await fetchFn(url, { headers });
      if (!res.ok) continue;
      const parsed = parseDeploymentTargetsResponse(await res.json());
      if (parsed.length > 0) return parsed;
    } catch {
      // try next source
    }
  }

  return [];
}

export function filterDeploymentTargets(
  targets: DeploymentTarget[],
  kind: RuntimeTargetKind
): DeploymentTarget[] {
  return targets.filter((t) => t.kind === kind);
}

export function pickDeploymentTargetDefault(
  current: string | undefined,
  targets: DeploymentTarget[],
  kind: RuntimeTargetKind
): string {
  const names = filterDeploymentTargets(targets, kind).map((t) => t.name);
  if (current && names.includes(current)) return current;
  return names[0] ?? current ?? "";
}
