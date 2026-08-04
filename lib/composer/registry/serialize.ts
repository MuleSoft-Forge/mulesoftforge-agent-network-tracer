import { serializeBrokerCard } from "@/lib/composer/a2a-card";
import { serializeA2aV03RegistryCard } from "@/lib/composer/registry/agent-card-v03";
import type { BrokerCard, ComposerProject, ImportedAsset } from "@/lib/composer/model";
import { registryNameForAsset } from "@/lib/composer/model";
import type {
  NamedRef,
  NetworkRegistry,
  RegistryAgentEntity,
  RegistryAgentTool,
  RegistryInfo,
  RegistryLlmEntity,
  RegistryMcpEntity,
  RegistryMcpTransport,
  RegistryUrlEntry,
} from "@/lib/composer/registry/types";

function omitEmptyRecord(obj: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(obj).length > 0 ? obj : undefined;
}

function serializeNamedRef(ref: NamedRef): Record<string, unknown> {
  return {
    name: ref.name,
    ...(ref.namespace ? { namespace: ref.namespace } : {}),
  };
}

function serializeRegistryInfo(info: RegistryInfo | undefined): Record<string, unknown> | undefined {
  if (!info) return undefined;
  const out: Record<string, unknown> = {};
  if (info.label) out.label = info.label;
  if (info.description) out.description = info.description;
  if (info.tags && info.tags.length > 0) out.tags = info.tags;
  return omitEmptyRecord(out);
}

function serializeUrls(urls: RegistryUrlEntry[] | undefined): Array<Record<string, unknown>> | undefined {
  if (!urls || urls.length === 0) return undefined;
  return urls.map((u) => ({ name: u.name, url: u.url }));
}

function serializeAgentTool(tool: RegistryAgentTool): Record<string, unknown> {
  if ("mcp" in tool) {
    return {
      mcp: {
        ref: serializeNamedRef(tool.mcp.ref),
        ...(tool.mcp.allowed && tool.mcp.allowed.length > 0 ? { allowed: tool.mcp.allowed } : {}),
      },
    };
  }
  return { a2a: { ref: serializeNamedRef(tool.a2a.ref) } };
}

function serializeAgentInterfaces(
  interfaces: RegistryAgentEntity["metadata"]["interfaces"]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (interfaces.a2a) {
    out.a2a = interfaces.a2a.card
      ? { card: serializeBrokerCard(interfaces.a2a.card as BrokerCard) }
      : {};
  }
  if (interfaces.a2a_v03) {
    out.a2a_v03 = interfaces.a2a_v03.card
      ? { card: serializeA2aV03RegistryCard(interfaces.a2a_v03.card as BrokerCard) }
      : {};
  }
  if (interfaces.other) {
    out.other = {
      protocol: interfaces.other.protocol,
      ...(interfaces.other.card ? { card: interfaces.other.card } : {}),
    };
  }
  return out;
}

function serializeAgentEntity(entity: RegistryAgentEntity): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...(entity.metadata.extra ?? {}),
    platform: entity.metadata.platform,
    interfaces: serializeAgentInterfaces(entity.metadata.interfaces),
  };
  if (entity.metadata.tools && entity.metadata.tools.length > 0) {
    metadata.tools = entity.metadata.tools.map(serializeAgentTool);
  }
  if (entity.metadata.llm) metadata.llm = { ref: serializeNamedRef(entity.metadata.llm.ref) };

  return {
    ...(entity.extra ?? {}),
    ...(serializeRegistryInfo(entity.info) ? { info: serializeRegistryInfo(entity.info) } : {}),
    metadata,
    ...(serializeUrls(entity.urls) ? { urls: serializeUrls(entity.urls) } : {}),
  };
}

function serializeMcpTransport(transport: RegistryMcpTransport): Record<string, unknown> {
  return {
    ...(transport.extra ?? {}),
    kind: transport.kind,
    ...(transport.ssePath ? { ssePath: transport.ssePath } : {}),
    ...(transport.messagesPath ? { messagesPath: transport.messagesPath } : {}),
    ...(transport.instructions ? { instructions: transport.instructions } : {}),
    ...(transport.path ? { path: transport.path } : {}),
  };
}

function serializeMcpEntity(entity: RegistryMcpEntity): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...(entity.metadata.extra ?? {}),
    transport: serializeMcpTransport(entity.metadata.transport),
  };
  if (entity.metadata.protocolVersion) metadata.protocolVersion = entity.metadata.protocolVersion;
  if (entity.metadata.provider) {
    metadata.provider = {
      ...(entity.metadata.provider.organization ? { organization: entity.metadata.provider.organization } : {}),
      ...(entity.metadata.provider.url ? { url: entity.metadata.provider.url } : {}),
    };
  }
  if (entity.metadata.capabilities) metadata.capabilities = entity.metadata.capabilities;
  if (entity.metadata.tools) metadata.tools = entity.metadata.tools;
  if (entity.metadata.resources) metadata.resources = entity.metadata.resources;
  if (entity.metadata.resourceTemplates) metadata.resourceTemplates = entity.metadata.resourceTemplates;
  if (entity.metadata.prompts) metadata.prompts = entity.metadata.prompts;
  if (entity.metadata.platform) metadata.platform = entity.metadata.platform;
  if (entity.metadata.securitySchemes) metadata.securitySchemes = entity.metadata.securitySchemes;

  return {
    ...(entity.extra ?? {}),
    ...(serializeRegistryInfo(entity.info) ? { info: serializeRegistryInfo(entity.info) } : {}),
    ...(serializeUrls(entity.urls) ? { urls: serializeUrls(entity.urls) } : {}),
    metadata,
  };
}

function serializeLlmEntity(entity: RegistryLlmEntity): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...(entity.metadata.extra ?? {}),
    platform: entity.metadata.platform,
  };
  if (entity.metadata.models && entity.metadata.models.length > 0) metadata.models = entity.metadata.models;

  return {
    ...(entity.extra ?? {}),
    ...(serializeRegistryInfo(entity.info) ? { info: serializeRegistryInfo(entity.info) } : {}),
    metadata,
    ...(serializeUrls(entity.urls) ? { urls: serializeUrls(entity.urls) } : {}),
  };
}

function entityMap<T extends { key: string }>(
  entities: T[],
  passthrough: Record<string, unknown> | undefined,
  serialize: (entity: T) => Record<string, unknown>
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = { ...(passthrough ?? {}) };
  for (const entity of entities) out[entity.key] = serialize(entity);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Minimal registry stub for a registry-local asset not already authored in registry. */
function stubEntityForAsset(asset: ImportedAsset): Record<string, unknown> | null {
  const name = registryNameForAsset(asset);
  const info = asset.description ? { description: asset.description } : undefined;

  switch (asset.kind) {
    case "llm":
      return {
        ...(info ? { info } : {}),
        metadata: {
          platform: "OpenAI",
        },
      };
    case "mcp":
      return {
        ...(info ? { info } : {}),
        metadata: {
          transport: { kind: "streamableHttp" },
        },
      };
    case "agent":
      return {
        ...(info ? { info } : {}),
        metadata: {
          platform: asset.name,
          interfaces: { a2a: {} },
        },
      };
    default: {
      const _exhaustive: never = asset.kind;
      return _exhaustive;
    }
  }
}

function mergeRegistryLocalAssets(
  registry: NetworkRegistry,
  project: ComposerProject
): NetworkRegistry {
  const agents = [...registry.agents];
  const mcps = [...registry.mcps];
  const llms = [...registry.llms];

  for (const asset of project.assets) {
    if (!asset.registryLocal) continue;
    const key = registryNameForAsset(asset);
    const stub = stubEntityForAsset(asset);
    if (!stub) continue;

    switch (asset.kind) {
      case "agent":
        if (!agents.some((a) => a.key === key)) {
          agents.push({
            key,
            metadata: {
              platform: asset.name,
              interfaces: { a2a: {} },
            },
            ...(asset.description ? { info: { description: asset.description } } : {}),
          });
        }
        break;
      case "mcp":
        if (!mcps.some((m) => m.key === key)) {
          mcps.push({
            key,
            metadata: { transport: { kind: "streamableHttp" } },
            ...(asset.description ? { info: { description: asset.description } } : {}),
          });
        }
        break;
      case "llm":
        if (!llms.some((l) => l.key === key)) {
          llms.push({
            key,
            metadata: { platform: "OpenAI" },
            ...(asset.description ? { info: { description: asset.description } } : {}),
          });
        }
        break;
      default: {
        const _exhaustive: never = asset.kind;
        void _exhaustive;
      }
    }
  }

  return { ...registry, agents, mcps, llms };
}

/** Serialize typed registry to yaml `registry:` object, merging registry-local asset stubs. */
export function serializeNetworkRegistry(
  registry: NetworkRegistry | undefined,
  project: ComposerProject
): Record<string, unknown> | undefined {
  const base: NetworkRegistry = registry ?? { agents: [], mcps: [], llms: [] };
  const merged = mergeRegistryLocalAssets(base, project);

  const out: Record<string, unknown> = { ...(merged.extra ?? {}) };
  const agents = entityMap(merged.agents, merged.passthroughAgents, serializeAgentEntity);
  const mcps = entityMap(merged.mcps, merged.passthroughMcps, serializeMcpEntity);
  const llms = entityMap(merged.llms, merged.passthroughLlms, serializeLlmEntity);
  if (agents) out.agents = agents;
  if (mcps) out.mcps = mcps;
  if (llms) out.llms = llms;

  return Object.keys(out).length > 0 ? out : undefined;
}

export function emptyNetworkRegistry(): NetworkRegistry {
  return { agents: [], mcps: [], llms: [] };
}
