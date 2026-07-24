"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { MuleIcon } from "@/components/composer/MuleIcon";
import type { Broker, ComposerProject, ImportedAsset } from "@/lib/composer/model";
import { connectionNameForAsset } from "@/lib/composer/model";
import { createMcpToolAction } from "@/lib/composer/factory";
import { parseMcpAssetMeta } from "@/lib/composer/mcp-metadata";
import { useComposer } from "@/lib/composer/store";
import { useMcpTools } from "@/components/composer/useMcpTools";
import { Button, SelectField } from "@/components/composer/ui";

function usedToolNamesForConnection(broker: Broker, connectionName: string, exceptActionId?: string): Set<string> {
  return new Set(
    broker.actions
      .filter(
        (a) =>
          a.actionKind === "mcp:tool" &&
          a.connectionName === connectionName &&
          a.toolName &&
          a.id !== exceptActionId
      )
      .map((a) => a.toolName!)
  );
}

function McpAssetToolAddRow({
  asset,
  broker,
  organizationId,
}: {
  asset: ImportedAsset;
  broker: Broker;
  organizationId: string;
}) {
  const { dispatch } = useComposer();
  const { meta, loading, error, refresh } = useMcpTools(organizationId, asset);
  const connectionName = connectionNameForAsset(asset);
  const usedTools = usedToolNamesForConnection(broker, connectionName);
  const catalog = meta?.tools ?? parseMcpAssetMeta(asset.meta)?.tools ?? [];
  const available = catalog.filter((t) => !usedTools.has(t.name));
  const [selected, setSelected] = useState("");

  const options = useMemo(
    () => [
      { value: "", label: available.length > 0 ? "(select a tool)" : "(all tools have actions)" },
      ...available.map((t) => ({
        value: t.name,
        label: t.description ? `${t.name} — ${t.description}` : t.name,
      })),
    ],
    [available]
  );

  function addTools(toolNames: string[]) {
    if (toolNames.length === 0) return;
    const usedNames = new Set(broker.actions.map((a) => a.name));
    for (const toolName of toolNames) {
      dispatch({ type: "addAction", action: createMcpToolAction(asset, toolName, usedNames) });
    }
    if (meta) {
      dispatch({ type: "updateAsset", id: asset.id, patch: { meta } });
    }
    setSelected("");
  }

  function addAll() {
    addTools(available.map((t) => t.name));
  }

  if (catalog.length === 0 && !loading) {
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
        <span className="font-mono">{connectionName}</span>
        <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => void refresh()}>
          Load tools
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium text-gray-600">Add tool action</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[12rem] flex-1">
          <SelectField
            label="Tool"
            value={selected}
            options={options}
            onChange={setSelected}
            hint={loading ? "Loading tools from Exchange…" : `${available.length} tool(s) without an action`}
          />
        </div>
        <Button
          variant="secondary"
          className="h-9"
          disabled={!selected || loading}
          onClick={() => addTools([selected])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
        {available.length > 1 && (
          <Button variant="ghost" className="h-9 text-xs" disabled={loading} onClick={addAll}>
            Add all ({available.length})
          </Button>
        )}
      </div>
      {error ? <p className="text-[11px] text-amber-700">{error}</p> : null}
    </div>
  );
}

export { usedToolNamesForConnection, McpAssetToolAddRow };

export default function AddMcpToolActionsPanel({
  project,
  broker,
}: {
  project: ComposerProject;
  broker: Broker;
}) {
  const mcpAssets = project.assets.filter((a) => a.kind === "mcp");
  if (mcpAssets.length === 0) return null;

  return (
    <div className="space-y-3 rounded-md border border-dashed border-gray-200 bg-gray-50/50 p-3">
      <div className="flex items-start gap-2">
        <MuleIcon name="mcp" size={18} className="mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-medium text-gray-700">Add MCP tool action</p>
          <p className="text-[11px] text-gray-500">
            Each tool gets its own action (same MCP connection, different tool_name).
          </p>
        </div>
      </div>
      {mcpAssets.map((asset) => (
        <McpAssetToolAddRow
          key={asset.id}
          asset={asset}
          broker={broker}
          organizationId={project.identity.organizationId}
        />
      ))}
    </div>
  );
}
