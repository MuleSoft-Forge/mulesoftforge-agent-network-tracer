import type { McpMetadata } from "@/lib/mulesoft/exchange-asset-metadata";

/** Cached MCP catalog stored on ImportedAsset.meta after Exchange fetch. */
export interface ImportedAssetMcpMeta {
  fileKind: "mcp-metadata";
  tools: McpMetadata["tools"];
  protocolVersion?: string;
}

export function isImportedAssetMcpMeta(value: unknown): value is ImportedAssetMcpMeta {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return o.fileKind === "mcp-metadata" && Array.isArray(o.tools);
}

/** True when asset.meta already holds an MCP catalog (including an empty tool list). */
export function hasMcpAssetMeta(meta: unknown): boolean {
  return isImportedAssetMcpMeta(meta);
}

export function parseMcpAssetMeta(meta: unknown): ImportedAssetMcpMeta | null {
  if (!isImportedAssetMcpMeta(meta)) return null;
  const tools = meta.tools.filter(
    (t): t is { name: string; description?: string } =>
      Boolean(t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string")
  );
  if (tools.length === 0) return null;
  return {
    fileKind: "mcp-metadata",
    tools,
    ...(meta.protocolVersion ? { protocolVersion: meta.protocolVersion } : {}),
  };
}

export function mcpMetaFromExchange(metadata: McpMetadata): ImportedAssetMcpMeta {
  return {
    fileKind: "mcp-metadata",
    tools: metadata.tools,
    ...(metadata.protocolVersion ? { protocolVersion: metadata.protocolVersion } : {}),
  };
}

export function defaultToolNameFromMeta(meta: ImportedAssetMcpMeta | null): string | undefined {
  if (!meta || meta.tools.length !== 1) return undefined;
  return meta.tools[0]?.name;
}
