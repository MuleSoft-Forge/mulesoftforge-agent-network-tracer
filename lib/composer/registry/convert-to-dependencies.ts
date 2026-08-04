/**
 * Promote registry-local yaml connections to composed Exchange dependencies.
 *
 * Registry-local assets resolve against yaml `registry:` at deploy time. Linking
 * a published Exchange asset clears `registryLocal` and drops the registry entity
 * so export emits exchange.json dependencies[] instead.
 */

import { emptyNetworkRegistry } from "@/lib/composer/registry";
import type { NetworkRegistry } from "@/lib/composer/registry/types";
import {
  registryNameForAsset,
  type AssetKind,
  type ComposerProject,
  type ImportedAsset,
} from "@/lib/composer/model";

export type RegistryEntityKind = "agents" | "mcps" | "llms";

export interface ConvertibleRegistryEntity {
  registryKind: RegistryEntityKind;
  entityKey: string;
  asset: ImportedAsset;
}

export interface ConvertRegistryEntityInput {
  registryKind: RegistryEntityKind;
  entityKey: string;
  groupId: string;
  assetId: string;
  version: string;
  name: string;
  namespace?: string;
  meta?: unknown;
}

export function registryKindToAssetKind(kind: RegistryEntityKind): AssetKind {
  switch (kind) {
    case "agents":
      return "agent";
    case "mcps":
      return "mcp";
    case "llms":
      return "llm";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function findRegistryLocalAsset(
  project: ComposerProject,
  registryKind: RegistryEntityKind,
  entityKey: string
): ImportedAsset | undefined {
  const assetKind = registryKindToAssetKind(registryKind);
  return project.assets.find(
    (asset) =>
      asset.registryLocal === true &&
      asset.kind === assetKind &&
      registryNameForAsset(asset) === entityKey
  );
}

/** Registry entities that still have a matching registry-local composed asset. */
export function listConvertibleRegistryEntities(project: ComposerProject): ConvertibleRegistryEntity[] {
  const registry = project.registry ?? emptyNetworkRegistry();
  const out: ConvertibleRegistryEntity[] = [];

  for (const entity of registry.agents) {
    const asset = findRegistryLocalAsset(project, "agents", entity.key);
    if (asset) out.push({ registryKind: "agents", entityKey: entity.key, asset });
  }
  for (const entity of registry.mcps) {
    const asset = findRegistryLocalAsset(project, "mcps", entity.key);
    if (asset) out.push({ registryKind: "mcps", entityKey: entity.key, asset });
  }
  for (const entity of registry.llms) {
    const asset = findRegistryLocalAsset(project, "llms", entity.key);
    if (asset) out.push({ registryKind: "llms", entityKey: entity.key, asset });
  }

  return out;
}

function removeRegistryEntity(
  registry: NetworkRegistry,
  registryKind: RegistryEntityKind,
  entityKey: string
): NetworkRegistry | undefined {
  const next: NetworkRegistry = {
    ...registry,
    agents: registryKind === "agents" ? registry.agents.filter((e) => e.key !== entityKey) : registry.agents,
    mcps: registryKind === "mcps" ? registry.mcps.filter((e) => e.key !== entityKey) : registry.mcps,
    llms: registryKind === "llms" ? registry.llms.filter((e) => e.key !== entityKey) : registry.llms,
  };
  const empty =
    next.agents.length === 0 &&
    next.mcps.length === 0 &&
    next.llms.length === 0 &&
    !next.extra;
  return empty ? undefined : next;
}

export function applyConvertRegistryEntityToDependency(
  project: ComposerProject,
  input: ConvertRegistryEntityInput
): ComposerProject {
  const asset = findRegistryLocalAsset(project, input.registryKind, input.entityKey);
  if (!asset) {
    throw new Error(
      `No registry-local connection matches registry key "${input.entityKey}". Import or compose the connection first.`
    );
  }

  const assets = project.assets.map((a) => {
    if (a.id !== asset.id) return a;
    return {
      ...a,
      groupId: input.groupId,
      assetId: input.assetId,
      version: input.version,
      namespace: input.namespace ?? input.groupId,
      name: input.name || input.assetId,
      registryLocal: undefined,
      ...(input.meta !== undefined ? { meta: input.meta } : {}),
    };
  });

  const registry = project.registry ?? emptyNetworkRegistry();
  const nextRegistry = removeRegistryEntity(registry, input.registryKind, input.entityKey);

  return { ...project, assets, registry: nextRegistry };
}
