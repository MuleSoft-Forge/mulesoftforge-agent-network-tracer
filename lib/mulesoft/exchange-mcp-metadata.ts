/**
 * Helpers for locating and typing MCP tool catalogs published on Exchange
 * (mcp-metadata.json on MCP server assets).
 */

import {
  parseExchangeMetadataFile,
  type McpMetadata,
} from "@/lib/mulesoft/exchange-asset-metadata";

export interface ExchangeAssetFileRef {
  classifier?: string | null;
  packaging?: string;
  downloadURL?: string;
}

const MCP_METADATA_CLASSIFIERS = ["mcp-metadata", "mcp", "fat-mcp-metadata"] as const;

/** Pick the best JSON metadata file for MCP tools on an Exchange asset version. */
export function pickMcpMetadataFile(files: ExchangeAssetFileRef[]): ExchangeAssetFileRef | undefined {
  for (const classifier of MCP_METADATA_CLASSIFIERS) {
    const hit = files.find((f) => {
      const c = (f.classifier ?? "").toLowerCase();
      const p = (f.packaging ?? "").toLowerCase();
      return c === classifier && p === "json";
    });
    if (hit) return hit;
  }
  return undefined;
}

/** Parse downloaded MCP metadata JSON (mcp-metadata or standalone mcp classifier). */
export function parseMcpMetadataContent(
  classifier: string,
  content: string | null
): McpMetadata | null {
  if (!content) return null;
  const parsed =
    parseExchangeMetadataFile(classifier, content) ??
    parseExchangeMetadataFile("mcp-metadata", content);
  return parsed?.fileKind === "mcp-metadata" ? parsed : null;
}

export type { McpMetadata };
