import type { ConnectionAccess, ConnectionPolicies, ConnectionPolicyItem } from "@/lib/composer/connectivity/types";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parsePolicyBindingItem(raw: unknown): ConnectionPolicyItem | undefined {
  const item = asRecord(raw);
  if (!item) return undefined;

  const ref = asRecord(item.ref);
  if (ref) {
    const name = asString(ref.name);
    if (!name) return undefined;
    const namespace = asString(ref.namespace);
    return namespace ? { mode: "ref", name, namespace } : { mode: "ref", name };
  }

  if (item.policy !== undefined) {
    return { mode: "inline", document: item };
  }

  return undefined;
}

function parsePolicyBindings(raw: unknown): ConnectionPolicyItem[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const items = raw.map(parsePolicyBindingItem).filter((x): x is ConnectionPolicyItem => Boolean(x));
  return items.length > 0 ? items : undefined;
}

export function parseConnectionAccess(raw: unknown): ConnectionAccess | undefined {
  if (raw === "shared") return "shared";
  if (raw === "internal") return "internal";
  return undefined;
}

export function parseConnectionPolicies(raw: unknown): ConnectionPolicies | undefined {
  const obj = asRecord(raw);
  if (!obj) return undefined;
  const inbound = parsePolicyBindings(obj.inbound);
  const outbound = parsePolicyBindings(obj.outbound);
  if (!inbound && !outbound) return undefined;
  return { ...(inbound ? { inbound } : {}), ...(outbound ? { outbound } : {}) };
}

function serializePolicyBindingItem(item: ConnectionPolicyItem): Record<string, unknown> {
  if (item.mode === "inline") {
    return item.document;
  }
  const ref: Record<string, unknown> = { name: item.name };
  if (item.namespace) ref.namespace = item.namespace;
  return { ref };
}

function isCommittedPolicyItem(item: ConnectionPolicyItem): boolean {
  if (item.mode === "inline") return true;
  return item.name.trim().length > 0;
}

/** Drop uncommitted ref rows (empty name) so they never reach agent-network.yaml. */
export function sanitizeConnectionPolicyItems(
  items: ConnectionPolicyItem[] | undefined
): ConnectionPolicyItem[] | undefined {
  if (!items?.length) return undefined;
  const filtered = items.filter(isCommittedPolicyItem);
  const seenRef = new Set<string>();
  const deduped: ConnectionPolicyItem[] = [];
  for (const item of filtered) {
    if (item.mode !== "ref") {
      deduped.push(item);
      continue;
    }
    const key = `${item.namespace ?? ""}:${item.name.trim()}`;
    if (seenRef.has(key)) continue;
    seenRef.add(key);
    deduped.push({
      ...item,
      name: item.name.trim(),
      ...(item.namespace ? { namespace: item.namespace.trim() } : {}),
    });
  }
  return deduped.length > 0 ? deduped : undefined;
}

export function sanitizeConnectionPolicies(
  policies: ConnectionPolicies | undefined
): ConnectionPolicies | undefined {
  if (!policies) return undefined;
  const inbound = sanitizeConnectionPolicyItems(policies.inbound);
  const outbound = sanitizeConnectionPolicyItems(policies.outbound);
  if (!inbound && !outbound) return undefined;
  return {
    ...(inbound ? { inbound } : {}),
    ...(outbound ? { outbound } : {}),
  };
}

function serializePolicyBindings(items: ConnectionPolicyItem[] | undefined): unknown[] | undefined {
  const committed = sanitizeConnectionPolicyItems(items);
  if (!committed?.length) return undefined;
  return committed.map(serializePolicyBindingItem);
}

/** Omit access when internal (schema default). */
export function serializeConnectionAccess(access: ConnectionAccess | undefined): ConnectionAccess | undefined {
  if (!access || access === "internal") return undefined;
  return access;
}

export function serializeConnectionPolicies(
  policies: ConnectionPolicies | undefined
): Record<string, unknown> | undefined {
  const sanitized = sanitizeConnectionPolicies(policies);
  if (!sanitized) return undefined;
  const inbound = serializePolicyBindings(sanitized.inbound);
  const outbound = serializePolicyBindings(sanitized.outbound);
  if (!inbound && !outbound) return undefined;
  return {
    ...(inbound ? { inbound } : {}),
    ...(outbound ? { outbound } : {}),
  };
}

/** Merge connection-level access/policies into a yaml connection entry. */
export function applyConnectionExtras(
  entry: Record<string, unknown>,
  access: ConnectionAccess | undefined,
  policies: ConnectionPolicies | undefined
): void {
  const serializedAccess = serializeConnectionAccess(access);
  if (serializedAccess) entry.access = serializedAccess;
  const serializedPolicies = serializeConnectionPolicies(policies);
  if (serializedPolicies) entry.policies = serializedPolicies;
}
