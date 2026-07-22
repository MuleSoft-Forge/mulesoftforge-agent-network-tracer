"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ImportedAsset } from "@/lib/composer/model";
import {
  hasMcpAssetMeta,
  mcpMetaFromExchange,
  parseMcpAssetMeta,
  type ImportedAssetMcpMeta,
} from "@/lib/composer/mcp-metadata";
import type { McpMetadata } from "@/lib/mulesoft/exchange-asset-metadata";

export interface McpToolsState {
  meta: ImportedAssetMcpMeta | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<ImportedAssetMcpMeta | null>;
}

async function fetchMcpMetadataFromApi(
  organizationId: string,
  asset: ImportedAsset
): Promise<ImportedAssetMcpMeta | null> {
  const params = new URLSearchParams({
    organizationId,
    groupId: asset.groupId,
    assetId: asset.assetId,
    version: asset.version,
  });
  const res = await fetch(`/api/exchange/mcp-metadata?${params.toString()}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `MCP metadata failed (${res.status}).`);
  }
  const data = (await res.json()) as { metadata: McpMetadata };
  return mcpMetaFromExchange(data.metadata);
}

/** Load MCP tools for one composed asset (cached meta first, then Exchange). */
export function useMcpTools(
  organizationId: string | undefined,
  asset: ImportedAsset | undefined
): McpToolsState {
  const assetRef = useRef(asset);
  assetRef.current = asset;

  const assetKey = asset ? `${asset.id}:${asset.version}` : "";

  const [meta, setMeta] = useState<ImportedAssetMcpMeta | null>(() =>
    asset ? parseMcpAssetMeta(asset.meta) : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoFetchedKeyRef = useRef<string | null>(null);

  const refresh = useCallback(async (): Promise<ImportedAssetMcpMeta | null> => {
    const current = assetRef.current;
    if (!organizationId || !current || current.kind !== "mcp") {
      setMeta(null);
      setError(organizationId ? null : "Set organization id in Project identity.");
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const fetched = await fetchMcpMetadataFromApi(organizationId, current);
      setMeta(fetched);
      if (!fetched || fetched.tools.length === 0) {
        setError("No tools listed in Exchange mcp-metadata for this asset.");
      }
      return fetched;
    } catch (e) {
      setError(e instanceof Error ? e.message : "MCP metadata request failed.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    autoFetchedKeyRef.current = null;
  }, [assetKey]);

  useEffect(() => {
    const current = assetRef.current;
    const cached = current ? parseMcpAssetMeta(current.meta) : null;
    if (cached?.tools.length) {
      setMeta(cached);
      setError(null);
      return;
    }

    // Empty catalog still counts as cached — avoid refetch loops when Exchange
    // returns mcp-metadata with no tools (parseMcpAssetMeta returns null for []).
    if (current && hasMcpAssetMeta(current.meta)) {
      setMeta(cached);
      setError("No tools listed in Exchange mcp-metadata for this asset.");
      return;
    }

    if (!organizationId || current?.kind !== "mcp") {
      setMeta(null);
      return;
    }

    if (autoFetchedKeyRef.current === assetKey) return;
    autoFetchedKeyRef.current = assetKey;
    void refresh();
  }, [organizationId, assetKey, asset?.meta, refresh]);

  return { meta, loading, error, refresh };
}

export { fetchMcpMetadataFromApi };
