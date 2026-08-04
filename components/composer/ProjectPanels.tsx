"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpen, ChevronDown, ChevronRight, ExternalLink, Trash2 } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import { validateProject } from "@/lib/composer/validate";
import { countIssuesByTab, type TabIssueCounts } from "@/lib/composer/issue-navigation";
import type { A2aCardFieldAnchor } from "@/lib/composer/a2a-card-field-anchors";
import type { ProjectFocusTarget } from "@/lib/composer/project-field-anchors";
import { PROJECT_ANCHOR } from "@/lib/composer/project-field-anchors";
import ProjectCompletenessPanel from "@/components/composer/ProjectCompletenessPanel";
import { MuleIcon } from "@/components/composer/MuleIcon";
import { connectionNameForAsset, exchangeDependencyAssets, toIdentifier, variableGroupForAsset, type Broker, type ImportedAsset, type YamlNetworkInfo } from "@/lib/composer/model";
import { BROKER_KEY_HINT, brokerKeyValidationMessage, isValidBrokerKey, normalizeBrokerKey } from "@/lib/composer/broker-key";
import {
  ANF_ID_HINT,
  anfIdValidationMessage,
  connectionIdForBaseName,
  isValidAnfId,
  normalizeAnfId,
} from "@/lib/composer/anf-id";
import { EXCHANGE_API_VERSION_FIELD_HINT, EXCHANGE_ASSET_VERSION_UI_DETAIL, EXCHANGE_API_VERSION_UI_DETAIL, EXCHANGE_DESCRIPTOR_VERSION_UI_DETAIL } from "@/lib/composer/docs/exchange-json-schema";
import {
  EXCHANGE_ASSET_ID_FIELD_HINT,
  exchangeAssetIdValidationMessage,
  isValidExchangeAssetId,
  normalizeExchangeAssetId,
  restrictExchangeAssetIdInput,
} from "@/lib/composer/exchange-asset-id";
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
import {
  defaultLlmBaseUrl,
  inferLlmPlatform,
  LLM_DEFAULT_BASE_URL_DOCS,
} from "@/lib/composer/connectivity/llm-default-urls";
import { instructionTextForEditor } from "@/lib/composer/instruction-text";
import { PolicyBindingsPanel } from "@/components/composer/PolicyBindingsPanel";
import type { DeclaredPolicyBinding } from "@/lib/composer/connectivity/policy-bindings-zod";
import { useExchangePolicies, type ExchangePolicyCatalog } from "@/components/composer/useExchangePolicies";
import { filterPolicyCatalogForAssetKind, filterPolicyCatalogForBroker } from "@/lib/mulesoft/policy-catalog-filter";
import ExchangeJsonSchemaDialog from "@/components/composer/ExchangeJsonSchemaDialog";
import { RegistryPanel } from "@/components/composer/RegistryPanel";
import ProjectSaveBar from "@/components/composer/ProjectSaveBar";
import { Button, Checkbox, FieldDetail, FormSection, HelpHint, KindBadge, SelectField, TextArea, TextField } from "@/components/composer/ui";

export type PanelTab =
  | "identity"
  | "registry"
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
      { id: "registry", label: "Registry" },
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
  "w-full rounded-anypoint px-2.5 py-1.5 text-left text-xs font-medium transition-anypoint";
const tabActive = "bg-primary/10 text-primary";
const tabIdle = "text-composer-label-muted hover:bg-composer-surface-muted";

/** Error/warning count for a tab, so problems are visible before opening it. */
function TabIssueBadge({ counts }: { counts: TabIssueCounts | undefined }) {
  if (!counts) return null;
  const isError = counts.errors > 0;
  const total = isError ? counts.errors : counts.warnings;
  if (total === 0) return null;
  return (
    <span
      title={
        isError
          ? `${counts.errors} error${counts.errors === 1 ? "" : "s"} on this tab`
          : `${counts.warnings} warning${counts.warnings === 1 ? "" : "s"} on this tab`
      }
      className={`ml-auto min-w-[1.125rem] rounded-full px-1 text-center text-[10px] font-semibold leading-[1.125rem] ${
        isError ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
      }`}
    >
      {total}
    </span>
  );
}

export function ComposerNav({
  tab,
  onTabChange,
}: {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
}) {
  const { project } = useComposer();
  const issueCounts = useMemo(() => countIssuesByTab(validateProject(project)), [project]);

  return (
    <nav className="flex h-full w-[176px] shrink-0 flex-col overflow-hidden border-r border-composer-border bg-composer-surface">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto scrollbar-thin px-2 py-2.5">
        {PANEL_TAB_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="px-2 text-xs font-semibold uppercase tracking-wide text-composer-label-muted">
              {group.title}
            </p>
            {group.hint ? <p className="mb-1 px-2 text-xs text-composer-label-muted">{group.hint}</p> : null}
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
                  <TabIssueBadge counts={issueCounts.get(t.id)} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <ProjectSaveBar />
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
      yamlInfo.termsOfService?.trim() ||
      yamlInfo.contact?.name?.trim() ||
      yamlInfo.contact?.url?.trim() ||
      yamlInfo.contact?.email?.trim() ||
      yamlInfo.license?.name?.trim() ||
      yamlInfo.license?.identifier?.trim() ||
      yamlInfo.license?.url?.trim() ||
      (yamlInfo.tags && yamlInfo.tags.length > 0)
  );
}

function FieldAnchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-4">
      {children}
    </div>
  );
}

function YamlInfoSection({
  yamlInfo,
  onPatch,
  forceExpanded,
}: {
  yamlInfo: YamlNetworkInfo | undefined;
  onPatch: (yamlInfo: YamlNetworkInfo) => void;
  forceExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOpen = forceExpanded || expanded;

  return (
    <div id={PROJECT_ANCHOR.yamlInfo} className="scroll-mt-4 overflow-hidden rounded-md border border-gray-200">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 bg-gray-50 px-2 py-2 text-left transition-colors hover:bg-gray-100"
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
        )}
        <div className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            YAML info (agent-network.yaml)
          </span>
          {!isOpen ? (
            <span className="block truncate text-[11px] text-gray-400">
              {hasYamlInfoContent(yamlInfo)
                ? "Optional NetworkInfoObject fields configured"
                : "Optional description, summary, tags for yaml info.*"}
            </span>
          ) : null}
        </div>
      </button>
      {isOpen ? (
        <div className="space-y-2 border-t border-gray-200 p-2">
          <HelpHint>
            Optional NetworkInfoObject fields beyond label and version. Separate from exchange.json description and tags.
          </HelpHint>
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
            help={helpForSection("field.projectYamlSummary")}
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
          <TextField
            label="Terms of service URL"
            value={yamlInfo?.termsOfService ?? ""}
            onChange={(v) =>
              onPatch({
                ...yamlInfo,
                termsOfService: v || undefined,
              })
            }
            mono
          />
          <div className="rounded border border-gray-100 bg-gray-50/80 p-2 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Contact</p>
            <TextField
              label="Contact name"
              value={yamlInfo?.contact?.name ?? ""}
              onChange={(v) =>
                onPatch({
                  ...yamlInfo,
                  contact: {
                    ...yamlInfo?.contact,
                    name: v || undefined,
                  },
                })
              }
            />
            <TextField
              label="Contact URL"
              value={yamlInfo?.contact?.url ?? ""}
              onChange={(v) =>
                onPatch({
                  ...yamlInfo,
                  contact: {
                    ...yamlInfo?.contact,
                    url: v || undefined,
                  },
                })
              }
              mono
            />
            <TextField
              label="Contact email"
              value={yamlInfo?.contact?.email ?? ""}
              onChange={(v) =>
                onPatch({
                  ...yamlInfo,
                  contact: {
                    ...yamlInfo?.contact,
                    email: v || undefined,
                  },
                })
              }
            />
          </div>
          <div className="rounded border border-gray-100 bg-gray-50/80 p-2 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">License</p>
            <TextField
              label="License name"
              value={yamlInfo?.license?.name ?? ""}
              onChange={(v) =>
                onPatch({
                  ...yamlInfo,
                  license: v
                    ? {
                        name: v,
                        ...(yamlInfo?.license?.identifier ? { identifier: yamlInfo.license.identifier } : {}),
                        ...(yamlInfo?.license?.url ? { url: yamlInfo.license.url } : {}),
                      }
                    : undefined,
                })
              }
            />
            <TextField
              label="License identifier (SPDX)"
              value={yamlInfo?.license?.identifier ?? ""}
              onChange={(v) => {
                const name = yamlInfo?.license?.name ?? "";
                if (!name.trim()) return;
                onPatch({
                  ...yamlInfo,
                  license: {
                    name,
                    ...(v ? { identifier: v } : {}),
                    ...(yamlInfo?.license?.url ? { url: yamlInfo.license.url } : {}),
                  },
                });
              }}
              hint="Mutually exclusive with license URL."
            />
            <TextField
              label="License URL"
              value={yamlInfo?.license?.url ?? ""}
              onChange={(v) => {
                const name = yamlInfo?.license?.name ?? "";
                if (!name.trim()) return;
                onPatch({
                  ...yamlInfo,
                  license: {
                    name,
                    ...(yamlInfo?.license?.identifier ? { identifier: yamlInfo.license.identifier } : {}),
                    ...(v ? { url: v } : {}),
                  },
                });
              }}
              mono
              hint="Mutually exclusive with SPDX identifier."
            />
          </div>
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
    <FieldAnchor id={PROJECT_ANCHOR.tags}>
      <TextField
        label={label}
        value={draft}
        onChange={setDraft}
        onBlur={commit}
        hint="Comma-separated tags (exchange.json tags array). Commits when you leave the field."
      />
    </FieldAnchor>
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
  const llmDefaultUrlHint = useMemo(() => {
    if (asset.kind !== "llm") return undefined;
    const platform = inferLlmPlatform({
      name: asset.name,
      assetId: asset.assetId,
      description: asset.description,
    });
    return `Per Agent Network spec (${platform}): ${defaultLlmBaseUrl(platform)}`;
  }, [asset.kind, asset.name, asset.assetId, asset.description]);

  return (
    <div id={`asset-${asset.id}`} className="scroll-mt-4 overflow-hidden rounded-lg border border-gray-200">
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
            onBlur={() => {
              const baseName = normalizeAnfId(asset.baseName, "asset");
              const patch: Partial<ImportedAsset> = { baseName };
              if (!asset.connectionName?.trim()) {
                patch.connectionName = connectionIdForBaseName(baseName);
              }
              onUpdate(patch);
            }}
            restrictAnfId
            mono
            hint="Snake_case stem for derived names."
          />
          <TextField
            label="Connection ID"
            value={connectionNameForAsset(asset)}
            onChange={(v) => onUpdate({ connectionName: v })}
            onBlur={() => {
              const normalized = normalizeAnfId(connectionNameForAsset(asset), "connection");
              if (normalized !== asset.connectionName) {
                onUpdate({ connectionName: normalized });
              }
            }}
            restrictAnfId
            mono
            error={
              isValidAnfId(connectionNameForAsset(asset))
                ? undefined
                : anfIdValidationMessage(connectionNameForAsset(asset), "Connection ID")
            }
            hint={`Yaml context.connections key. ${ANF_ID_HINT}`}
          />
          <TextField
            label="Default URL"
            value={asset.url ?? ""}
            onChange={(v) => onUpdate({ url: v })}
            mono
            hint={llmDefaultUrlHint}
            help={
              asset.kind === "llm"
                ? {
                    id: "field.llmDefaultUrl",
                    title: "LLM connection base URL",
                    tagline: "Deploy-time default for context.connections.url.",
                    whatItDoes:
                      "The base URL of the LLM provider. Serialized to exchange.json metadata.variables and referenced as ${group.url} in agent-network.yaml.",
                    whenToUse: ["OpenAI, Gemini, Azure OpenAI, or Bedrock OpenAI connections"],
                    docsUrl: LLM_DEFAULT_BASE_URL_DOCS,
                  }
                : undefined
            }
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

export function ComposerPanelContent({
  tab,
  pendingFocus,
  onFocusHandled,
  onProjectFocus,
}: {
  tab: PanelTab;
  pendingFocus?: ProjectFocusTarget | null;
  onFocusHandled?: () => void;
  onProjectFocus?: (target: ProjectFocusTarget) => void;
}) {
  const { project, dispatch } = useComposer();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [schemaDialog, setSchemaDialog] = useState<"exchange" | "yaml" | "a2a-card" | null>(null);
  const broker = project.brokers[0];
  const exchangeAssets = useMemo(() => exchangeDependencyAssets(project), [project]);
  const registryLocalAssetCount = project.assets.length - exchangeAssets.length;
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
  const gavCoordinate = useMemo(() => {
    const groupId = project.identity.organizationId?.trim() || "…";
    const assetId = project.identity.assetId?.trim() || "…";
    const version = project.identity.version?.trim() || "…";
    return `${groupId}:${assetId}:${version}`;
  }, [project.identity.organizationId, project.identity.assetId, project.identity.version]);

  useEffect(() => {
    if (!pendingFocus || pendingFocus.tab !== tab) return;

    const timer = window.setTimeout(() => {
      if (pendingFocus.anchor) {
        const el = document.getElementById(pendingFocus.anchor);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
          el.classList.add("ring-2", "ring-primary/30", "rounded-md");
          window.setTimeout(() => el.classList.remove("ring-2", "ring-primary/30", "rounded-md"), 1400);
        }
      }
      if (pendingFocus.assetId) {
        const el = document.getElementById(`asset-${pendingFocus.assetId}`);
        el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      onFocusHandled?.();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [pendingFocus, tab, onFocusHandled]);

  const a2aFocusAnchor =
    pendingFocus?.tab === "a2a-card" && pendingFocus.anchor
      ? (pendingFocus.anchor as A2aCardFieldAnchor)
      : null;

  return (
    <>
      <div className="flex h-full min-w-0 flex-col bg-composer-surface">
        <div className="shrink-0 border-b border-composer-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-gray-900">{panelTitle(tab)}</h2>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4 scrollbar-thin">
          {tab === "identity" && (
            <div className="flex flex-col gap-4 xl:flex-row">
              <div className="min-w-0 flex-1 space-y-6">
                <HelpHint className="text-xs text-gray-400">
                  Maps to{" "}
                  <SchemaDocLink label="exchange.json" onClick={() => setSchemaDialog("exchange")} />
                  {" "}(identity, dependencies) and{" "}
                  <SchemaDocLink label="agent-network.yaml" onClick={() => setSchemaDialog("yaml")} />
                  {" "}(info.label, info.version).
                </HelpHint>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FieldAnchor id={PROJECT_ANCHOR.organizationId}>
                      <TextField
                        label="Organization id (groupId)"
                        value={project.identity.organizationId}
                        onChange={() => {}}
                        readOnly
                        protected
                        mono
                        required
                        hint="Protected — set from the business group when you create or import. Return to the Builder landing page to change org."
                      />
                    </FieldAnchor>
                    <FieldAnchor id={PROJECT_ANCHOR.descriptorVersion}>
                      <TextField
                        label="Descriptor version"
                        value={project.identity.descriptorVersion}
                        onChange={() => {}}
                        readOnly
                        protected
                        mono
                        required
                        help={helpForSection("field.projectDescriptorVersion")}
                        hint="Protected — MuleSoft ExchangeDescriptor format version (default 1.0.0)."
                      />
                      <FieldDetail
                        title={EXCHANGE_DESCRIPTOR_VERSION_UI_DETAIL.title}
                        summary={EXCHANGE_DESCRIPTOR_VERSION_UI_DETAIL.summary}
                      >
                        <ul className="mt-1.5 list-disc space-y-1 pl-4">
                          {EXCHANGE_DESCRIPTOR_VERSION_UI_DETAIL.points.map((point) => (
                            <li key={point}>{point}</li>
                          ))}
                        </ul>
                      </FieldDetail>
                    </FieldAnchor>
                    <TextField
                      label="Exchange main"
                      value="agent-network.yaml"
                      onChange={() => {}}
                      readOnly
                      protected
                      mono
                      hint="Fixed entry point for Agent Network projects — always agent-network.yaml."
                    />
                    <TextField
                      label="Exchange classifier"
                      value="agentic-network"
                      onChange={() => {}}
                      readOnly
                      protected
                      mono
                      hint="Fixed Exchange classifier for Agent Network v2 projects."
                    />

                    <FieldAnchor id={PROJECT_ANCHOR.assetId}>
                      <TextField
                        label="Asset id"
                        value={project.identity.assetId}
                        onChange={(v) =>
                          dispatch({ type: "setIdentity", patch: { assetId: restrictExchangeAssetIdInput(v) } })
                        }
                        onBlur={() => {
                          const normalized = normalizeExchangeAssetId(project.identity.assetId, "agent-network");
                          if (normalized !== project.identity.assetId) {
                            dispatch({ type: "setIdentity", patch: { assetId: normalized } });
                          }
                        }}
                        mono
                        required
                        error={
                          isValidExchangeAssetId(project.identity.assetId)
                            ? undefined
                            : exchangeAssetIdValidationMessage(project.identity.assetId)
                        }
                        hint={EXCHANGE_ASSET_ID_FIELD_HINT}
                        alwaysShowHint
                      />
                    </FieldAnchor>
                    <FieldAnchor id={PROJECT_ANCHOR.name}>
                      <TextField
                        label="Network name"
                        value={project.identity.name}
                        onChange={(v) => dispatch({ type: "setIdentity", patch: { name: v } })}
                        required
                        help={helpForSection("field.projectNetworkName")}
                        hint="Human-readable label (exchange.json name and agent-network.yaml info.label)."
                        alwaysShowHint
                      />
                    </FieldAnchor>

                    <FieldAnchor id={PROJECT_ANCHOR.version}>
                      <TextField
                        label="Version"
                        value={project.identity.version}
                        onChange={(v) => dispatch({ type: "setIdentity", patch: { version: v } })}
                        mono
                        required
                        help={helpForSection("field.projectVersion")}
                        hint={EXCHANGE_ASSET_VERSION_UI_DETAIL.summary}
                        alwaysShowHint
                      />
                    </FieldAnchor>
                    <FieldAnchor id={PROJECT_ANCHOR.apiVersion}>
                      <TextField
                        label="Version group"
                        value={project.identity.apiVersion}
                        onChange={(v) => dispatch({ type: "setIdentity", patch: { apiVersion: v } })}
                        mono
                        required
                        help={helpForSection("field.projectApiVersion")}
                        hint={EXCHANGE_API_VERSION_FIELD_HINT}
                        alwaysShowHint
                      />
                      <FieldDetail title={EXCHANGE_API_VERSION_UI_DETAIL.title}>
                        <ul className="mt-1.5 list-disc space-y-1 pl-4">
                          {EXCHANGE_API_VERSION_UI_DETAIL.points.map((point) => (
                            <li key={point}>{point}</li>
                          ))}
                        </ul>
                      </FieldDetail>
                    </FieldAnchor>

                    <div className="sm:col-span-2">
                      <FieldDetail title={EXCHANGE_ASSET_VERSION_UI_DETAIL.title}>
                        <p className="mt-1.5">
                          Current GAV coordinate:{" "}
                          <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px] text-gray-800">
                            {gavCoordinate}
                          </code>
                        </p>
                        <ul className="mt-1.5 list-disc space-y-1 pl-4">
                          {EXCHANGE_ASSET_VERSION_UI_DETAIL.points.map((point) => (
                            <li key={point}>{point}</li>
                          ))}
                        </ul>
                      </FieldDetail>
                    </div>
                </div>

                <FormSection
                  title="Optional metadata"
                  description="Enrich the Exchange listing and yaml NetworkInfoObject. Omitted fields are not written to export files."
                >
                  <FieldAnchor id={PROJECT_ANCHOR.description}>
                    <TextArea
                      label="Description"
                      value={project.identity.description ?? ""}
                      onChange={(v) => dispatch({ type: "setIdentity", patch: { description: v || undefined } })}
                      rows={2}
                      hint="Project description in exchange.json."
                    />
                  </FieldAnchor>
                  <TagsField
                    tags={project.identity.tags ?? []}
                    onChange={(tags) => dispatch({ type: "setIdentity", patch: { tags } })}
                  />
                  <YamlInfoSection
                    yamlInfo={project.identity.yamlInfo}
                    onPatch={(yamlInfo) => dispatch({ type: "setIdentity", patch: { yamlInfo } })}
                    forceExpanded={pendingFocus?.anchor === PROJECT_ANCHOR.yamlInfo}
                  />
                </FormSection>
              </div>
              <div className="w-full shrink-0 self-start xl:sticky xl:top-0 xl:w-[380px]">
                <ProjectCompletenessPanel project={project} onFocus={onProjectFocus} />
              </div>
            </div>
          )}

          {tab === "registry" && (
            <RegistryPanel pendingFocus={pendingFocus} onFocusHandled={onFocusHandled} />
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
                      restrictAnfId
                      error={
                        isValidBrokerKey(broker.name) ? undefined : brokerKeyValidationMessage(broker.name)
                      }
                      hint={`Yaml brokers map key, config.agent_name, and .agent filename. ${BROKER_KEY_HINT}`}
                      mono
                    />
                    <div className="flex items-center justify-end">
                      <SchemaDocLink label="A2A card schema" onClick={() => setSchemaDialog("a2a-card")} />
                    </div>
                    <BrokerCardEditor
                      card={broker.card}
                      focusAnchor={a2aFocusAnchor}
                      onFocusAnchorHandled={onFocusHandled}
                      onChange={(patch) => dispatch({ type: "updateCard", patch })}
                    />
                  </div>
                  <div className="w-full shrink-0 self-start xl:sticky xl:top-0 xl:w-[380px]">
                    <A2aCardLivePreview
                      card={broker.card}
                      onFocusField={(anchor) => onProjectFocus?.({ tab: "a2a-card", anchor })}
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
                      Maps to <span className="font-mono">brokers.*.interfaces.&lt;name&gt;.policies</span> in{" "}
                      <SchemaDocLink label="agent-network.yaml" onClick={() => setSchemaDialog("yaml")} />.
                    </p>
                  </HelpPanelIntro>
                  <SelectField
                    label="Broker interface key"
                    uppercaseLabel
                    value={broker.interfaceName}
                    options={[
                      { value: "a2a", label: "a2a (v1.x Agent Card)" },
                      { value: "a2a_v03", label: "a2a_v03 (v0.3.x Agent Card)" },
                    ]}
                    onChange={(interfaceName) =>
                      dispatch({ type: "updateBroker", patch: { interfaceName } })
                    }
                    hint="Yaml brokers.*.interfaces map key. Card schema is preserved on round-trip for either version."
                  />
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
                      Maps to <span className="font-mono">system.instructions</span>,{" "}
                      <span className="font-mono">config.label</span>, and{" "}
                      <span className="font-mono">config.description</span> in{" "}
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
                  <TextField
                    label="Agent dialect version"
                    value={broker.agentDialectVersion ?? ""}
                    onChange={(v) => dispatch({ type: "updateBroker", patch: { agentDialectVersion: v.trim() || undefined } })}
                    mono
                    help={helpForSection("field.agentDialectVersion")}
                    hint="File header: # @dialect: AGENTFABRIC=x.y (default 1.0 when blank)."
                  />
                  <TextField
                    label="Config label"
                    value={broker.agentConfigLabel ?? ""}
                    onChange={(v) => dispatch({ type: "updateBroker", patch: { agentConfigLabel: v.trim() || undefined } })}
                    help={helpForSection("field.agentConfigLabel")}
                    hint="Optional config.label — not the A2A card name."
                  />
                  <TextArea
                    label="Config description"
                    value={broker.agentConfigDescription ?? ""}
                    onChange={(v) => dispatch({ type: "updateBroker", patch: { agentConfigDescription: v.trim() || undefined } })}
                    rows={2}
                    help={helpForSection("field.agentConfigDescription")}
                    hint="Optional config.description — not the A2A card description."
                  />
                </>
              )}
            </BrokerRequired>
          )}

          {tab === "assets" && (
            <>
              <p className="text-xs text-gray-400">
                Published Exchange dependencies only — each entry becomes{" "}
                <span className="font-mono">exchange.json dependencies[]</span> and a yaml{" "}
                <span className="font-mono">context.connections</span> entry. Registry-local connections
                belong on the Registry tab, not here.
              </p>
              <Button variant="primary" className="w-full" onClick={() => setPickerOpen(true)}>
                <MuleIcon name="exchange" size={16} /> Compose from Exchange
              </Button>
              {exchangeAssets.length === 0 ? (
                <p className="text-xs text-gray-400">
                  {registryLocalAssetCount > 0
                    ? "No Exchange dependencies — this project uses registry-local connections. Open the Registry tab to edit them, or compose published assets here."
                    : "No Exchange dependencies yet."}
                </p>
              ) : null}
              <div className="space-y-2">
                {exchangeAssets.map((a) => (
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
                      <details className="rounded-md border border-gray-200 bg-gray-50/60 p-2">
                        <summary className="cursor-pointer text-xs font-medium text-gray-700">Advanced tuning</summary>
                        <div className="mt-2 space-y-2">
                          {b.provider === "OpenAI" ? (
                            <SelectField
                              label="Reasoning effort"
                              value={b.reasoningEffort ?? ""}
                              options={[
                                { value: "", label: "(default)" },
                                { value: "NONE", label: "NONE" },
                                { value: "MINIMAL", label: "MINIMAL" },
                                { value: "LOW", label: "LOW" },
                                { value: "MEDIUM", label: "MEDIUM" },
                                { value: "HIGH", label: "HIGH" },
                              ]}
                              onChange={(v) =>
                                dispatch({
                                  type: "updateLlmBinding",
                                  id: b.id,
                                  patch: { reasoningEffort: v ? (v as typeof b.reasoningEffort) : undefined },
                                })
                              }
                            />
                          ) : (
                            <>
                              <SelectField
                                label="Thinking level"
                                value={b.thinkingLevel ?? ""}
                                options={[
                                  { value: "", label: "(default)" },
                                  { value: "LOW", label: "LOW" },
                                  { value: "HIGH", label: "HIGH" },
                                ]}
                                onChange={(v) =>
                                  dispatch({
                                    type: "updateLlmBinding",
                                    id: b.id,
                                    patch: { thinkingLevel: v ? (v as typeof b.thinkingLevel) : undefined },
                                  })
                                }
                              />
                              <TextField
                                label="Thinking budget"
                                value={b.thinkingBudget !== undefined ? String(b.thinkingBudget) : ""}
                                onChange={(v) => {
                                  const trimmed = v.trim();
                                  dispatch({
                                    type: "updateLlmBinding",
                                    id: b.id,
                                    patch: { thinkingBudget: trimmed ? Number(trimmed) : undefined },
                                  });
                                }}
                              />
                            </>
                          )}
                          <TextField
                            label="Temperature"
                            value={b.temperature !== undefined ? String(b.temperature) : ""}
                            onChange={(v) => {
                              const trimmed = v.trim();
                              dispatch({
                                type: "updateLlmBinding",
                                id: b.id,
                                patch: { temperature: trimmed ? Number(trimmed) : undefined },
                              });
                            }}
                          />
                          <TextField
                            label="Top P"
                            value={b.topP !== undefined ? String(b.topP) : ""}
                            onChange={(v) => {
                              const trimmed = v.trim();
                              dispatch({
                                type: "updateLlmBinding",
                                id: b.id,
                                patch: { topP: trimmed ? Number(trimmed) : undefined },
                              });
                            }}
                          />
                          <TextField
                            label="Max output tokens"
                            value={b.maxOutputTokens !== undefined ? String(b.maxOutputTokens) : ""}
                            onChange={(v) => {
                              const trimmed = v.trim();
                              dispatch({
                                type: "updateLlmBinding",
                                id: b.id,
                                patch: { maxOutputTokens: trimmed ? Number.parseInt(trimmed, 10) : undefined },
                              });
                            }}
                          />
                          {b.provider === "OpenAI" ? (
                            <TextField
                              label="Top logprobs"
                              value={b.topLogprobs !== undefined ? String(b.topLogprobs) : ""}
                              onChange={(v) => {
                                const trimmed = v.trim();
                                dispatch({
                                  type: "updateLlmBinding",
                                  id: b.id,
                                  patch: { topLogprobs: trimmed ? Number.parseInt(trimmed, 10) : undefined },
                                });
                              }}
                            />
                          ) : (
                            <Checkbox
                              label="Response logprobs"
                              checked={b.responseLogprobs ?? false}
                              onChange={(checked) =>
                                dispatch({
                                  type: "updateLlmBinding",
                                  id: b.id,
                                  patch: { responseLogprobs: checked || undefined },
                                })
                              }
                            />
                          )}
                        </div>
                      </details>
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
