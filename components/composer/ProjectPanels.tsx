"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import { connectionNameForAsset, deriveVariables } from "@/lib/composer/model";
import { Button, KindBadge, SelectField, TextArea, TextField } from "@/components/composer/ui";

type Tab = "identity" | "broker" | "assets" | "actions" | "llms" | "variables";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "identity", label: "Project" },
  { id: "broker", label: "Broker" },
  { id: "assets", label: "Assets" },
  { id: "actions", label: "Actions" },
  { id: "llms", label: "LLMs" },
  { id: "variables", label: "Variables" },
];

export default function ProjectPanels() {
  const { project, dispatch } = useComposer();
  const [tab, setTab] = useState<Tab>("identity");
  const broker = project.brokers[0];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap gap-1 border-b border-gray-200 px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded px-2 py-1 text-xs font-medium ${tab === t.id ? "bg-primary/10 text-primary" : "text-gray-500 hover:bg-gray-100"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {tab === "identity" && (
          <>
            <TextField label="Network name" value={project.identity.name} onChange={(v) => dispatch({ type: "setIdentity", patch: { name: v } })} />
            <TextField label="Organization id (groupId)" value={project.identity.organizationId} onChange={(v) => dispatch({ type: "setIdentity", patch: { organizationId: v } })} mono />
            <TextField label="Asset id" value={project.identity.assetId} onChange={(v) => dispatch({ type: "setIdentity", patch: { assetId: v } })} mono />
            <TextField label="Version" value={project.identity.version} onChange={(v) => dispatch({ type: "setIdentity", patch: { version: v } })} mono />
          </>
        )}

        {tab === "broker" && broker && (
          <>
            <TextField label="Broker name" value={broker.name} onChange={(v) => dispatch({ type: "updateBroker", patch: { name: v } })} hint="Used across the yaml key, config.agent_name and trigger target." />
            <div className="rounded-md border border-gray-200 p-2">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">A2A card (network front door)</p>
              <div className="space-y-2">
                <TextField label="Card name" value={broker.card.name} onChange={(v) => dispatch({ type: "updateCard", patch: { name: v } })} />
                <TextArea label="Card description" value={broker.card.description ?? ""} onChange={(v) => dispatch({ type: "updateCard", patch: { description: v } })} rows={2} />
                <TextField label="Card version" value={broker.card.version} onChange={(v) => dispatch({ type: "updateCard", patch: { version: v } })} mono />
              </div>
            </div>
            <TextArea label="System instructions" value={broker.systemInstructions ?? ""} onChange={(v) => dispatch({ type: "updateBroker", patch: { systemInstructions: v } })} rows={3} />
            <SelectField
              label="Default LLM"
              value={broker.defaultLlmBindingName ?? ""}
              options={[{ value: "", label: "(none)" }, ...broker.llmBindings.map((b) => ({ value: b.name, label: b.name }))]}
              onChange={(v) => dispatch({ type: "setDefaultLlm", bindingName: v || undefined })}
            />
          </>
        )}

        {tab === "assets" && (
          <>
            {project.assets.length === 0 && <p className="text-xs text-gray-400">No composed assets yet.</p>}
            {project.assets.map((a) => (
              <div key={a.id} className="space-y-2 rounded-md border border-gray-200 p-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KindBadge kind={a.kind} />
                    <span className="text-sm font-medium text-gray-900">{a.name}</span>
                  </div>
                  <Button variant="danger" onClick={() => dispatch({ type: "removeAsset", id: a.id })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="font-mono text-[11px] text-gray-400">{a.groupId} / {a.assetId} / {a.version}</p>
                <TextField label="Base name" value={a.baseName} onChange={(v) => dispatch({ type: "updateAsset", id: a.id, patch: { baseName: v } })} mono hint={`Connection: ${connectionNameForAsset(a)}`} />
                <TextField label="Default URL" value={a.url ?? ""} onChange={(v) => dispatch({ type: "updateAsset", id: a.id, patch: { url: v } })} mono />
                {(a.kind === "llm" || a.kind === "mcp") && (
                  <SelectField
                    label="Authentication"
                    value={a.auth?.kind ?? "none"}
                    options={[{ value: "none", label: "None" }, { value: "apiKey", label: "API key" }]}
                    onChange={(v) => dispatch({ type: "updateAsset", id: a.id, patch: { auth: { kind: v } } })}
                  />
                )}
              </div>
            ))}
          </>
        )}

        {tab === "actions" && broker && (
          <>
            <p className="text-xs text-gray-400">Auto-derived from composed agents/MCP. Editable.</p>
            {broker.actions.length === 0 && <p className="text-xs text-gray-400">No actions.</p>}
            {broker.actions.map((ac) => (
              <div key={ac.id} className="space-y-2 rounded-md border border-gray-200 p-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-gray-500">{ac.actionKind}</span>
                  <Button variant="danger" onClick={() => dispatch({ type: "removeAction", id: ac.id })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <TextField label="Action name" value={ac.name} onChange={(v) => dispatch({ type: "updateAction", id: ac.id, patch: { name: v } })} mono />
                <p className="font-mono text-[11px] text-gray-400">target: {ac.connectionName}</p>
                {ac.actionKind === "mcp:tool" && (
                  <TextField label="Tool name" value={ac.toolName ?? ""} onChange={(v) => dispatch({ type: "updateAction", id: ac.id, patch: { toolName: v } })} mono />
                )}
              </div>
            ))}
          </>
        )}

        {tab === "llms" && broker && (
          <>
            {broker.llmBindings.length === 0 && <p className="text-xs text-gray-400">No LLMs composed.</p>}
            {broker.llmBindings.map((b) => (
              <div key={b.id} className="space-y-2 rounded-md border border-gray-200 p-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-gray-500">{b.connectionName}</span>
                  <Button variant="danger" onClick={() => dispatch({ type: "removeLlmBinding", id: b.id })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <TextField label="Binding name" value={b.name} onChange={(v) => dispatch({ type: "updateLlmBinding", id: b.id, patch: { name: v } })} mono />
                <SelectField label="Provider" value={b.provider} options={[{ value: "OpenAI", label: "OpenAI" }, { value: "Gemini", label: "Gemini" }]} onChange={(v) => dispatch({ type: "updateLlmBinding", id: b.id, patch: { provider: v } })} />
                <TextField label="Model" value={b.model} onChange={(v) => dispatch({ type: "updateLlmBinding", id: b.id, patch: { model: v } })} mono />
              </div>
            ))}
          </>
        )}

        {tab === "variables" && (
          <>
            <p className="text-xs text-gray-400">Deploy-time variables, derived from connections.</p>
            {deriveVariables(project).map((v) => {
              const key = `${v.group}.${v.field}`;
              return (
                <div key={key} className="space-y-2 rounded-md border border-gray-200 p-2">
                  <p className="font-mono text-xs text-gray-700">${"{"}{key}{"}"} {v.secret ? <span className="text-red-500">(secret)</span> : null}</p>
                  <TextField
                    label="Description"
                    value={v.description ?? ""}
                    onChange={(nv) => dispatch({ type: "setVariableOverride", key, patch: { description: nv } })}
                  />
                  {!v.secret && (
                    <TextField
                      label="Default"
                      value={v.default ?? ""}
                      onChange={(nv) => dispatch({ type: "setVariableOverride", key, patch: { default: nv } })}
                      mono
                    />
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
