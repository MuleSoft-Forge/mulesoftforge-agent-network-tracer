"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { Broker, BrokerAction, ComposerProject, ImportedAsset, AssetKind } from "@/lib/composer/model";
import { assetByConnectionName, connectionNameForAsset } from "@/lib/composer/model";
import { actionInputsForMcpTool } from "@/lib/composer/mcp-action-inputs";
import { useComposer } from "@/lib/composer/store";
import McpActionToolField from "@/components/composer/McpActionToolField";
import { McpAssetToolAddRow, usedToolNamesForConnection } from "@/components/composer/AddMcpToolActionsPanel";
import { HelpPanelIntro } from "@/components/composer/HelpLabel";
import { helpForSection } from "@/lib/composer/help/section-help-catalog";
import { Button, KindBadge, SelectField, TextField } from "@/components/composer/ui";
import type { ActionInput } from "@/lib/composer/model";
import { AGENTSCRIPT_ACTION_INPUT_TYPES } from "@/lib/composer/agentscript-contract";

function actionInputDefault(value: string, type: string): ActionInput["default"] {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (type === "boolean") return trimmed === "true";
  if (["number", "integer", "long", "timestamp"].includes(type)) {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return value;
}

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

function ActionInputsEditor({
  inputs,
  onChange,
}: {
  inputs: ActionInput[];
  onChange: (next: ActionInput[] | undefined) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-md border border-dashed border-gray-200 bg-gray-50/80 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Inputs</p>
        <Button variant="ghost" onClick={() => onChange([...inputs, { name: "arg", type: "string" }])}>
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
      {inputs.map((inp, index) => (
        <div key={index} className="flex items-end gap-2">
          <div className="w-28 shrink-0">
            <TextField
              label="Name"
              value={inp.name}
              onChange={(value) => {
                const next = inputs.map((row, i) => (i === index ? { ...row, name: value } : row));
                onChange(next.length > 0 ? next : undefined);
              }}
              mono
            />
          </div>
          <div className="w-24 shrink-0">
            <SelectField
              label="Type"
              value={inp.type}
              onChange={(value) =>
                onChange(
                  inputs.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, type: value, default: undefined } : row
                  )
                )
              }
              options={AGENTSCRIPT_ACTION_INPUT_TYPES.map((type) => ({ value: type, label: type }))}
            />
          </div>
          <div className="min-w-0 flex-1">
            {inp.type === "boolean" ? (
              <SelectField
                label="Default"
                value={inp.default === undefined ? "" : String(inp.default)}
                options={[
                  { value: "", label: "(none)" },
                  { value: "true", label: "true" },
                  { value: "false", label: "false" },
                ]}
                onChange={(value) =>
                  onChange(
                    inputs.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, default: actionInputDefault(value, inp.type) }
                        : row
                    )
                  )
                }
              />
            ) : (
              <TextField
                label="Default"
                value={inp.default === undefined ? "" : String(inp.default)}
                onChange={(value) =>
                  onChange(
                    inputs.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, default: actionInputDefault(value, inp.type) }
                        : row
                    )
                  )
                }
                mono
                hint={
                  inp.type === "object"
                    ? 'AgentScript object expression, e.g. {"region": "EU"}.'
                    : undefined
                }
              />
            )}
          </div>
          <Button
            variant="danger"
            onClick={() => {
              const next = inputs.filter((_, i) => i !== index);
              onChange(next.length > 0 ? next : undefined);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
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
      <TextField
        label="Label"
        value={action.label ?? ""}
        onChange={(label) =>
          dispatch({
            type: "updateAction",
            id: action.id,
            patch: { label: label.trim() ? label : undefined },
          })
        }
      />
      <TextField
        label="Description"
        value={action.description ?? ""}
        onChange={(description) =>
          dispatch({
            type: "updateAction",
            id: action.id,
            patch: { description: description.trim() ? description : undefined },
          })
        }
      />
      {action.actionKind === "mcp:tool" ? (
        <ActionInputsEditor
          inputs={action.inputs ?? []}
          onChange={(inputs) =>
            dispatch({ type: "updateAction", id: action.id, patch: { inputs } })
          }
        />
      ) : null}
      {action.actionKind === "mcp:tool" && (
        <McpActionToolField
          action={action}
          asset={asset}
          organizationId={project.identity.organizationId}
          excludedToolNames={usedToolNamesForConnection(broker, action.connectionName, action.id)}
          onToolNameChange={(toolName) => {
            const inputs = asset && toolName ? actionInputsForMcpTool(asset, toolName) : undefined;
            dispatch({
              type: "updateAction",
              id: action.id,
              patch: {
                toolName: toolName || undefined,
                ...(inputs?.length ? { inputs } : toolName ? { inputs: undefined } : {}),
              },
            });
          }}
          onMetaFetched={(meta) => {
            if (asset) {
              dispatch({ type: "updateAsset", id: asset.id, patch: { meta } });
              if (action.toolName && !action.inputs?.length) {
                const inputs = actionInputsForMcpTool({ ...asset, meta }, action.toolName);
                if (inputs?.length) {
                  dispatch({ type: "updateAction", id: action.id, patch: { inputs } });
                }
              }
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
