import type { ComposerProject, ImportedAsset } from "@/lib/composer/model";
import { primaryBroker } from "@/lib/composer/model";
import type { ConnectionAccess, ConnectionPolicyItem } from "@/lib/composer/connectivity/types";
import type { DeclaredPolicyBinding } from "@/lib/composer/connectivity/policy-bindings-zod";
import { serializeConnectionAccess } from "@/lib/composer/connectivity/connection-extras";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function refBindingNames(items: ConnectionPolicyItem[] | undefined): string[] {
  return (items ?? [])
    .filter((item): item is Extract<ConnectionPolicyItem, { mode: "ref" }> => item.mode === "ref")
    .map((item) => item.name)
    .filter(Boolean);
}

export function refBindingNamesFromItems(items: ConnectionPolicyItem[] | undefined): string[] {
  return refBindingNames(items);
}

/** All ref binding names referenced by connections and broker interface policies. */
export function referencedPolicyBindingNames(project: ComposerProject): Set<string> {
  const names = new Set<string>();
  for (const asset of project.assets) {
    for (const name of refBindingNames(asset.policies?.inbound)) names.add(name);
    for (const name of refBindingNames(asset.policies?.outbound)) names.add(name);
  }
  const broker = primaryBroker(project);
  if (broker) {
    for (const name of refBindingNames(broker.interfacePolicies?.inbound)) names.add(name);
    for (const name of refBindingNames(broker.interfacePolicies?.outbound)) names.add(name);
  }
  return names;
}

export function parseDeclaredPolicyBinding(raw: unknown): DeclaredPolicyBinding | undefined {
  const obj = asRecord(raw);
  if (!obj) return undefined;
  const ref = asRecord(obj.ref);
  const name = asString(ref?.name);
  if (!name) return undefined;
  const namespace = asString(ref?.namespace);
  const configuration = asRecord(obj.configuration) ?? {};
  const accessRaw = obj.access;
  const access: ConnectionAccess | undefined =
    accessRaw === "shared" ? "shared" : accessRaw === "internal" ? "internal" : undefined;
  return {
    ref: namespace ? { name, namespace } : { name },
    configuration,
    ...(access ? { access } : {}),
  };
}

export function parseContextPolicies(raw: unknown): Record<string, DeclaredPolicyBinding> {
  const obj = asRecord(raw);
  if (!obj) return {};
  const out: Record<string, DeclaredPolicyBinding> = {};
  for (const [bindingName, value] of Object.entries(obj)) {
    const parsed = parseDeclaredPolicyBinding(value);
    if (parsed) out[bindingName] = parsed;
  }
  return out;
}

function serializeDeclaredPolicyBinding(binding: DeclaredPolicyBinding): Record<string, unknown> {
  const ref: Record<string, unknown> = { name: binding.ref.name };
  if (binding.ref.namespace) ref.namespace = binding.ref.namespace;
  const out: Record<string, unknown> = {
    ref,
    configuration: binding.configuration ?? {},
  };
  const access = serializeConnectionAccess(binding.access);
  if (access) out.access = access;
  return out;
}

/** Build context.policies for yaml — only bindings referenced by connections. */
export function serializeContextPolicies(project: ComposerProject): Record<string, unknown> | undefined {
  const referenced = referencedPolicyBindingNames(project);
  if (referenced.size === 0) return undefined;

  const policies: Record<string, unknown> = {};
  for (const bindingName of referenced) {
    const binding = project.policyBindings[bindingName];
    if (binding) {
      policies[bindingName] = serializeDeclaredPolicyBinding(binding);
      continue;
    }
    policies[bindingName] = {
      ref: { name: bindingName },
      configuration: {},
    };
  }
  return Object.keys(policies).length > 0 ? policies : undefined;
}

export function ensurePolicyBindingForRef(
  bindings: Record<string, DeclaredPolicyBinding>,
  bindingName: string,
  ref: { name: string; namespace?: string },
  templateVersion?: string | null
): Record<string, DeclaredPolicyBinding> {
  if (bindings[bindingName]) return bindings;
  return {
    ...bindings,
    [bindingName]: {
      ref,
      configuration: {},
      ...(templateVersion != null ? { templateVersion } : {}),
    },
  };
}

export function bindingNameFromExchangePolicy(
  assetId: string,
  groupId: string,
  organizationId: string
): { bindingName: string; ref: { name: string; namespace?: string } } {
  const ref = {
    name: assetId,
    ...(groupId !== organizationId ? { namespace: groupId } : {}),
  };
  return { bindingName: assetId, ref };
}

export function pruneUnreferencedPolicyBindings(
  bindings: Record<string, DeclaredPolicyBinding>,
  project: ComposerProject
): Record<string, DeclaredPolicyBinding> {
  const referenced = referencedPolicyBindingNames(project);
  const out: Record<string, DeclaredPolicyBinding> = {};
  for (const name of referenced) {
    if (bindings[name]) out[name] = bindings[name];
  }
  return out;
}

export function syncPolicyBindingsForAsset(
  bindings: Record<string, DeclaredPolicyBinding>,
  asset: ImportedAsset,
  organizationId: string
): Record<string, DeclaredPolicyBinding> {
  let next = bindings;
  const addRefs = (items: ConnectionPolicyItem[] | undefined) => {
    for (const item of items ?? []) {
      if (item.mode !== "ref" || !item.name) continue;
      next = ensurePolicyBindingForRef(next, item.name, {
        name: item.name,
        ...(item.namespace ? { namespace: item.namespace } : {}),
      });
    }
  };
  addRefs(asset.policies?.inbound);
  addRefs(asset.policies?.outbound);
  void organizationId;
  return next;
}
