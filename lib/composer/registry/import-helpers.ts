import { parseBrokerCard } from "@/lib/composer/a2a-card";
import { patchA2aV03CardFields } from "@/lib/composer/registry/agent-card-v03";
import { normalizeA2AVersion } from "@/lib/invoke/a2a-version";
import { parseMcpMetadataContent, type McpMetadata } from "@/lib/mulesoft/exchange-mcp-metadata";
import type {
  RegistryAgentEntity,
  RegistryMcpEntity,
  RegistryMcpTransportKind,
  RegistryUrlEntry,
} from "@/lib/composer/registry/types";

const MCP_PROTOCOL_VERSIONS = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Infer registry agent interface bucket from an agent card payload. */
export function inferRegistryAgentInterface(
  card: Record<string, unknown>
): "a2a" | "a2a_v03" {
  const direct = normalizeA2AVersion(asString(card.protocolVersion));
  if (direct?.startsWith("0.3")) return "a2a_v03";

  const supported = card.supportedInterfaces ?? card.supported_interfaces;
  if (Array.isArray(supported)) {
    for (const item of supported) {
      const rec = asRecord(item);
      if (!rec) continue;
      const version = normalizeA2AVersion(
        asString(rec.protocolVersion) ?? asString(rec.protocol_version)
      );
      if (version?.startsWith("0.3")) return "a2a_v03";
      if (version?.startsWith("1.")) return "a2a";
    }
  }

  return "a2a";
}

export function upsertUrlEntry(
  urls: RegistryUrlEntry[] | undefined,
  name: string,
  url: string
): RegistryUrlEntry[] {
  const trimmedUrl = url.trim();
  const trimmedName = name.trim();
  if (!trimmedUrl || !trimmedName) return urls ?? [];

  const list = [...(urls ?? [])];
  const idx = list.findIndex((entry) => entry.name === trimmedName);
  if (idx >= 0) {
    list[idx] = { name: trimmedName, url: trimmedUrl };
  } else {
    list.push({ name: trimmedName, url: trimmedUrl });
  }
  return list;
}

function collectAgentCardUrls(
  cardRaw: Record<string, unknown>,
  sourceUrl?: string
): RegistryUrlEntry[] {
  let urls: RegistryUrlEntry[] | undefined;

  const cardUrl = asString(cardRaw.url);
  if (cardUrl) urls = upsertUrlEntry(urls, "default", cardUrl);

  const supported = cardRaw.supportedInterfaces ?? cardRaw.supported_interfaces;
  if (Array.isArray(supported)) {
    supported.forEach((item, index) => {
      const rec = asRecord(item);
      const ifaceUrl = rec ? asString(rec.url) : undefined;
      if (ifaceUrl) {
        urls = upsertUrlEntry(urls, `interface-${index + 1}`, ifaceUrl);
      }
    });
  }

  if (sourceUrl?.trim()) {
    urls = upsertUrlEntry(urls, "endpoint", sourceUrl.trim());
  }

  return urls ?? [];
}

/** Parse uploaded or fetched agent card JSON. */
export function parseAgentCardJson(
  text: string
): { ok: true; card: Record<string, unknown> } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }

  const obj = asRecord(json);
  if (!obj) return { ok: false, error: "Agent card must be a JSON object" };

  if ("jsonrpc" in obj && "result" in obj) {
    const result = asRecord(obj.result);
    if (result && ("name" in result || "skills" in result || "description" in result)) {
      return { ok: true, card: result };
    }
  }

  if ("name" in obj || "skills" in obj || "description" in obj || "supportedInterfaces" in obj) {
    return { ok: true, card: obj };
  }

  return { ok: false, error: "JSON does not look like an agent card" };
}

/** Merge agent card fields into a registry agent entity. */
export function mergeAgentCardIntoEntity(
  entity: RegistryAgentEntity,
  cardRaw: Record<string, unknown>,
  sourceUrl?: string
): { entity: RegistryAgentEntity; interfaceKey: "a2a" | "a2a_v03" } {
  let brokerCard = parseBrokerCard(cardRaw);
  const interfaceKey = inferRegistryAgentInterface(cardRaw);
  if (interfaceKey === "a2a_v03") {
    brokerCard = patchA2aV03CardFields(brokerCard, {
      url: asString(cardRaw.url) ?? brokerCard.supportedInterfaces?.[0]?.url ?? "",
      protocolVersion: asString(cardRaw.protocolVersion) ?? "0.3.0",
    });
  }
  const card = brokerCard as unknown as Record<string, unknown>;

  const info = {
    ...entity.info,
    label: brokerCard.name || entity.info?.label,
    description: brokerCard.description ?? entity.info?.description,
  };

  const platform =
    entity.metadata.platform === "Custom" && brokerCard.provider?.organization
      ? brokerCard.provider.organization
      : entity.metadata.platform;

  const interfaces =
    interfaceKey === "a2a"
      ? { a2a: { card } }
      : { a2a_v03: { card } };

  const urls = collectAgentCardUrls(cardRaw, sourceUrl);

  return {
    interfaceKey,
    entity: {
      ...entity,
      info,
      urls: urls.length > 0 ? urls : entity.urls,
      metadata: {
        ...entity.metadata,
        platform,
        interfaces,
      },
    },
  };
}

function normalizeMcpTransportKind(kind: string | undefined): RegistryMcpTransportKind {
  const normalized = (kind ?? "").trim().toLowerCase().replace(/[-_]/g, "");
  switch (normalized) {
    case "sse":
      return "sse";
    case "stdio":
      return "stdio";
    case "streamablehttp":
      return "streamableHttp";
    default:
      return "streamableHttp";
  }
}

function toObjectRecords(items: unknown[] | undefined): Record<string, unknown>[] | undefined {
  if (!items || items.length === 0) return undefined;
  return items
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function asRegistryProtocolVersion(
  value: string | undefined
): RegistryMcpEntity["metadata"]["protocolVersion"] {
  if (!value || !MCP_PROTOCOL_VERSIONS.has(value)) return undefined;
  return value as RegistryMcpEntity["metadata"]["protocolVersion"];
}

/** Parse uploaded or fetched MCP metadata JSON. */
export function parseMcpMetadataJson(
  text: string
): { ok: true; metadata: McpMetadata } | { ok: false; error: string } {
  for (const classifier of ["mcp-metadata", "mcp", "fat-mcp-metadata"] as const) {
    const metadata = parseMcpMetadataContent(classifier, text);
    if (metadata) return { ok: true, metadata };
  }
  return { ok: false, error: "JSON does not look like MCP metadata" };
}

/** Merge MCP metadata fields into a registry MCP entity. */
export function mergeMcpMetadataIntoEntity(
  entity: RegistryMcpEntity,
  metadata: McpMetadata,
  sourceUrl?: string
): RegistryMcpEntity {
  const transportKind = normalizeMcpTransportKind(metadata.transport?.kind);
  const transport = { ...entity.metadata.transport, kind: transportKind };

  let urls = entity.urls;
  if (sourceUrl?.trim()) {
    urls = upsertUrlEntry(urls, "metadata", sourceUrl.trim());
  }

  const tools = toObjectRecords(metadata.tools as unknown[] | undefined);
  const resources = toObjectRecords(metadata.resources as unknown[] | undefined);
  const prompts = toObjectRecords(metadata.prompts as unknown[] | undefined);

  return {
    ...entity,
    urls,
    metadata: {
      ...entity.metadata,
      protocolVersion:
        asRegistryProtocolVersion(metadata.protocolVersion) ?? entity.metadata.protocolVersion,
      transport,
      capabilities: metadata.capabilities ?? entity.metadata.capabilities,
      tools: tools ?? entity.metadata.tools,
      resources: resources ?? entity.metadata.resources,
      prompts: prompts ?? entity.metadata.prompts,
    },
  };
}
