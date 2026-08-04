import type { McpMetadata } from "@/lib/mulesoft/exchange-asset-metadata";

export interface ImportedAssetMcpMeta {
  fileKind: "mcp-metadata";
  tools: McpMetadata["tools"];
  protocolVersion?: string;
  /** Exchange assetId the catalog was fetched for — guards against stale/wrong-server meta. */
  sourceAssetId?: string;
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
  const tools = meta.tools
    .filter(
      (t): t is McpMetadata["tools"][number] =>
        Boolean(t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string")
    )
    .map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
    }));
  if (tools.length === 0) return null;
  return {
    fileKind: "mcp-metadata",
    tools,
    ...(meta.protocolVersion ? { protocolVersion: meta.protocolVersion } : {}),
    ...(meta.sourceAssetId ? { sourceAssetId: meta.sourceAssetId } : {}),
  };
}

export function mcpMetaFromExchange(metadata: McpMetadata): ImportedAssetMcpMeta {
  return {
    fileKind: "mcp-metadata",
    tools: metadata.tools,
    ...(metadata.protocolVersion ? { protocolVersion: metadata.protocolVersion } : {}),
  };
}

/** Stamp which Exchange asset a cached catalog belongs to. */
export function tagMcpMetaForAsset(meta: ImportedAssetMcpMeta, assetId: string): ImportedAssetMcpMeta {
  return { ...meta, sourceAssetId: assetId };
}

/** Tag unknown meta when storing on an asset (no-op for non-MCP meta). */
export function tagCachedMcpMeta(meta: unknown, assetId: string): unknown {
  if (!isImportedAssetMcpMeta(meta)) return meta;
  return tagMcpMetaForAsset(meta, assetId);
}

/**
 * MCP catalog for an asset, ignoring cached meta fetched for a different
 * Exchange assetId (can happen after import scrambled ref ↔ dependency links).
 */
export function mcpMetaForAsset(asset: { meta?: unknown; assetId: string }): ImportedAssetMcpMeta | null {
  if (!isImportedAssetMcpMeta(asset.meta)) return null;
  if (asset.meta.sourceAssetId && asset.meta.sourceAssetId !== asset.assetId) return null;
  return parseMcpAssetMeta(asset.meta);
}

export function defaultToolNameFromMeta(meta: ImportedAssetMcpMeta | null): string | undefined {
  if (!meta || meta.tools.length !== 1) return undefined;
  return meta.tools[0]?.name;
}
