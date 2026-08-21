"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRightLeft, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import { BrokerCardEditor } from "@/components/composer/BrokerCardEditor";
import type { BrokerCard } from "@/lib/composer/model";
import type { ProjectFocusTarget } from "@/lib/composer/project-field-anchors";
import {
  commitRegistryAgentCard,
  inferRegistryPrimaryInterface,
  setRegistryPrimaryInterface,
} from "@/lib/composer/registry/agent-interfaces";
import {
  defaultA2aV03BrokerCard,
  getA2aV03CardFields,
  patchA2aV03CardFields,
} from "@/lib/composer/registry/agent-card-v03";
import { emptyNetworkRegistry } from "@/lib/composer/registry";
import {
  findRegistryLocalAsset,
  listConvertibleRegistryEntities,
  type RegistryEntityKind,
} from "@/lib/composer/registry/convert-to-dependencies";
import type {
  NetworkRegistry,
  RegistryAgentEntity,
  RegistryLlmEntity,
  RegistryMcpEntity,
  RegistryMcpTransportKind,
} from "@/lib/composer/registry/types";
import { RegistrySchemaImport } from "@/components/composer/RegistrySchemaImport";
import { RegistryUrlsEditor } from "@/components/composer/RegistryUrlsEditor";
import RegistryConvertPicker from "@/components/composer/RegistryConvertPicker";
import { Button, SelectField, TextArea, TextField } from "@/components/composer/ui";

type RegistryKind = RegistryEntityKind;
type RegistryFilterKind = RegistryKind | "all";

const MCP_TRANSPORT_OPTIONS: Array<{ value: RegistryMcpTransportKind; label: string }> = [
  { value: "sse", label: "SSE" },
  { value: "streamableHttp", label: "Streamable HTTP" },
  { value: "stdio", label: "Stdio" },
];

const LLM_PLATFORM_OPTIONS = [
  { value: "Gemini", label: "Gemini" },
  { value: "OpenAI", label: "OpenAI" },
  { value: "AzureOpenai", label: "Azure OpenAI" },
] as const;

function commaList(values: string[] | undefined): string {
  return values?.join(", ") ?? "";
}

function parseCommaList(raw: string): string[] | undefined {
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function updateRegistry(
  registry: NetworkRegistry,
  patch: Partial<NetworkRegistry>
): NetworkRegistry {
  return { ...registry, ...patch };
}

function RegistryEntityConvertAction({
  registryKind,
  entityKey,
}: {
  registryKind: RegistryKind;
  entityKey: string;
}) {
  const { project } = useComposer();
  const [pickerOpen, setPickerOpen] = useState(false);
  const asset = findRegistryLocalAsset(project, registryKind, entityKey);

  if (!asset) return null;

  return (
    <>
      <Button
        variant="secondary"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => setPickerOpen(true)}
        title="Link a published Exchange asset and emit exchange.json dependencies[]"
      >
        <ArrowRightLeft className="h-3 w-3" />
        Convert to dependency
      </Button>
      {pickerOpen ? (
        <RegistryConvertPicker
          registryKind={registryKind}
          entityKey={entityKey}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </>
  );
}

function RegistryEntityCollapsible({
  entityKey,
  kindLabel,
  registryKind,
  subtitle,
  initialExpanded = false,
  onRemove,
  children,
}: {
  entityKey: string;
  kindLabel: string;
  registryKind: RegistryKind;
  subtitle?: string;
  initialExpanded?: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);

  useEffect(() => {
    if (initialExpanded) setExpanded(true);
  }, [initialExpanded]);

  return (
    <div id={`registry-entity-${entityKey}`} className="scroll-mt-4 overflow-hidden rounded-lg border border-gray-200">
      <div className="flex items-center bg-gray-50">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-gray-100"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-gray-700">
              {kindLabel} · {entityKey}
            </span>
            {subtitle ? (
              <span className="block truncate text-[11px] font-normal text-gray-500">{subtitle}</span>
            ) : null}
          </div>
        </button>
        <RegistryEntityConvertAction registryKind={registryKind} entityKey={entityKey} />
        <Button variant="danger" className="mr-2 h-7 shrink-0 px-2" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {expanded ? <div className="space-y-3 border-t border-gray-200 p-3">{children}</div> : null}
    </div>
  );
}

function AgentEntityEditor({
  entity,
  onChange,
  onRemove,
  focusAnchor,
  initialExpanded = false,
  onFocusHandled,
}: {
  entity: RegistryAgentEntity;
  onChange: (next: RegistryAgentEntity) => void;
  onRemove: () => void;
  focusAnchor?: string | null;
  initialExpanded?: boolean;
  onFocusHandled?: () => void;
}) {
  const interfaceKey = inferRegistryPrimaryInterface(entity.metadata.interfaces);

  const card =
    interfaceKey === "a2a"
      ? entity.metadata.interfaces.a2a?.card
      : interfaceKey === "a2a_v03"
        ? entity.metadata.interfaces.a2a_v03?.card
        : undefined;

  function commitCard(nextCard: BrokerCard) {
    onChange(commitRegistryAgentCard(entity, nextCard));
  }

  useEffect(() => {
    if (!focusAnchor) return;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(focusAnchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        el.classList.add("ring-2", "ring-primary/30", "rounded-md");
        window.setTimeout(() => el.classList.remove("ring-2", "ring-primary/30", "rounded-md"), 1400);
      }
      onFocusHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusAnchor, onFocusHandled]);

  return (
    <RegistryEntityCollapsible
      entityKey={entity.key}
      kindLabel="Agent"
      registryKind="agents"
      subtitle={entity.info?.label}
      initialExpanded={initialExpanded || Boolean(focusAnchor)}
      onRemove={onRemove}
    >
      <RegistrySchemaImport
        kind="agent"
        agentEntity={entity}
        onAgentImport={(next) => onChange(next)}
      />
      <RegistryUrlsEditor
        urls={entity.urls}
        onChange={(urls) => onChange({ ...entity, urls })}
      />
      <TextField
        label="Registry key"
        uppercaseLabel
        value={entity.key}
        onChange={(key) => onChange({ ...entity, key })}
        mono
      />
      <TextField
        label="Info label"
        uppercaseLabel
        value={entity.info?.label ?? ""}
        onChange={(label) =>
          onChange({ ...entity, info: { ...entity.info, label: label || undefined } })
        }
      />
      <TextArea
        label="Info description"
        uppercaseLabel
        value={entity.info?.description ?? ""}
        onChange={(description) =>
          onChange({ ...entity, info: { ...entity.info, description: description || undefined } })
        }
        rows={2}
      />
      <TextField
        label="Platform"
        uppercaseLabel
        value={entity.metadata.platform}
        onChange={(platform) =>
          onChange({ ...entity, metadata: { ...entity.metadata, platform } })
        }
      />
      <SelectField
        label="Primary interface"
        uppercaseLabel
        value={interfaceKey}
        options={[
          { value: "a2a", label: "a2a (v1.x)" },
          { value: "a2a_v03", label: "a2a_v03 (v0.3.x)" },
          { value: "other", label: "other" },
        ]}
        onChange={(next) => onChange(setRegistryPrimaryInterface(entity, next as typeof interfaceKey))}
      />
      {interfaceKey === "other" ? (
        <>
          <TextField
            label="Protocol name"
            uppercaseLabel
            value={entity.metadata.interfaces.other?.protocol ?? ""}
            onChange={(protocol) =>
              onChange({
                ...entity,
                metadata: {
                  ...entity.metadata,
                  interfaces: {
                    ...entity.metadata.interfaces,
                    other: { ...entity.metadata.interfaces.other, protocol },
                  },
                },
              })
            }
          />
        </>
      ) : card ? (
        <>
          {interfaceKey === "a2a_v03" ? (
            <div className="space-y-2 rounded-md border border-amber-100 bg-amber-50/50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                A2A v0.3 card (required)
              </p>
              <div id="registry-agent-card-url" className="scroll-mt-4">
                <TextField
                  label="Card URL"
                  uppercaseLabel
                  value={getA2aV03CardFields(card as BrokerCard).url}
                  onChange={(url) =>
                    commitCard(patchA2aV03CardFields(card as BrokerCard, { url }))
                  }
                  mono
                  hint="Required top-level url on the a2a_v03 agent card."
                  alwaysShowHint
                />
              </div>
              <div id="registry-agent-card-protocol-version" className="scroll-mt-4">
                <TextField
                  label="Protocol version"
                  uppercaseLabel
                  value={getA2aV03CardFields(card as BrokerCard).protocolVersion}
                  onChange={(protocolVersion) =>
                    commitCard(patchA2aV03CardFields(card as BrokerCard, { protocolVersion }))
                  }
                  mono
                  hint="Required top-level protocolVersion (e.g. 0.3.0)."
                  alwaysShowHint
                />
              </div>
            </div>
          ) : null}
          <div id="registry-agent-card" className="scroll-mt-4">
            <BrokerCardEditor
              card={card as BrokerCard}
              onChange={(patch) => commitCard({ ...(card as BrokerCard), ...patch })}
            />
          </div>
        </>
      ) : (
        <Button
          variant="secondary"
          className="h-7 px-2 text-xs"
          onClick={() => {
            let next = setRegistryPrimaryInterface(entity, interfaceKey);
            if (interfaceKey === "a2a" || interfaceKey === "a2a_v03") {
              const defaultCard =
                interfaceKey === "a2a_v03"
                  ? defaultA2aV03BrokerCard(entity.key)
                  : { name: entity.key, version: "1.0.0" };
              next = commitRegistryAgentCard(next, defaultCard as BrokerCard);
            }
            onChange(next);
          }}
        >
          Add agent card
        </Button>
      )}
      <TextField
        label="LLM ref name"
        uppercaseLabel
        value={entity.metadata.llm?.ref.name ?? ""}
        onChange={(name) =>
          onChange({
            ...entity,
            metadata: {
              ...entity.metadata,
              llm: name.trim() ? { ref: { name: name.trim() } } : undefined,
            },
          })
        }
      />
    </RegistryEntityCollapsible>
  );
}

function McpEntityEditor({
  entity,
  onChange,
  onRemove,
  initialExpanded = false,
}: {
  entity: RegistryMcpEntity;
  onChange: (next: RegistryMcpEntity) => void;
  onRemove: () => void;
  initialExpanded?: boolean;
}) {
  const transport = entity.metadata.transport;
  return (
    <RegistryEntityCollapsible
      entityKey={entity.key}
      kindLabel="MCP"
      registryKind="mcps"
      subtitle={entity.info?.label}
      initialExpanded={initialExpanded}
      onRemove={onRemove}
    >
      <RegistrySchemaImport
        kind="mcp"
        mcpEntity={entity}
        onMcpImport={(next) => onChange(next)}
      />
      <RegistryUrlsEditor
        urls={entity.urls}
        onChange={(urls) => onChange({ ...entity, urls })}
      />
      <TextField
        label="Registry key"
        uppercaseLabel
        value={entity.key}
        onChange={(key) => onChange({ ...entity, key })}
        mono
      />
      <TextField
        label="Info label"
        uppercaseLabel
        value={entity.info?.label ?? ""}
        onChange={(label) =>
          onChange({ ...entity, info: { ...entity.info, label: label || undefined } })
        }
      />
      <SelectField
        label="Transport"
        uppercaseLabel
        value={transport.kind}
        options={MCP_TRANSPORT_OPTIONS}
        onChange={(kind) =>
          onChange({
            ...entity,
            metadata: {
              ...entity.metadata,
              transport: { kind: kind as RegistryMcpTransportKind },
            },
          })
        }
      />
      {transport.kind === "sse" ? (
        <>
          <TextField
            label="SSE path"
            uppercaseLabel
            value={transport.ssePath ?? ""}
            onChange={(ssePath) =>
              onChange({
                ...entity,
                metadata: {
                  ...entity.metadata,
                  transport: { ...transport, ssePath: ssePath || undefined },
                },
              })
            }
            mono
          />
          <TextField
            label="Messages path"
            uppercaseLabel
            value={transport.messagesPath ?? ""}
            onChange={(messagesPath) =>
              onChange({
                ...entity,
                metadata: {
                  ...entity.metadata,
                  transport: { ...transport, messagesPath: messagesPath || undefined },
                },
              })
            }
            mono
          />
        </>
      ) : null}
      {transport.kind === "streamableHttp" ? (
        <TextField
          label="HTTP path"
          uppercaseLabel
          value={transport.path ?? ""}
          onChange={(path) =>
            onChange({
              ...entity,
              metadata: {
                ...entity.metadata,
                transport: { ...transport, path: path || undefined },
              },
            })
          }
          mono
        />
      ) : null}
      {transport.kind === "stdio" ? (
        <TextArea
          label="Instructions"
          uppercaseLabel
          value={transport.instructions ?? ""}
          onChange={(instructions) =>
            onChange({
              ...entity,
              metadata: {
                ...entity.metadata,
                transport: { ...transport, instructions: instructions || undefined },
              },
            })
          }
          rows={2}
        />
      ) : null}
      <TextField
        label="Protocol version"
        uppercaseLabel
        value={entity.metadata.protocolVersion ?? ""}
        onChange={(protocolVersion) =>
          onChange({
            ...entity,
            metadata: {
              ...entity.metadata,
              protocolVersion: (protocolVersion || undefined) as RegistryMcpEntity["metadata"]["protocolVersion"],
            },
          })
        }
        mono
      />
      <TextField
        label="Platform"
        uppercaseLabel
        value={entity.metadata.platform ?? ""}
        onChange={(platform) =>
          onChange({
            ...entity,
            metadata: { ...entity.metadata, platform: platform || undefined },
          })
        }
      />
      {entity.metadata.tools?.length ||
      entity.metadata.resources?.length ||
      entity.metadata.prompts?.length ? (
        <p className="text-[11px] text-gray-500">
          Imported catalog: {entity.metadata.tools?.length ?? 0} tool
          {(entity.metadata.tools?.length ?? 0) === 1 ? "" : "s"}
          {(entity.metadata.resources?.length ?? 0) > 0
            ? `, ${entity.metadata.resources!.length} resource${entity.metadata.resources!.length === 1 ? "" : "s"}`
            : ""}
          {(entity.metadata.prompts?.length ?? 0) > 0
            ? `, ${entity.metadata.prompts!.length} prompt${entity.metadata.prompts!.length === 1 ? "" : "s"}`
            : ""}
        </p>
      ) : null}
    </RegistryEntityCollapsible>
  );
}

function LlmEntityEditor({
  entity,
  onChange,
  onRemove,
  initialExpanded = false,
}: {
  entity: RegistryLlmEntity;
  onChange: (next: RegistryLlmEntity) => void;
  onRemove: () => void;
  initialExpanded?: boolean;
}) {
  return (
    <RegistryEntityCollapsible
      entityKey={entity.key}
      kindLabel="LLM"
      registryKind="llms"
      subtitle={entity.info?.label}
      initialExpanded={initialExpanded}
      onRemove={onRemove}
    >
      <TextField
        label="Registry key"
        uppercaseLabel
        value={entity.key}
        onChange={(key) => onChange({ ...entity, key })}
        mono
      />
      <TextField
        label="Info label"
        uppercaseLabel
        value={entity.info?.label ?? ""}
        onChange={(label) =>
          onChange({ ...entity, info: { ...entity.info, label: label || undefined } })
        }
      />
      <SelectField
        label="Platform"
        uppercaseLabel
        value={entity.metadata.platform}
        options={[...LLM_PLATFORM_OPTIONS]}
        onChange={(platform) =>
          onChange({
            ...entity,
            metadata: {
              ...entity.metadata,
              platform: platform as RegistryLlmEntity["metadata"]["platform"],
            },
          })
        }
      />
      <TextField
        label="Models"
        uppercaseLabel
        value={commaList(entity.metadata.models)}
        onChange={(raw) =>
          onChange({
            ...entity,
            metadata: { ...entity.metadata, models: parseCommaList(raw) },
          })
        }
        hint="Comma-separated model identifiers."
      />
      <RegistryUrlsEditor
        urls={entity.urls}
        onChange={(urls) => onChange({ ...entity, urls })}
      />
    </RegistryEntityCollapsible>
  );
}

function registryEntityInitiallyExpanded(
  pendingFocus: ProjectFocusTarget | null | undefined,
  registryKind: RegistryKind,
  entityKey: string
): boolean {
  return (
    pendingFocus?.tab === "registry" &&
    pendingFocus.registryKind === registryKind &&
    pendingFocus.registryKey === entityKey
  );
}

export function RegistryPanel({
  pendingFocus = null,
  onFocusHandled,
}: {
  pendingFocus?: ProjectFocusTarget | null;
  onFocusHandled?: () => void;
}) {
  const { project, dispatch } = useComposer();
  const [kind, setKind] = useState<RegistryFilterKind>("all");
  const registry = project.registry ?? emptyNetworkRegistry();
  const convertible = useMemo(() => listConvertibleRegistryEntities(project), [project]);

  useEffect(() => {
    if (!pendingFocus || pendingFocus.tab !== "registry") return;
    if (pendingFocus.registryKind) setKind(pendingFocus.registryKind);
    const timer = window.setTimeout(() => {
      if (pendingFocus.registryKey) {
        const entityEl = document.getElementById(`registry-entity-${pendingFocus.registryKey}`);
        entityEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      onFocusHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingFocus, onFocusHandled]);

  const entities = useMemo(() => {
    switch (kind) {
      case "all":
        return [...registry.agents, ...registry.mcps, ...registry.llms];
      case "agents":
        return registry.agents;
      case "mcps":
        return registry.mcps;
      case "llms":
        return registry.llms;
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  }, [kind, registry]);

  function commit(next: NetworkRegistry) {
    const empty =
      next.agents.length === 0 &&
      next.mcps.length === 0 &&
      next.llms.length === 0 &&
      !next.extra;
    dispatch({ type: "setRegistry", registry: empty ? undefined : next });
  }

  function updateEntities<K extends RegistryKind>(
    listKind: K,
    list: NetworkRegistry[K]
  ) {
    commit(updateRegistry(registry, { [listKind]: list }));
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Author local registry entities referenced by connections with{" "}
        <code className="rounded bg-gray-100 px-1">registryLocal</code> refs. When assets are published
        on Exchange, use <strong className="font-medium text-gray-700">Convert to dependency</strong> to
        emit <span className="font-mono">exchange.json dependencies[]</span> instead.
      </p>

      {convertible.length > 0 ? (
        <div className="rounded-md border border-sky-100 bg-sky-50/80 px-3 py-2.5 text-xs text-sky-900">
          <p className="font-medium">
            {convertible.length} registry entit{convertible.length === 1 ? "y" : "ies"} can become Exchange
            dependencies
          </p>
          <p className="mt-1 text-sky-800/90">
            {convertible.map((item) => item.entityKey).join(", ")} — open each entity and choose a published
            asset, or compose matching assets on the Exchange Assets tab first.
          </p>
        </div>
      ) : null}
      <div className="flex gap-2">
        {(["all", "agents", "mcps", "llms"] as const).map((k) => (
          <Button
            key={k}
            variant={kind === k ? "primary" : "secondary"}
            className="h-7 px-2 text-xs capitalize"
            onClick={() => setKind(k)}
          >
            {k}
          </Button>
        ))}
      </div>

      {entities.length === 0 ? (
        <p className="text-xs text-gray-400">
          {kind === "all" ? "No registry entities defined yet." : `No ${kind} defined yet.`}
        </p>
      ) : null}

      {(kind === "all" || kind === "agents")
        ? registry.agents.map((entity, index) => (
            <AgentEntityEditor
              key={entity.key || `agent-${index}`}
              entity={entity}
              initialExpanded={registryEntityInitiallyExpanded(pendingFocus, "agents", entity.key)}
              focusAnchor={
                pendingFocus?.tab === "registry" &&
                pendingFocus.registryKind === "agents" &&
                pendingFocus.registryKey === entity.key
                  ? pendingFocus.anchor
                  : null
              }
              onFocusHandled={onFocusHandled}
              onChange={(next) => {
                const list = [...registry.agents];
                list[index] = next;
                updateEntities("agents", list);
              }}
              onRemove={() => {
                updateEntities(
                  "agents",
                  registry.agents.filter((_, i) => i !== index)
                );
              }}
            />
          ))
        : null}

      {(kind === "all" || kind === "mcps")
        ? registry.mcps.map((entity, index) => (
            <McpEntityEditor
              key={entity.key || `mcp-${index}`}
              entity={entity}
              initialExpanded={registryEntityInitiallyExpanded(pendingFocus, "mcps", entity.key)}
              onChange={(next) => {
                const list = [...registry.mcps];
                list[index] = next;
                updateEntities("mcps", list);
              }}
              onRemove={() => {
                updateEntities(
                  "mcps",
                  registry.mcps.filter((_, i) => i !== index)
                );
              }}
            />
          ))
        : null}

      {(kind === "all" || kind === "llms")
        ? registry.llms.map((entity, index) => (
            <LlmEntityEditor
              key={entity.key || `llm-${index}`}
              entity={entity}
              initialExpanded={registryEntityInitiallyExpanded(pendingFocus, "llms", entity.key)}
              onChange={(next) => {
                const list = [...registry.llms];
                list[index] = next;
                updateEntities("llms", list);
              }}
              onRemove={() => {
                updateEntities(
                  "llms",
                  registry.llms.filter((_, i) => i !== index)
                );
              }}
            />
          ))
        : null}

      {kind === "all" ? (
        <p className="text-[11px] text-gray-500">
          Select <span className="font-medium">agents</span>, <span className="font-medium">mcps</span>, or{" "}
          <span className="font-medium">llms</span> to add a new registry entity.
        </p>
      ) : (
        <Button
          variant="secondary"
          className="h-7 px-2 text-xs"
          onClick={() => {
            if (kind === "agents") {
              updateEntities("agents", [
                ...registry.agents,
                {
                  key: `agent-${registry.agents.length + 1}`,
                  metadata: { platform: "Custom", interfaces: { a2a: { card: { name: "Agent", version: "1.0.0" } } } },
                },
              ]);
            } else if (kind === "mcps") {
              updateEntities("mcps", [
                ...registry.mcps,
                { key: `mcp-${registry.mcps.length + 1}`, metadata: { transport: { kind: "streamableHttp" } } },
              ]);
            } else {
              updateEntities("llms", [
                ...registry.llms,
                { key: `llm-${registry.llms.length + 1}`, metadata: { platform: "OpenAI" } },
              ]);
            }
          }}
        >
          <Plus className="h-3 w-3" /> Add {kind.slice(0, -1)}
        </Button>
      )}

      {registry.extra && Object.keys(registry.extra).length > 0 ? (
        <p className="text-[11px] text-amber-700">
          {Object.keys(registry.extra).length} additional registry field
          {Object.keys(registry.extra).length === 1 ? "" : "s"} preserved from import.
        </p>
      ) : null}
    </div>
  );
}
