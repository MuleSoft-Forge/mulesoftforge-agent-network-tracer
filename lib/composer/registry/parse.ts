import { parseBrokerCard } from "@/lib/composer/a2a-card";
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

const OWNED_REGISTRY_KEYS = new Set(["agents", "mcps", "llms"]);

const OWNED_AGENT_KEYS = new Set(["info", "metadata", "urls"]);
const OWNED_AGENT_METADATA_KEYS = new Set(["platform", "interfaces", "tools", "llm"]);
const OWNED_AGENT_INTERFACE_KEYS = new Set(["a2a", "a2a_v03", "other"]);
const OWNED_MCP_KEYS = new Set(["info", "metadata", "urls"]);
const OWNED_MCP_METADATA_KEYS = new Set([
  "protocolVersion",
  "transport",
  "provider",
  "capabilities",
  "tools",
  "resources",
  "resourceTemplates",
  "prompts",
  "platform",
  "securitySchemes",
]);
const OWNED_MCP_TRANSPORT_KEYS = new Set(["kind", "ssePath", "messagesPath", "instructions", "path"]);
const OWNED_LLM_KEYS = new Set(["info", "metadata", "urls"]);
const OWNED_LLM_METADATA_KEYS = new Set(["platform", "models"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function parseNamedRef(value: unknown): NamedRef | undefined {
  const obj = asRecord(value);
  const name = asString(obj?.name);
  if (!name) return undefined;
  return {
    name,
    ...(asString(obj?.namespace) ? { namespace: asString(obj?.namespace) } : {}),
  };
}

function parseRegistryInfo(value: unknown): RegistryInfo | undefined {
  const obj = asRecord(value);
  if (!obj) return undefined;
  const label = asString(obj.label);
  const description = asString(obj.description);
  const tags = stringArray(obj.tags);
  if (!label && !description && !tags) return undefined;
  return {
    ...(label ? { label } : {}),
    ...(description ? { description } : {}),
    ...(tags ? { tags } : {}),
  };
}

function parseUrls(value: unknown): RegistryUrlEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: RegistryUrlEntry[] = [];
  for (const entry of value) {
    const obj = asRecord(entry);
    const name = asString(obj?.name);
    const url = asString(obj?.url);
    if (!name || !url) continue;
    items.push({ name, url });
  }
  return items.length > 0 ? items : undefined;
}

function parseAgentTool(value: unknown): RegistryAgentTool | undefined {
  const obj = asRecord(value);
  if (!obj) return undefined;
  const mcp = asRecord(obj.mcp);
  if (mcp) {
    const ref = parseNamedRef(mcp.ref);
    if (!ref) return undefined;
    return {
      mcp: {
        ref,
        ...(stringArray(mcp.allowed) ? { allowed: stringArray(mcp.allowed) } : {}),
      },
    };
  }
  const a2a = asRecord(obj.a2a);
  if (a2a) {
    const ref = parseNamedRef(a2a.ref);
    if (!ref) return undefined;
    return { a2a: { ref } };
  }
  return undefined;
}

function parseAgentInterfaces(value: unknown): RegistryAgentEntity["metadata"]["interfaces"] | undefined {
  const obj = asRecord(value);
  if (!obj) return undefined;
  const out: RegistryAgentEntity["metadata"]["interfaces"] = {};
  for (const key of ["a2a", "a2a_v03"] as const) {
    const iface = asRecord(obj[key]);
    if (!iface) continue;
    const cardObj = asRecord(iface.card);
    out[key] = cardObj ? { card: parseBrokerCard(cardObj) as Record<string, unknown> } : {};
  }
  const other = asRecord(obj.other);
  if (other) {
    const protocol = asString(other.protocol);
    if (protocol) {
      out.other = {
        protocol,
        ...(asRecord(other.card) ? { card: asRecord(other.card) } : {}),
      };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseAgentMetadata(value: unknown): RegistryAgentEntity["metadata"] | undefined {
  const obj = asRecord(value);
  if (!obj) return undefined;
  const platform = asString(obj.platform);
  const interfaces = parseAgentInterfaces(obj.interfaces);
  if (!platform || !interfaces) return undefined;

  const toolsRaw = Array.isArray(obj.tools) ? obj.tools : undefined;
  const tools = toolsRaw
    ?.map(parseAgentTool)
    .filter((t): t is RegistryAgentTool => t != null);
  const llmObj = asRecord(obj.llm);
  const llmRef = llmObj ? parseNamedRef(llmObj.ref) : undefined;

  const extra: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (!OWNED_AGENT_METADATA_KEYS.has(key)) extra[key] = val;
  }

  return {
    platform,
    interfaces,
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(llmRef ? { llm: { ref: llmRef } } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

function parseAgentEntity(key: string, raw: unknown): RegistryAgentEntity | undefined {
  const obj = asRecord(raw);
  const metadata = parseAgentMetadata(obj?.metadata);
  if (!metadata) return undefined;
  const extra: Record<string, unknown> = {};
  if (obj) {
    for (const [k, val] of Object.entries(obj)) {
      if (!OWNED_AGENT_KEYS.has(k)) extra[k] = val;
    }
  }
  return {
    key,
    ...(parseRegistryInfo(obj?.info) ? { info: parseRegistryInfo(obj?.info) } : {}),
    metadata,
    ...(parseUrls(obj?.urls) ? { urls: parseUrls(obj?.urls) } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

function parseMcpTransport(value: unknown): RegistryMcpTransport | undefined {
  const obj = asRecord(value);
  const kind = asString(obj?.kind);
  if (kind !== "sse" && kind !== "stdio" && kind !== "streamableHttp") return undefined;
  const extra: Record<string, unknown> = {};
  if (obj) {
    for (const [key, val] of Object.entries(obj)) {
      if (!OWNED_MCP_TRANSPORT_KEYS.has(key)) extra[key] = val;
    }
  }
  return {
    kind,
    ...(asString(obj?.ssePath) ? { ssePath: asString(obj?.ssePath) } : {}),
    ...(asString(obj?.messagesPath) ? { messagesPath: asString(obj?.messagesPath) } : {}),
    ...(asString(obj?.instructions) ? { instructions: asString(obj?.instructions) } : {}),
    ...(asString(obj?.path) ? { path: asString(obj?.path) } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

function objectArray(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry != null);
  return items.length > 0 ? items : undefined;
}

function parseMcpMetadata(value: unknown): RegistryMcpEntity["metadata"] | undefined {
  const obj = asRecord(value);
  const transport = parseMcpTransport(obj?.transport);
  if (!transport) return undefined;

  const providerObj = asRecord(obj?.provider);
  const extra: Record<string, unknown> = {};
  if (obj) {
    for (const [key, val] of Object.entries(obj)) {
      if (!OWNED_MCP_METADATA_KEYS.has(key)) extra[key] = val;
    }
  }

  const protocolVersion = asString(obj?.protocolVersion);
  const validVersions = new Set(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);

  return {
    transport,
    ...(protocolVersion && validVersions.has(protocolVersion)
      ? { protocolVersion: protocolVersion as RegistryMcpEntity["metadata"]["protocolVersion"] }
      : {}),
    ...(providerObj &&
    (asString(providerObj.organization) || asString(providerObj.url))
      ? {
          provider: {
            ...(asString(providerObj.organization) ? { organization: asString(providerObj.organization) } : {}),
            ...(asString(providerObj.url) ? { url: asString(providerObj.url) } : {}),
          },
        }
      : {}),
    ...(asRecord(obj?.capabilities) ? { capabilities: asRecord(obj?.capabilities) } : {}),
    ...(objectArray(obj?.tools) ? { tools: objectArray(obj?.tools) } : {}),
    ...(objectArray(obj?.resources) ? { resources: objectArray(obj?.resources) } : {}),
    ...(objectArray(obj?.resourceTemplates) ? { resourceTemplates: objectArray(obj?.resourceTemplates) } : {}),
    ...(objectArray(obj?.prompts) ? { prompts: objectArray(obj?.prompts) } : {}),
    ...(asString(obj?.platform) ? { platform: asString(obj?.platform) } : {}),
    ...(asRecord(obj?.securitySchemes) ? { securitySchemes: asRecord(obj?.securitySchemes) } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

function parseMcpEntity(key: string, raw: unknown): RegistryMcpEntity | undefined {
  const obj = asRecord(raw);
  const metadata = parseMcpMetadata(obj?.metadata);
  if (!metadata) return undefined;
  const extra: Record<string, unknown> = {};
  if (obj) {
    for (const [k, val] of Object.entries(obj)) {
      if (!OWNED_MCP_KEYS.has(k)) extra[k] = val;
    }
  }
  return {
    key,
    ...(parseRegistryInfo(obj?.info) ? { info: parseRegistryInfo(obj?.info) } : {}),
    ...(parseUrls(obj?.urls) ? { urls: parseUrls(obj?.urls) } : {}),
    metadata,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

function parseLlmMetadata(value: unknown): RegistryLlmEntity["metadata"] | undefined {
  const obj = asRecord(value);
  const platform = asString(obj?.platform);
  if (platform !== "Gemini" && platform !== "OpenAI" && platform !== "AzureOpenai") return undefined;
  const extra: Record<string, unknown> = {};
  if (obj) {
    for (const [key, val] of Object.entries(obj)) {
      if (!OWNED_LLM_METADATA_KEYS.has(key)) extra[key] = val;
    }
  }
  return {
    platform,
    ...(stringArray(obj?.models) ? { models: stringArray(obj?.models) } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

function parseLlmEntity(key: string, raw: unknown): RegistryLlmEntity | undefined {
  const obj = asRecord(raw);
  const metadata = parseLlmMetadata(obj?.metadata);
  if (!metadata) return undefined;
  const extra: Record<string, unknown> = {};
  if (obj) {
    for (const [k, val] of Object.entries(obj)) {
      if (!OWNED_LLM_KEYS.has(k)) extra[k] = val;
    }
  }
  return {
    key,
    ...(parseRegistryInfo(obj?.info) ? { info: parseRegistryInfo(obj?.info) } : {}),
    metadata,
    ...(parseUrls(obj?.urls) ? { urls: parseUrls(obj?.urls) } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

function parseEntityMap<T>(
  value: unknown,
  parseEntity: (key: string, raw: unknown) => T | undefined
): { items: T[]; passthrough: Record<string, unknown> } {
  const obj = asRecord(value);
  if (!obj) return { items: [], passthrough: {} };
  const items: T[] = [];
  const passthrough: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(obj)) {
    const entity = parseEntity(key, raw);
    if (entity) items.push(entity);
    else passthrough[key] = raw;
  }
  return { items, passthrough };
}

/** Parse yaml `registry:` block into typed NetworkRegistry. Unknown top-level keys preserved in extra. */
export function parseNetworkRegistry(value: unknown): NetworkRegistry | undefined {
  const obj = asRecord(value);
  if (!obj) return undefined;

  const agentsParsed = parseEntityMap(obj.agents, parseAgentEntity);
  const mcpsParsed = parseEntityMap(obj.mcps, parseMcpEntity);
  const llmsParsed = parseEntityMap(obj.llms, parseLlmEntity);

  const extra: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (!OWNED_REGISTRY_KEYS.has(key)) extra[key] = val;
  }

  if (
    agentsParsed.items.length === 0 &&
    mcpsParsed.items.length === 0 &&
    llmsParsed.items.length === 0 &&
    Object.keys(agentsParsed.passthrough).length === 0 &&
    Object.keys(mcpsParsed.passthrough).length === 0 &&
    Object.keys(llmsParsed.passthrough).length === 0 &&
    Object.keys(extra).length === 0
  ) {
    return undefined;
  }

  return {
    agents: agentsParsed.items,
    mcps: mcpsParsed.items,
    llms: llmsParsed.items,
    ...(Object.keys(agentsParsed.passthrough).length > 0
      ? { passthroughAgents: agentsParsed.passthrough }
      : {}),
    ...(Object.keys(mcpsParsed.passthrough).length > 0 ? { passthroughMcps: mcpsParsed.passthrough } : {}),
    ...(Object.keys(llmsParsed.passthrough).length > 0 ? { passthroughLlms: llmsParsed.passthrough } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}
