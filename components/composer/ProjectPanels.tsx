"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpen, ChevronDown, ChevronRight, ExternalLink, Trash2 } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import { MuleIcon } from "@/components/composer/MuleIcon";
import { connectionNameForAsset, toIdentifier, variableGroupForAsset, type Broker, type ImportedAsset, type YamlNetworkInfo } from "@/lib/composer/model";
import { BROKER_KEY_HINT, normalizeBrokerKey } from "@/lib/composer/broker-key";
import AssetPicker from "@/components/composer/AssetPicker";
import BrokerActionsPanel from "@/components/composer/BrokerActionsPanel";
import AgentNetworkYamlSchemaDialog from "@/components/composer/AgentNetworkYamlSchemaDialog";
import A2aCardSchemaDialog from "@/components/composer/A2aCardSchemaDialog";
import { ConnectionAuthEditor } from "@/components/composer/ConnectionAuthEditor";
import { ConnectionExtrasEditor } from "@/components/composer/ConnectionExtrasEditor";
import { BrokerCardEditor } from "@/components/composer/BrokerCardEditor";
import A2aCardLivePreview from "@/components/composer/A2aCardLivePreview";
import { VariablesPanel } from "@/components/composer/VariablesPanel";
import { HelpPanelIntro } from "@/components/composer/HelpLabel";
import { helpForSection } from "@/lib/composer/help/section-help-catalog";
import { createBroker } from "@/lib/composer/factory";
import { instructionTextForEditor } from "@/lib/composer/instruction-text";
import { PolicyBindingsPanel } from "@/components/composer/PolicyBindingsPanel";
import type { DeclaredPolicyBinding } from "@/lib/composer/connectivity/policy-bindings-zod";
import { useExchangePolicies, type ExchangePolicyCatalog } from "@/components/composer/useExchangePolicies";
import { filterPolicyCatalogForAssetKind, filterPolicyCatalogForBroker } from "@/lib/mulesoft/policy-catalog-filter";
import ExchangeJsonSchemaDialog from "@/components/composer/ExchangeJsonSchemaDialog";
import { Button, KindBadge, SelectField, TextArea, TextField } from "@/components/composer/ui";

export type PanelTab =
  | "identity"
  | "assets"
  | "variables"
  | "a2a-card"
  | "access"
  | "llms"
  | "actions"
  | "behavior"
  | "graph";

interface TabGroup {
  title: string;
  hint: string;
  tabs: Array<{ id: PanelTab; label: string }>;
}

export const PANEL_TAB_GROUPS: TabGroup[] = [
  {
    title: "Agent network",
    hint: "",
    tabs: [
      { id: "identity", label: "Project" },
      { id: "assets", label: "Exchange Assets" },
      { id: "variables", label: "Variables" },
    ],
  },
  {
    title: "Broker",
    hint: "",
    tabs: [
      { id: "access", label: "A2A Interface" },
      { id: "a2a-card", label: "A2A card" },
      { id: "behavior", label: "AS Instructions" },
      { id: "llms", label: "AS LLM" },
      { id: "actions", label: "AS Actions" },
      { id: "graph", label: "AS Graph" },
    ],
  },
];

const BROKER_TABS: PanelTab[] = ["access", "a2a-card", "behavior", "llms", "actions", "graph"];

export function isBrokerPanelTab(tab: PanelTab): boolean {
  return BROKER_TABS.includes(tab);
}

export function isGraphPanelTab(tab: PanelTab): boolean {
  return tab === "graph";
}

const tabBtn =
  "w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors";
const tabActive = "bg-primary/10 text-primary";
const tabIdle = "text-gray-600 hover:bg-gray-100";

export function ComposerNav({
  tab,
  onTabChange,
}: {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
}) {
  return (
    <nav className="flex h-full w-[176px] shrink-0 flex-col space-y-3 overflow-y-auto border-r border-gray-200 bg-white px-2 py-2.5">
      {PANEL_TAB_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {group.title}
          </p>
          {group.hint ? <p className="mb-1 px-2 text-[10px] text-gray-400">{group.hint}</p> : null}
          <div className="space-y-0.5">
            {group.tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onTabChange(t.id)}
                className={`${tabBtn} flex items-center gap-2 ${tab === t.id ? tabActive : tabIdle}`}
              >
                <MuleIcon tab={t.id} size={14} className="opacity-80" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function panelTitle(tab: PanelTab): string {
  for (const group of PANEL_TAB_GROUPS) {
    const match = group.tabs.find((t) => t.id === tab);
    if (match) return match.label;
  }
  return tab;
}

function tagsToDraft(tags: string[]): string {
  return tags.join(", ");
}

function parseTagsDraft(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function hasYamlInfoContent(yamlInfo: YamlNetworkInfo | undefined): boolean {
  if (!yamlInfo) return false;
  return Boolean(
    yamlInfo.description?.trim() ||
      yamlInfo.summary?.trim() ||
      (yamlInfo.tags && yamlInfo.tags.length > 0)
  );
}

function YamlInfoSection({
  yamlInfo,
  onPatch,
}: {
  yamlInfo: YamlNetworkInfo | undefined;
  onPatch: (yamlInfo: YamlNetworkInfo) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-md border border-gray-200">
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
        <div className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            YAML info (agent-network.yaml)
          </span>
          {!expanded ? (
            <span className="block truncate text-[11px] text-gray-400">
              {hasYamlInfoContent(yamlInfo)
                ? "Optional NetworkInfoObject fields configured"
                : "Optional description, summary, tags for yaml info.*"}
            </span>
          ) : null}
        </div>
      </button>
      {expanded ? (
        <div className="space-y-2 border-t border-gray-200 p-2">
          <p className="text-[11px] text-gray-400">
            Optional NetworkInfoObject fields beyond label and version. Separate from exchange.json description and tags.
          </p>
          <TextArea
            label="YAML description"
            value={yamlInfo?.description ?? ""}
            onChange={(v) =>
              onPatch({
                ...yamlInfo,
                description: v || undefined,
              })
            }
            rows={2}
          />
          <TextField
            label="YAML summary"
            value={yamlInfo?.summary ?? ""}
            onChange={(v) =>
              onPatch({
                ...yamlInfo,
                summary: v || undefined,
              })
            }
          />
          <TagsField
            label="YAML tags"
            tags={yamlInfo?.tags ?? []}
            onChange={(yamlTags) =>
              onPatch({
                ...yamlInfo,
                tags: yamlTags.length > 0 ? yamlTags : undefined,
              })
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function TagsField({
  label = "Tags",
  tags,
  onChange,
}: {
  label?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState(() => tagsToDraft(tags));

  useEffect(() => {
    setDraft(tagsToDraft(tags));
  }, [tags]);

  function commit() {
    const parsed = parseTagsDraft(draft);
    onChange(parsed);
    setDraft(tagsToDraft(parsed));
  }

  return (
    <TextField
      label={label}
      value={draft}
      onChange={setDraft}
      onBlur={commit}
      hint="Comma-separated tags (exchange.json tags array). Commits when you leave the field."
    />
  );
}

function AssetCard({
  asset,
  organizationId,
  policyCatalog,
  policyBindings,
  policiesLoading,
  policiesError,
  onUpdate,
  onRemove,
  onEnsurePolicyBinding,
  onUpdatePolicyBinding,
}: {
  asset: ImportedAsset;
  organizationId: string;
  policyCatalog: ExchangePolicyCatalog;
  policyBindings: Record<string, DeclaredPolicyBinding>;
  policiesLoading: boolean;
  policiesError: string | null;
  onUpdate: (patch: Partial<ImportedAsset>) => void;
  onRemove: () => void;
  onEnsurePolicyBinding: (bindingName: string, binding: DeclaredPolicyBinding) => void;
  onUpdatePolicyBinding: (bindingName: string, patch: Partial<DeclaredPolicyBinding>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const filteredPolicyCatalog = useMemo(
    () => filterPolicyCatalogForAssetKind(policyCatalog, asset.kind),
    [policyCatalog, asset.kind]
  );

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <div className="flex items-center bg-gray-50">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-gray-100"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          )}
          <KindBadge kind={asset.kind} />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-gray-900">{asset.name}</span>
            <span className="block truncate font-mono text-[11px] text-gray-400">
              {asset.groupId} / {asset.assetId} / {asset.version}
            </span>
          </div>
        </button>
        <Button variant="danger" className="mr-2 shrink-0" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {expanded ? (
        <div className="space-y-2 border-t border-gray-200 p-2">
          <TextField
            label="Base name"
            value={asset.baseName}
            onChange={(v) => onUpdate({ baseName: v })}
            mono
            hint={`Connection: ${connectionNameForAsset(asset)}`}
          />
          <TextField
            label="Default URL"
            value={asset.url ?? ""}
            onChange={(v) => onUpdate({ url: v })}
            mono
          />
          <ConnectionAuthEditor
            asset={asset}
            onChange={(authentication) => onUpdate({ authentication })}
          />
          <ConnectionExtrasEditor
            organizationId={organizationId}
            variableGroup={variableGroupForAsset(asset)}
            access={asset.access}
            policies={asset.policies}
            policyCatalog={filteredPolicyCatalog}
            policyBindings={policyBindings}
            policiesLoading={policiesLoading}
            policiesError={policiesError}
            onAccessChange={(access) => onUpdate({ access })}
            onPoliciesChange={(policies) => onUpdate({ policies })}
            onEnsurePolicyBinding={onEnsurePolicyBinding}
            onUpdatePolicyBinding={onUpdatePolicyBinding}
          />
        </div>
      ) : null}
    </div>
  );
}

function BrokerRequired({ broker, children }: { broker: Broker | undefined; children: ReactNode }) {
  if (!broker) {
    return <p className="text-xs text-gray-400">No broker configured yet.</p>;
  }
  return children;
}

function SchemaDocLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      <BookOpen className="h-3 w-3" />
      {label}
    </button>
  );
}

export function ComposerPanelContent({ tab }: { tab: PanelTab }) {
  const { project, dispatch } = useComposer();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [schemaDialog, setSchemaDialog] = useState<"exchange" | "yaml" | "a2a-card" | null>(null);
  const broker = project.brokers[0];
  const {
    catalog: policyCatalog,
    loading: policiesLoading,
    error: policiesError,
  } = useExchangePolicies(
    tab === "assets" || tab === "access" ? project.identity.organizationId : undefined
  );
  const brokerPolicyCatalog = useMemo(
    () => filterPolicyCatalogForBroker(policyCatalog),
    [policyCatalog]
  );

  return (
    <>
      <div className="flex h-full min-w-0 flex-col bg-white">
        <div className="shrink-0 border-b border-gray-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-gray-900">{panelTitle(tab)}</h2>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          {tab === "identity" && (
            <>
              <p className="text-xs text-gray-400">
                Maps to{" "}
                <SchemaDocLink label="exchange.json" onClick={() => setSchemaDialog("exchange")} />
                {" "}(identity, dependencies) and{" "}
                <SchemaDocLink label="agent-network.yaml" onClick={() => setSchemaDialog("yaml")} />
                {" "}(info.label, info.version).
              </p>
              <TextField label="Network name" value={project.identity.name} onChange={(v) => dispatch({ type: "setIdentity", patch: { name: v } })} />
              <TextField label="Organization id (groupId)" value={project.identity.organizationId} onChange={(v) => dispatch({ type: "setIdentity", patch: { organizationId: v } })} mono />
              <TextField label="Asset id" value={project.identity.assetId} onChange={(v) => dispatch({ type: "setIdentity", patch: { assetId: v } })} mono />
              <TextField label="Version" value={project.identity.version} onChange={(v) => dispatch({ type: "setIdentity", patch: { version: v } })} mono hint="Asset semver (GAV version)." />
              <TextField
                label="API version"
                value={project.identity.apiVersion}
                onChange={(v) => dispatch({ type: "setIdentity", patch: { apiVersion: v } })}
                mono
                hint="Exchange version group for publish/deploy (e.g. v2.0). Not yaml info.version."
              />
              <TextField
                label="Descriptor version"
                value={project.identity.descriptorVersion}
                onChange={(v) => dispatch({ type: "setIdentity", patch: { descriptorVersion: v } })}
                mono
                hint="exchange.json descriptor format version."
              />
              <TextArea
                label="Description"
                value={project.identity.description ?? ""}
                onChange={(v) => dispatch({ type: "setIdentity", patch: { description: v || undefined } })}
                rows={2}
                hint="Optional project description in exchange.json."
              />
              <TagsField
                tags={project.identity.tags ?? []}
                onChange={(tags) => dispatch({ type: "setIdentity", patch: { tags } })}
              />
              <YamlInfoSection
                yamlInfo={project.identity.yamlInfo}
                onPatch={(yamlInfo) => dispatch({ type: "setIdentity", patch: { yamlInfo } })}
              />
            </>
          )}

          {tab === "a2a-card" && (
            <BrokerRequired broker={broker}>
              {broker && (
                <div className="flex flex-col gap-4 xl:flex-row">
                  <div className="min-w-0 flex-1 space-y-3">
                    <p className="text-xs text-gray-400">
                      Step 2 — public contract. Maps to{" "}
                      <SchemaDocLink label="agent-network.yaml" onClick={() => setSchemaDialog("yaml")} />
                      {" "}
                      <span className="font-mono">brokers.*.interfaces.a2a.card</span>. Define what clients discover
                      before wiring LLMs, actions, or the graph.
                    </p>
                    <TextField
                      label="Broker key"
                      value={broker.name}
                      onChange={(v) => dispatch({ type: "updateBroker", patch: { name: v } })}
                      onBlur={() => {
                        const normalized = normalizeBrokerKey(broker.name, "broker");
                        if (normalized !== broker.name) {
                          dispatch({ type: "updateBroker", patch: { name: normalized } });
                        }
                      }}
                      hint={`Yaml brokers map key, config.agent_name, and .agent filename. ${BROKER_KEY_HINT}`}
                      mono
                    />
                    <div className="flex items-center justify-end">
                      <SchemaDocLink label="A2A card schema" onClick={() => setSchemaDialog("a2a-card")} />
                    </div>
                    <BrokerCardEditor
                      card={broker.card}
                      onChange={(patch) => dispatch({ type: "updateCard", patch })}
                    />
                  </div>
                  <div className="w-full shrink-0 self-start xl:sticky xl:top-0 xl:w-[380px]">
                    <A2aCardLivePreview
                      card={broker.card}
                      onReset={() => {
                        const defaults = createBroker(broker.name).card;
                        dispatch({
                          type: "updateCard",
                          patch: {
                            name: broker.card.name,
                            version: defaults.version,
                            description: undefined,
                            documentationUrl: undefined,
                            iconUrl: undefined,
                            provider: undefined,
                            capabilities: defaults.capabilities,
                            defaultInputModes: defaults.defaultInputModes,
                            defaultOutputModes: defaults.defaultOutputModes,
                            skills: [],
                            supportedInterfaces: undefined,
                            extra: broker.card.extra,
                          },
                        });
                      }}
                    />
                  </div>
                </div>
              )}
            </BrokerRequired>
          )}

          {tab === "access" && (
            <BrokerRequired broker={broker}>
              {broker && (
                <>
                  <HelpPanelIntro help={helpForSection("panel.a2aInterface")}>
                    <p className="mt-2 text-[11px] text-gray-500">
                      Maps to <span className="font-mono">brokers.*.interfaces.a2a.policies</span> in{" "}
                      <SchemaDocLink label="agent-network.yaml" onClick={() => setSchemaDialog("yaml")} />.
                    </p>
                  </HelpPanelIntro>
                  <PolicyBindingsPanel
                    organizationId={project.identity.organizationId}
                    variableGroup={broker.name}
                    policies={broker.interfacePolicies}
                    policyCatalog={brokerPolicyCatalog}
                    policyBindings={project.policyBindings}
                    policiesLoading={policiesLoading}
                    policiesError={policiesError}
                    onPoliciesChange={(interfacePolicies) =>
                      dispatch({ type: "updateBroker", patch: { interfacePolicies } })
                    }
                    onEnsurePolicyBinding={(bindingName, binding) =>
                      dispatch({ type: "ensurePolicyBinding", bindingName, binding })
                    }
                    onUpdatePolicyBinding={(bindingName, patch) =>
                      dispatch({ type: "updatePolicyBinding", bindingName, patch })
                    }
                  />
                </>
              )}
            </BrokerRequired>
          )}

          {tab === "behavior" && (
            <BrokerRequired broker={broker}>
              {broker && (
                <>
                  <HelpPanelIntro help={helpForSection("panel.brokerBehavior")}>
                    <p className="mt-2 text-[11px] text-gray-500">
                      Maps to <span className="font-mono">system.instructions</span> in{" "}
                      <span className="font-mono">brokers/*.agent</span>.
                    </p>
                  </HelpPanelIntro>
                  <TextArea
                    label="System instructions"
                    value={instructionTextForEditor(broker.systemInstructions)}
                    onChange={(v) => dispatch({ type: "updateBroker", patch: { systemInstructions: v } })}
                    rows={5}
                    help={helpForSection("field.systemInstructions")}
                    placeholder="Global broker persona applied when LLM nodes run."
                    hint="Default persona for all LLM nodes unless a node overrides system.instructions."
                  />
                </>
              )}
            </BrokerRequired>
          )}

          {tab === "assets" && (
            <>
              <p className="text-xs text-gray-400">
                Composed agents, MCP servers, and LLM providers. Maps to{" "}
                <SchemaDocLink label="agent-network.yaml" onClick={() => setSchemaDialog("yaml")} />
                {" "}
                <span className="font-mono">context.connections</span> and{" "}
                <SchemaDocLink label="exchange.json" onClick={() => setSchemaDialog("exchange")} />
                {" "}
                <span className="font-mono">dependencies[]</span>.
              </p>
              <Button variant="primary" className="w-full" onClick={() => setPickerOpen(true)}>
                <MuleIcon name="exchange" size={16} /> Compose from Exchange
              </Button>
              {project.assets.length === 0 && <p className="text-xs text-gray-400">No composed assets yet.</p>}
              <div className="space-y-2">
                {project.assets.map((a) => (
                  <AssetCard
                    key={a.id}
                    asset={a}
                    organizationId={project.identity.organizationId}
                    policyCatalog={policyCatalog}
                    policyBindings={project.policyBindings}
                    policiesLoading={policiesLoading}
                    policiesError={policiesError}
                    onUpdate={(patch) => dispatch({ type: "updateAsset", id: a.id, patch })}
                    onRemove={() => dispatch({ type: "removeAsset", id: a.id })}
                    onEnsurePolicyBinding={(bindingName, binding) =>
                      dispatch({ type: "ensurePolicyBinding", bindingName, binding })
                    }
                    onUpdatePolicyBinding={(bindingName, patch) =>
                      dispatch({ type: "updatePolicyBinding", bindingName, patch })
                    }
                  />
                ))}
              </div>
            </>
          )}

          {tab === "actions" && (
            <BrokerRequired broker={broker}>
              {broker && (
                <>
                  <p className="text-xs text-gray-400">
                    Step 5 — tools and sub-agents this broker can invoke, grouped by composed asset. MCP servers get
                    one action per tool from Exchange mcp-metadata.json. Referenced from graph nodes as{" "}
                    <span className="font-mono">@actions.&lt;name&gt;</span>.
                  </p>
                  <BrokerActionsPanel project={project} broker={broker} />
                </>
              )}
            </BrokerRequired>
          )}

          {tab === "llms" && (
            <BrokerRequired broker={broker}>
              {broker && (
                <>
                  <p className="text-xs text-gray-400">
                    Step 4 — LLM connections for reasoning. Compose the provider under Exchange Assets first, then bind provider
                    and model here. Referenced from graph nodes as{" "}
                    <span className="font-mono">@llm.&lt;name&gt;</span>.
                  </p>
                  <SelectField
                    label="Default LLM"
                    value={broker.defaultLlmBindingName ?? ""}
                    options={[
                      { value: "", label: "(none)" },
                      ...broker.llmBindings.map((b) => ({ value: b.name, label: b.name })),
                    ]}
                    onChange={(v) => dispatch({ type: "setDefaultLlm", bindingName: v || undefined })}
                    hint={
                      broker.llmBindings.length === 0
                        ? "Add a binding below first."
                        : "Written to config.default_llm — used when graph nodes do not specify an LLM."
                    }
                  />
                  {broker.llmBindings.length === 0 && (
                    <p className="text-xs text-gray-400">No LLM bindings yet. Compose an LLM under Exchange Assets first.</p>
                  )}
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
            </BrokerRequired>
          )}

          {tab === "variables" && <VariablesPanel />}
        </div>
      </div>

      {pickerOpen && <AssetPicker onClose={() => setPickerOpen(false)} />}
      {schemaDialog === "exchange" && (
        <ExchangeJsonSchemaDialog onClose={() => setSchemaDialog(null)} />
      )}
      {schemaDialog === "yaml" && (
        <AgentNetworkYamlSchemaDialog onClose={() => setSchemaDialog(null)} />
      )}
      {schemaDialog === "a2a-card" && (
        <A2aCardSchemaDialog onClose={() => setSchemaDialog(null)} />
      )}
    </>
  );
}
