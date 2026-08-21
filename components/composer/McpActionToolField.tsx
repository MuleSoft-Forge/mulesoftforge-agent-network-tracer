"use client";

import { useEffect, useRef } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { BrokerAction, ImportedAsset } from "@/lib/composer/model";
import { mcpMetaForAsset } from "@/lib/composer/mcp-metadata";
import { useMcpTools } from "@/components/composer/useMcpTools";
import { Button, SelectField, TextField } from "@/components/composer/ui";

export function McpActionToolField({
  action,
  asset,
  organizationId,
  excludedToolNames,
  onToolNameChange,
  onMetaFetched,
}: {
  action: BrokerAction;
  asset: ImportedAsset | undefined;
  organizationId: string;
  excludedToolNames?: Set<string>;
  onToolNameChange: (toolName: string) => void;
  onMetaFetched?: (meta: unknown) => void;
}) {
  const { meta, loading, error, refresh } = useMcpTools(organizationId, asset);
  const onMetaFetchedRef = useRef(onMetaFetched);
  onMetaFetchedRef.current = onMetaFetched;
  const persistedMetaKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!meta || !asset) return;
    if (mcpMetaForAsset(asset)) return;
    const key = `${asset.id}:${asset.version}:${asset.assetId}`;
    if (persistedMetaKeyRef.current === key) return;
    persistedMetaKeyRef.current = key;
    onMetaFetchedRef.current?.(meta);
  }, [meta, asset?.id, asset?.version, asset?.assetId, asset?.meta]);

  async function handleRefresh() {
    const fetched = await refresh();
    if (fetched && onMetaFetched) onMetaFetched(fetched);
  }

  const selected = action.toolName ?? "";
  const tools = (meta?.tools ?? []).filter((t) => !excludedToolNames?.has(t.name) || t.name === selected);
  const catalogMismatch =
    Boolean(selected) && tools.length > 0 && !tools.some((t) => t.name === selected);
  const selectOptions = [
    { value: "", label: tools.length > 0 ? "(select a tool)" : "(no tools loaded)" },
    ...tools.map((t) => ({
      value: t.name,
      label: t.description ? `${t.name} — ${t.description}` : t.name,
    })),
  ];

  const showManual = tools.length === 0 && !loading;

  return (
    <div className="space-y-1.5">
      {tools.length > 0 ? (
        <SelectField
          label="Tool"
          value={selected}
          options={selectOptions}
          onChange={onToolNameChange}
          hint="From Exchange mcp-metadata.json — written to tool_name in the .agent file."
        />
      ) : showManual ? (
        <TextField
          label="Tool name"
          value={selected}
          onChange={onToolNameChange}
          mono
          hint="Exchange metadata unavailable — enter tool_name manually."
        />
      ) : (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading tools from Exchange…
        </div>
      )}
      {catalogMismatch ? (
        <p className="text-[11px] text-amber-700">
          Tool <span className="font-mono">{selected}</span> is not in this asset&apos;s Exchange catalog — refresh
          tools or pick a listed tool (stale metadata can happen when import linked the wrong dependency).
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        {error ? <p className="text-[11px] text-amber-700">{error}</p> : <span />}
        <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => void handleRefresh()} title="Refresh MCP tools from Exchange">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
    </div>
  );
}

export default McpActionToolField;
