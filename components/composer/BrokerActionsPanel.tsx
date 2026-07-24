"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import type { Broker, BrokerAction, ComposerProject, ImportedAsset, AssetKind } from "@/lib/composer/model";
import { assetByConnectionName, connectionNameForAsset } from "@/lib/composer/model";
import { useComposer } from "@/lib/composer/store";
import McpActionToolField from "@/components/composer/McpActionToolField";
import { McpAssetToolAddRow, usedToolNamesForConnection } from "@/components/composer/AddMcpToolActionsPanel";
import { HelpPanelIntro } from "@/components/composer/HelpLabel";
import { helpForSection } from "@/lib/composer/help/section-help-catalog";
import { Button, KindBadge, TextField } from "@/components/composer/ui";

interface ActionGroup {
  connectionName: string;
  asset?: ImportedAsset;
  actions: BrokerAction[];
}

function groupActionsByAsset(project: ComposerProject, broker: Broker): ActionGroup[] {
  const byConnection = new Map<string, BrokerAction[]>();
  for (const action of broker.actions) {
    const list = byConnection.get(action.connectionName) ?? [];
    list.push(action);
    byConnection.set(action.connectionName, list);
  }

  const groups: ActionGroup[] = [];
  const seen = new Set<string>();

  for (const asset of project.assets) {
    if (asset.kind === "llm") continue;
    const connectionName = connectionNameForAsset(asset);
    const actions = byConnection.get(connectionName) ?? [];
    groups.push({ connectionName, asset, actions });
    seen.add(connectionName);
  }

  for (const [connectionName, actions] of byConnection) {
    if (seen.has(connectionName)) continue;
    groups.push({
      connectionName,
      asset: assetByConnectionName(project, connectionName),
      actions,
    });
  }

  return groups;
}

function actionSummary(actions: BrokerAction[]): string {
  if (actions.length === 0) return "No actions";
  if (actions.length === 1) return actions[0].name;
  const mcpTools = actions.filter((a) => a.actionKind === "mcp:tool" && a.toolName).map((a) => a.toolName!);
  if (mcpTools.length > 0) return `${actions.length} actions · ${mcpTools.slice(0, 3).join(", ")}${mcpTools.length > 3 ? "…" : ""}`;
  return `${actions.length} actions`;
}

function ActionRow({
  action,
  broker,
  project,
}: {
  action: BrokerAction;
  broker: Broker;
  project: ComposerProject;
}) {
  const { dispatch } = useComposer();
  const asset = assetByConnectionName(project, action.connectionName);

  return (
    <div className="space-y-2 rounded-md border border-gray-100 bg-white p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-gray-500">{action.actionKind}</span>
        <Button variant="danger" className="h-7 px-2" onClick={() => dispatch({ type: "removeAction", id: action.id })}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <TextField
        label="Action name"
        value={action.name}
        onChange={(v) => dispatch({ type: "updateAction", id: action.id, patch: { name: v } })}
        mono
      />
      {action.actionKind === "mcp:tool" && (
        <McpActionToolField
          action={action}
          asset={asset}
          organizationId={project.identity.organizationId}
          excludedToolNames={usedToolNamesForConnection(broker, action.connectionName, action.id)}
          onToolNameChange={(toolName) =>
            dispatch({ type: "updateAction", id: action.id, patch: { toolName: toolName || undefined } })
          }
          onMetaFetched={(meta) => {
            if (asset) {
              dispatch({ type: "updateAsset", id: asset.id, patch: { meta } });
            }
          }}
        />
      )}
    </div>
  );
}

function ActionAssetCard({
  group,
  broker,
  project,
}: {
  group: ActionGroup;
  broker: Broker;
  project: ComposerProject;
}) {
  const [expanded, setExpanded] = useState(false);
  const { asset, connectionName, actions } = group;
  const kind: AssetKind = asset?.kind ?? (actions[0]?.actionKind === "mcp:tool" ? "mcp" : "agent");
  const title = asset?.name ?? connectionName;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 bg-gray-50 px-2 py-2 text-left transition-colors hover:bg-gray-100"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
        )}
        <KindBadge kind={kind} />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900">{title}</span>
          <span className="block truncate font-mono text-[11px] text-gray-400">{connectionName}</span>
          {!expanded ? (
            <span className="block truncate text-[11px] text-gray-500">{actionSummary(actions)}</span>
          ) : null}
        </div>
        <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-600">
          {actions.length}
        </span>
      </button>
      {expanded ? (
        <div className="space-y-2 border-t border-gray-200 bg-gray-50/40 p-2">
          {actions.length === 0 ? (
            <p className="text-xs text-gray-400">No actions for this asset yet.</p>
          ) : (
            actions.map((action) => (
              <ActionRow key={action.id} action={action} broker={broker} project={project} />
            ))
          )}
          {asset?.kind === "mcp" ? (
            <div className="rounded-md border border-dashed border-gray-200 bg-white p-2">
              <McpAssetToolAddRow
                asset={asset}
                broker={broker}
                organizationId={project.identity.organizationId}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function BrokerActionsPanel({
  project,
  broker,
}: {
  project: ComposerProject;
  broker: Broker;
}) {
  const groups = useMemo(() => groupActionsByAsset(project, broker), [project, broker]);
  const hasActionableAssets = groups.length > 0;

  if (!hasActionableAssets && broker.actions.length === 0) {
    return <p className="text-xs text-gray-400">No actions yet. Compose agents or MCP servers under Exchange Assets.</p>;
  }

  return (
    <div className="space-y-2">
      <HelpPanelIntro help={helpForSection("panel.actions")} />
      {groups.map((group, index) => (
        <ActionAssetCard
          key={group.connectionName}
          group={group}
          broker={broker}
          project={project}
        />
      ))}
    </div>
  );
}
