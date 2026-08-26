"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Plus, Trash2, Upload } from "lucide-react";
import { parse as parseYaml } from "yaml";
import type {
  BrokerCard,
  BrokerCardExtension,
  BrokerCardSecurityRequirement,
  BrokerCardSignature,
  BrokerCardSkill,
  BrokerCardSupportedInterface,
} from "@/lib/composer/model";
import type { DerivedA2aCardSecurity } from "@/lib/composer/a2a-card-security-from-policies";
import { A2A_CARD_ANCHOR, type A2aCardFieldAnchor } from "@/lib/composer/a2a-card-field-anchors";
import { parseBrokerCard } from "@/lib/composer/a2a-card";
import { Button, Checkbox, SelectField, TextArea, TextField } from "@/components/composer/ui";
import { MediaTypesField } from "@/components/composer/MediaTypesField";

const PROTOCOL_BINDING_OPTIONS = [
  { value: "HTTP+JSON", label: "HTTP+JSON" },
  { value: "JSONRPC", label: "JSONRPC" },
  { value: "GRPC", label: "GRPC" },
] as const;

// AgentFabric brokers only ever serve JSON-RPC (see lib/invoke/a2a-version.ts) —
// defaulting to HTTP+JSON here would advertise a transport the broker doesn't
// implement, so any spec-following A2A client (ours included) picks the wrong
// wire format and every send fails.
const DEFAULT_BINDING = "JSONRPC";
const DEFAULT_VERSION = "1.0";
/** A2A v0.3 requires the card-level mode arrays, so they never go empty. */
const DEFAULT_CARD_MODES = ["text/plain"];
const SKILL_TAGS_HINT =
  "Comma-delimited keywords describing what this skill does, e.g. it-support, triage, billing.";

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

/** Repeater for skill.examples (string[] in A2A Agent Card). */
function SkillExamplesEditor({
  examples,
  onChange,
}: {
  examples: string[] | undefined;
  onChange: (next: string[] | undefined) => void;
}) {
  const items = examples ?? [];

  function update(next: string[]) {
    onChange(next.length > 0 ? next : undefined);
  }

  return (
    <div className="space-y-1.5 rounded-md border border-dashed border-gray-200 bg-gray-50/80 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Examples</p>
        <Button variant="ghost" onClick={() => update([...items, ""])}>
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-[10px] text-gray-400">Example prompts clients can use to invoke this skill (string array).</p>
      ) : null}
      {items.map((example, index) => (
        <div key={index} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              label={`Example ${index + 1}`}
              uppercaseLabel
              value={example}
              onChange={(value) => update(items.map((row, i) => (i === index ? value : row)))}
              hint={index === 0 ? "Each row is one element in the examples array." : undefined}
              alwaysShowHint={index === 0}
            />
          </div>
          <Button variant="danger" onClick={() => update(items.filter((_, i) => i !== index))}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function preservedExtraCount(extra: Record<string, unknown> | undefined): number {
  return extra ? Object.keys(extra).length : 0;
}

function bindingOptionsFor(binding: string) {
  return PROTOCOL_BINDING_OPTIONS.some((o) => o.value === binding)
    ? [...PROTOCOL_BINDING_OPTIONS]
    : [...PROTOCOL_BINDING_OPTIONS, { value: binding, label: binding }];
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {subtitle ? <p className="text-xs text-gray-400">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function FieldAnchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-4">
      {children}
    </div>
  );
}

const MORE_SETTINGS_ANCHORS = new Set<A2aCardFieldAnchor>([
  A2A_CARD_ANCHOR.moreSettings,
  A2A_CARD_ANCHOR.providerOrganization,
  A2A_CARD_ANCHOR.providerUrl,
  A2A_CARD_ANCHOR.documentationUrl,
  A2A_CARD_ANCHOR.iconUrl,
  A2A_CARD_ANCHOR.defaultInputModes,
  A2A_CARD_ANCHOR.defaultOutputModes,
  A2A_CARD_ANCHOR.capabilities,
]);

function Collapsible({
  title,
  subtitle,
  defaultOpen,
  open,
  onOpenChange,
  anchorId,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  anchorId?: string;
  children: ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(Boolean(defaultOpen));
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <div id={anchorId} className={anchorId ? "scroll-mt-4" : undefined}>
      <div className="overflow-hidden rounded-md border border-gray-200">
        <button
          type="button"
          onClick={() => setOpen(!isOpen)}
          className="flex w-full items-center gap-2 bg-gray-50 px-3 py-2 text-left transition-colors hover:bg-gray-100"
        >
          {isOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-gray-700">{title}</span>
            {subtitle ? <span className="block truncate text-[11px] text-gray-400">{subtitle}</span> : null}
          </span>
        </button>
        {isOpen ? <div className="space-y-3 border-t border-gray-200 p-3">{children}</div> : null}
      </div>
    </div>
  );
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* invalid JSON — caller keeps prior value */
  }
  return undefined;
}

function formatJsonObject(value: Record<string, unknown> | undefined): string {
  if (!value || Object.keys(value).length === 0) return "";
  return JSON.stringify(value, null, 2);
}

function toReplacePatch(parsed: BrokerCard): Partial<BrokerCard> {
  return {
    name: parsed.name,
    version: parsed.version,
    description: parsed.description,
    documentationUrl: parsed.documentationUrl,
    iconUrl: parsed.iconUrl,
    provider: parsed.provider,
    capabilities: parsed.capabilities,
    defaultInputModes: parsed.defaultInputModes,
    defaultOutputModes: parsed.defaultOutputModes,
    skills: parsed.skills ?? [],
    supportedInterfaces: parsed.supportedInterfaces,
    signatures: parsed.signatures,
    securitySchemes: parsed.securitySchemes,
    securityRequirements: parsed.securityRequirements,
    extra: parsed.extra,
  };
}

function ExtensionEditor({
  item,
  onChange,
  onRemove,
}: {
  item: BrokerCardExtension;
  onChange: (patch: Partial<BrokerCardExtension>) => void;
  onRemove: () => void;
}) {
  const [paramsJson, setParamsJson] = useState(formatJsonObject(item.params));

  useEffect(() => {
    setParamsJson(formatJsonObject(item.params));
  }, [item.params]);

  return (
    <div className="space-y-2 rounded border border-gray-200 bg-gray-50/80 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-500">Extension</span>
        <Button variant="danger" className="h-7 px-2" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <TextField label="URI" uppercaseLabel value={item.uri} onChange={(uri) => onChange({ uri })} mono />
      <TextArea
        label="Description"
        uppercaseLabel
        value={item.description ?? ""}
        onChange={(description) => onChange({ description: description || undefined })}
        rows={2}
      />
      <Checkbox
        label="Required"
        checked={Boolean(item.required)}
        onChange={(required) => onChange({ required: required || undefined })}
      />
      <TextArea
        label="Params (JSON object)"
        uppercaseLabel
        value={paramsJson}
        onChange={(raw) => {
          setParamsJson(raw);
          const parsed = parseJsonObject(raw);
          if (parsed !== undefined || !raw.trim()) onChange({ params: parsed });
        }}
        rows={3}
        mono
        hint="Optional extension-specific parameters as a JSON object."
      />
    </div>
  );
}

function SecurityRequirementEditor({
  item,
  onChange,
  onRemove,
}: {
  item: BrokerCardSecurityRequirement;
  onChange: (next: BrokerCardSecurityRequirement) => void;
  onRemove: () => void;
}) {
  const entries = Object.entries(item) as Array<[string, string[]]>;

  function updateEntry(index: number, scheme: string, scopesRaw: string) {
    const next: BrokerCardSecurityRequirement = {};
    const list = [...entries];
    const [, priorScopes] = list[index] ?? ["", []];
    list[index] = [scheme.trim(), parseCommaList(scopesRaw) ?? priorScopes ?? []];
    for (const [key, scopes] of list) {
      if (key.trim()) next[key.trim()] = scopes;
    }
    onChange(next);
  }

  function addEntry() {
    onChange({ ...item, [`scheme-${entries.length + 1}`]: [] });
  }

  function removeEntry(index: number) {
    const next: BrokerCardSecurityRequirement = {};
    entries.forEach(([key, scopes], i) => {
      if (i !== index && key.trim()) next[key.trim()] = scopes;
    });
    onChange(next);
  }

  return (
    <div className="space-y-2 rounded border border-gray-200 bg-gray-50/80 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-500">Security requirement (AND group)</span>
        <Button variant="danger" className="h-7 px-2" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="text-[11px] text-gray-400">Add a scheme reference below.</p>
      ) : null}
      {entries.map(([scheme, scopes], index) => (
        <div key={`security-scheme-${index}`} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <TextField
            label="Scheme name"
            uppercaseLabel
            value={scheme}
            onChange={(name) => updateEntry(index, name, commaList(scopes))}
          />
          <TextField
            label="Scopes"
            uppercaseLabel
            value={commaList(scopes)}
            onChange={(raw) => updateEntry(index, scheme, raw)}
            hint="Comma-separated; leave empty for schemes without scopes."
          />
          <Button variant="danger" className="mb-0.5 h-7 px-2" onClick={() => removeEntry(index)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button variant="secondary" className="h-7 px-2 text-xs" onClick={addEntry}>
        <Plus className="h-3 w-3" /> Add scheme to group
      </Button>
    </div>
  );
}

function SecurityRequirementsListEditor({
  value,
  onChange,
  label,
}: {
  value: BrokerCardSecurityRequirement[] | undefined;
  onChange: (next: BrokerCardSecurityRequirement[] | undefined) => void;
  label: string;
}) {
  const items = value ?? [];

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-700">{label}</p>
      <p className="text-[11px] text-gray-400">
        Each group is an AND of schemes; multiple groups are OR alternatives (OpenAPI security model).
      </p>
      {items.map((item, index) => (
        <SecurityRequirementEditor
          key={`sec-req-${index}`}
          item={item}
          onChange={(next) => {
            const list = [...items];
            if (Object.keys(next).length === 0) list.splice(index, 1);
            else list[index] = next;
            onChange(list.length > 0 ? list : undefined);
          }}
          onRemove={() => {
            const list = items.filter((_, i) => i !== index);
            onChange(list.length > 0 ? list : undefined);
          }}
        />
      ))}
      <Button
        variant="secondary"
        className="h-7 px-2 text-xs"
        onClick={() => onChange([...items, { oauth2: [] }])}
      >
        <Plus className="h-3 w-3" /> Add requirement group
      </Button>
    </div>
  );
}

function DerivedCardSecurityPanel({
  derivedSecurity,
  onNavigateToA2aInterface,
}: {
  derivedSecurity: DerivedA2aCardSecurity | undefined;
  onNavigateToA2aInterface?: () => void;
}) {
  const schemesJson = formatJsonObject(derivedSecurity?.securitySchemes);
  const requirementsJson = derivedSecurity?.securityRequirements?.length
    ? JSON.stringify(derivedSecurity.securityRequirements, null, 2)
    : "";

  return (
    <div className="space-y-3">
      <div className="rounded-anypoint border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            Card <span className="font-mono">securitySchemes</span> and{" "}
            <span className="font-mono">securityRequirements</span> are generated from inbound policies on the{" "}
            {onNavigateToA2aInterface ? (
              <button
                type="button"
                onClick={onNavigateToA2aInterface}
                className="font-medium text-primary hover:underline"
              >
                A2A Interface
              </button>
            ) : (
              "A2A Interface"
            )}{" "}
            tab and written to <span className="font-mono">agent-network.yaml</span> on export.
          </p>
        </div>
      </div>
      <TextArea
        label="Security schemes (generated)"
        uppercaseLabel
        value={schemesJson}
        onChange={() => {}}
        readOnly
        protected
        rows={schemesJson ? 8 : 3}
        mono
        hint={
          derivedSecurity
            ? "OpenAPI-style scheme map derived from auth-related inbound interface policies."
            : "Add an authentication policy on the A2A Interface tab to generate card security metadata."
        }
        alwaysShowHint
      />
      <TextArea
        label="Card security requirements (generated)"
        uppercaseLabel
        value={requirementsJson}
        onChange={() => {}}
        readOnly
        protected
        rows={requirementsJson ? 5 : 3}
        mono
        hint="Requirement groups referencing the generated scheme names."
        alwaysShowHint
      />
    </div>
  );
}

function SecuritySchemesEditor({
  value,
  onChange,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (next: Record<string, unknown> | undefined) => void;
}) {
  const [raw, setRaw] = useState(formatJsonObject(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRaw(formatJsonObject(value));
    setError(null);
  }, [value]);

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-700">Security schemes</p>
      <p className="text-[11px] text-gray-400">
        OpenAPI-style map of scheme name to definition (apiKey, http, oauth2, openIdConnect, mutualTLS).
      </p>
      <TextArea
        label="Security schemes (JSON object)"
        uppercaseLabel
        value={raw}
        onChange={(next) => {
          setRaw(next);
          if (!next.trim()) {
            setError(null);
            onChange(undefined);
            return;
          }
          try {
            const parsed = JSON.parse(next) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              setError("Must be a JSON object.");
              return;
            }
            setError(null);
            onChange(parsed as Record<string, unknown>);
          } catch {
            setError("Invalid JSON.");
          }
        }}
        rows={8}
        mono
      />
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
    </div>
  );
}

function SignatureEditor({
  item,
  onChange,
  onRemove,
}: {
  item: BrokerCardSignature;
  onChange: (patch: Partial<BrokerCardSignature>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded border border-gray-200 bg-gray-50/80 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-500">JWS signature</span>
        <Button variant="danger" className="h-7 px-2" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <TextArea
        label="Protected"
        uppercaseLabel
        value={item.protected}
        onChange={(protectedVal) => onChange({ protected: protectedVal })}
        rows={2}
        mono
      />
      <TextArea
        label="Signature"
        uppercaseLabel
        value={item.signature}
        onChange={(signature) => onChange({ signature })}
        rows={2}
        mono
      />
      <TextField
        label="Header (optional)"
        uppercaseLabel
        value={item.header ?? ""}
        onChange={(header) => onChange({ header: header || undefined })}
        mono
      />
    </div>
  );
}

function SignaturesListEditor({
  value,
  onChange,
}: {
  value: BrokerCardSignature[] | undefined;
  onChange: (next: BrokerCardSignature[] | undefined) => void;
}) {
  const items = value ?? [];

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-700">Card signatures</p>
      <p className="text-[11px] text-gray-400">JSON Web Signatures for this agent card.</p>
      {items.map((item, index) => (
        <SignatureEditor
          key={`sig-${index}`}
          item={item}
          onChange={(patch) => {
            const list = [...items];
            list[index] = { ...list[index], ...patch };
            onChange(list);
          }}
          onRemove={() => {
            const list = items.filter((_, i) => i !== index);
            onChange(list.length > 0 ? list : undefined);
          }}
        />
      ))}
      <Button
        variant="secondary"
        className="h-7 px-2 text-xs"
        onClick={() =>
          onChange([
            ...items,
            { protected: "", signature: "" },
          ])
        }
      >
        <Plus className="h-3 w-3" /> Add signature
      </Button>
    </div>
  );
}

function SupportedInterfaceEditor({
  item,
  onChange,
  onRemove,
}: {
  item: BrokerCardSupportedInterface;
  onChange: (patch: Partial<BrokerCardSupportedInterface>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded border border-gray-200 bg-gray-50/80 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-500">Supported interface</span>
        <Button variant="danger" className="h-7 px-2" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <TextField label="URL" uppercaseLabel value={item.url} onChange={(url) => onChange({ url })} mono />
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Protocol binding"
          uppercaseLabel
          value={item.protocolBinding}
          options={bindingOptionsFor(item.protocolBinding)}
          onChange={(protocolBinding) => onChange({ protocolBinding })}
        />
        <TextField
          label="Protocol version"
          uppercaseLabel
          value={item.protocolVersion}
          onChange={(protocolVersion) => onChange({ protocolVersion })}
          mono
        />
      </div>
      <TextField
        label="Tenant (optional)"
        uppercaseLabel
        value={item.tenant ?? ""}
        onChange={(tenant) => onChange({ tenant: tenant || undefined })}
      />
    </div>
  );
}

function SkillEditor({
  skill,
  onChange,
  onRemove,
  securityFromInterface,
}: {
  skill: BrokerCardSkill;
  onChange: (patch: Partial<BrokerCardSkill>) => void;
  onRemove: () => void;
  securityFromInterface?: boolean;
}) {
  return (
    <div className="space-y-2 rounded border border-gray-200 bg-gray-50/80 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-500">Skill</span>
        <Button variant="danger" className="h-7 px-2" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Skill name" uppercaseLabel value={skill.name} onChange={(name) => onChange({ name })} />
        <TextField
          label="Skill tags"
          uppercaseLabel
          value={commaList(skill.tags)}
          onChange={(raw) => onChange({ tags: parseCommaList(raw) })}
          hint={SKILL_TAGS_HINT}
          alwaysShowHint
        />
      </div>
      <TextArea
        label="Description"
        uppercaseLabel
        value={skill.description ?? ""}
        onChange={(description) => onChange({ description: description || undefined })}
        rows={2}
      />
      <TextField label="Skill id" uppercaseLabel value={skill.id} onChange={(id) => onChange({ id })} mono />
      <SkillExamplesEditor examples={skill.examples} onChange={(examples) => onChange({ examples })} />
      <div className="grid grid-cols-2 gap-2">
        <MediaTypesField
          label="Input modes"
          uppercaseLabel
          value={skill.inputModes}
          onChange={(inputModes) => onChange({ inputModes })}
        />
        <MediaTypesField
          label="Output modes"
          uppercaseLabel
          value={skill.outputModes}
          onChange={(outputModes) => onChange({ outputModes })}
        />
      </div>
      {preservedExtraCount(skill.extra) > 0 ? (
        <p className="text-[11px] text-gray-400">
          {preservedExtraCount(skill.extra)} additional skill field
          {preservedExtraCount(skill.extra) === 1 ? "" : "s"} preserved from import.
        </p>
      ) : null}
      {!securityFromInterface ? (
        <SecurityRequirementsListEditor
          label="Skill security requirements"
          value={skill.securityRequirements}
          onChange={(securityRequirements) => onChange({ securityRequirements })}
        />
      ) : null}
    </div>
  );
}

export function BrokerCardEditor({
  card,
  onChange,
  focusAnchor,
  onFocusAnchorHandled,
  derivedSecurity,
  securityFromInterface = false,
  onNavigateToA2aInterface,
}: {
  card: BrokerCard;
  onChange: (patch: Partial<BrokerCard>) => void;
  focusAnchor?: A2aCardFieldAnchor | null;
  onFocusAnchorHandled?: () => void;
  derivedSecurity?: DerivedA2aCardSecurity;
  securityFromInterface?: boolean;
  onNavigateToA2aInterface?: () => void;
}) {
  const [moreSettingsOpen, setMoreSettingsOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [additionalSkillsOpen, setAdditionalSkillsOpen] = useState(false);
  const [additionalEndpointsOpen, setAdditionalEndpointsOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccessToast, setUploadSuccessToast] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focusAnchor) return;
    if (MORE_SETTINGS_ANCHORS.has(focusAnchor)) setMoreSettingsOpen(true);
    if (focusAnchor === A2A_CARD_ANCHOR.additionalSkills) setAdditionalSkillsOpen(true);
    if (focusAnchor === A2A_CARD_ANCHOR.additionalEndpoints) setAdditionalEndpointsOpen(true);

    const timer = window.setTimeout(() => {
      const el = document.getElementById(focusAnchor);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        el.classList.add("ring-2", "ring-primary/30", "rounded-md");
        window.setTimeout(() => el.classList.remove("ring-2", "ring-primary/30", "rounded-md"), 1400);
      }
      onFocusAnchorHandled?.();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [focusAnchor, onFocusAnchorHandled]);

  const capabilities = card.capabilities ?? {};
  const provider = card.provider ?? {};
  const interfaces = card.supportedInterfaces ?? [];
  const primary = interfaces[0];
  const skills = card.skills ?? [];
  const primarySkill = skills[0];

  function writeInterfaces(next: BrokerCardSupportedInterface[]) {
    onChange({ supportedInterfaces: next.length > 0 ? next : undefined });
  }

  function setPrimaryInterface(patch: Partial<BrokerCardSupportedInterface>) {
    const list = [...interfaces];
    const base: BrokerCardSupportedInterface =
      list[0] ?? { url: "", protocolVersion: DEFAULT_VERSION, protocolBinding: DEFAULT_BINDING };
    const updated = { ...base, ...patch };
    const isEmpty =
      !updated.url?.trim() &&
      updated.protocolBinding === DEFAULT_BINDING &&
      updated.protocolVersion === DEFAULT_VERSION &&
      !updated.tenant?.trim();
    if (isEmpty) {
      writeInterfaces(list.slice(1));
      return;
    }
    list[0] = updated;
    writeInterfaces(list);
  }

  function updateExtraInterface(index: number, patch: Partial<BrokerCardSupportedInterface>) {
    const list = [...interfaces];
    list[index] = { ...list[index], ...patch };
    writeInterfaces(list);
  }

  function removeExtraInterface(index: number) {
    writeInterfaces(interfaces.filter((_, i) => i !== index));
  }

  function addExtraInterface() {
    writeInterfaces([
      ...interfaces,
      { url: "", protocolVersion: DEFAULT_VERSION, protocolBinding: DEFAULT_BINDING },
    ]);
  }

  function setPrimarySkill(patch: Partial<BrokerCardSkill>) {
    const list = [...skills];
    const base: BrokerCardSkill = list[0] ?? { id: "skill-1", name: "" };
    const updated = { ...base, ...patch };
    const isEmpty =
      !updated.name?.trim() &&
      !updated.description?.trim() &&
      !(updated.tags?.length) &&
      !(updated.examples?.length) &&
      !(updated.inputModes?.length) &&
      !(updated.outputModes?.length);
    if (isEmpty && list.length <= 1) {
      onChange({ skills: [] });
      return;
    }
    list[0] = updated;
    onChange({ skills: list });
  }

  function updateExtraSkill(index: number, patch: Partial<BrokerCardSkill>) {
    const list = [...skills];
    list[index] = { ...list[index], ...patch };
    onChange({ skills: list });
  }

  function removeExtraSkill(index: number) {
    onChange({ skills: skills.filter((_, i) => i !== index) });
  }

  function addExtraSkill() {
    onChange({ skills: [...skills, { id: `skill-${skills.length + 1}`, name: "New skill" }] });
  }

  function updateCapabilities(patch: Partial<typeof capabilities>) {
    onChange({ capabilities: { ...capabilities, ...patch } });
  }

  const extraInterfaces = interfaces.slice(1);
  const extraSkills = skills.slice(1);

  useEffect(() => {
    if (!uploadSuccessToast) return;
    const timer = window.setTimeout(() => setUploadSuccessToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [uploadSuccessToast]);

  async function handleUploadCard(file: File) {
    setUploadError(null);
    try {
      const raw = await file.text();
      const lowerName = file.name.toLowerCase();
      const parsedCardLike = lowerName.endsWith(".yaml") || lowerName.endsWith(".yml")
        ? (parseYaml(raw) as unknown)
        : (JSON.parse(raw) as unknown);
      if (!parsedCardLike || typeof parsedCardLike !== "object" || Array.isArray(parsedCardLike)) {
        setUploadError("A2A card upload must be a JSON object.");
        return;
      }
      const parsedCard = parseBrokerCard(parsedCardLike as Record<string, unknown>);
      onChange(toReplacePatch(parsedCard));
      setUploadSuccessToast(`Uploaded ${file.name} and repopulated A2A card fields.`);
    } catch {
      setUploadError("Could not parse uploaded file. Use a valid .json, .yaml, or .yml A2A card.");
    }
  }

  function triggerUpload() {
    uploadInputRef.current?.click();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 rounded-md border border-dashed border-gray-300 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" className="h-8 px-2.5 text-xs" onClick={triggerUpload}>
            <Upload className="h-3.5 w-3.5" /> Upload A2A Card JSON
          </Button>
          <input
            ref={uploadInputRef}
            type="file"
            accept="application/json,.json,.yaml,.yml,text/yaml,application/x-yaml"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleUploadCard(file);
              event.currentTarget.value = "";
            }}
          />
          <p className="text-[11px] text-gray-500">
            Import a generated A2A card (`.json`, `.yaml`, `.yml`) and repopulate this form.
          </p>
        </div>
        {uploadError ? <p className="text-[11px] text-red-600">{uploadError}</p> : null}
      </div>
      {uploadSuccessToast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 rounded-anypoint border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 shadow-lg"
        >
          {uploadSuccessToast}
        </div>
      ) : null}

      <Section title="Agent details" subtitle="Enter the public details of your deployed service.">
        <div className="grid grid-cols-2 gap-2">
          <FieldAnchor id={A2A_CARD_ANCHOR.name}>
            <TextField label="Agent name" uppercaseLabel value={card.name} onChange={(name) => onChange({ name })} />
          </FieldAnchor>
          <FieldAnchor id={A2A_CARD_ANCHOR.version}>
            <TextField
              label="Agent version"
              uppercaseLabel
              value={card.version}
              onChange={(version) => onChange({ version })}
              mono
            />
          </FieldAnchor>
        </div>
        <FieldAnchor id={A2A_CARD_ANCHOR.description}>
          <TextArea
            label="Description"
            uppercaseLabel
            value={card.description ?? ""}
            onChange={(description) => onChange({ description: description || undefined })}
            rows={3}
          />
        </FieldAnchor>
        <FieldAnchor id={A2A_CARD_ANCHOR.endpointUrl}>
          <TextField
            label="A2A endpoint URL"
            uppercaseLabel
            value={primary?.url ?? ""}
            onChange={(url) => setPrimaryInterface({ url })}
            mono
            hint="Preferred interface where clients invoke this broker."
          />
        </FieldAnchor>
        <div className="grid grid-cols-2 gap-2">
          <FieldAnchor id={A2A_CARD_ANCHOR.protocolBinding}>
            <SelectField
              label="Protocol binding"
              uppercaseLabel
              value={primary?.protocolBinding ?? DEFAULT_BINDING}
              options={bindingOptionsFor(primary?.protocolBinding ?? DEFAULT_BINDING)}
              onChange={(protocolBinding) => setPrimaryInterface({ protocolBinding })}
            />
          </FieldAnchor>
          <FieldAnchor id={A2A_CARD_ANCHOR.protocolVersion}>
            <TextField
              label="Protocol version"
              uppercaseLabel
              value={primary?.protocolVersion ?? DEFAULT_VERSION}
              onChange={(protocolVersion) => setPrimaryInterface({ protocolVersion })}
              mono
            />
          </FieldAnchor>
        </div>
        <FieldAnchor id={A2A_CARD_ANCHOR.endpointTenant}>
          <TextField
            label="Endpoint tenant (optional)"
            uppercaseLabel
            value={primary?.tenant ?? ""}
            onChange={(tenant) => setPrimaryInterface({ tenant: tenant || undefined })}
          />
        </FieldAnchor>
      </Section>

      <Collapsible
        anchorId={A2A_CARD_ANCHOR.moreSettings}
        open={moreSettingsOpen}
        onOpenChange={setMoreSettingsOpen}
        title="More settings: provider, capabilities and defaults"
        subtitle="Provider identity, supported capabilities, and default content modes."
      >
        <div className="grid grid-cols-2 gap-2">
          <FieldAnchor id={A2A_CARD_ANCHOR.providerOrganization}>
            <TextField
              label="Provider organization"
              uppercaseLabel
              value={provider.organization ?? ""}
              onChange={(organization) =>
                onChange({ provider: { ...provider, organization: organization || undefined } })
              }
            />
          </FieldAnchor>
          <FieldAnchor id={A2A_CARD_ANCHOR.providerUrl}>
            <TextField
              label="Provider URL"
              uppercaseLabel
              value={provider.url ?? ""}
              onChange={(url) => onChange({ provider: { ...provider, url: url || undefined } })}
              mono
            />
          </FieldAnchor>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FieldAnchor id={A2A_CARD_ANCHOR.documentationUrl}>
            <TextField
              label="Documentation URL (optional)"
              uppercaseLabel
              value={card.documentationUrl ?? ""}
              onChange={(documentationUrl) => onChange({ documentationUrl: documentationUrl || undefined })}
              mono
            />
          </FieldAnchor>
          <FieldAnchor id={A2A_CARD_ANCHOR.iconUrl}>
            <TextField
              label="Icon URL (optional)"
              uppercaseLabel
              value={card.iconUrl ?? ""}
              onChange={(iconUrl) => onChange({ iconUrl: iconUrl || undefined })}
              mono
            />
          </FieldAnchor>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FieldAnchor id={A2A_CARD_ANCHOR.defaultInputModes}>
            <MediaTypesField
              label="Default input modes"
              uppercaseLabel
              value={card.defaultInputModes}
              onChange={(defaultInputModes) => onChange({ defaultInputModes })}
              fallback={DEFAULT_CARD_MODES}
              hint="Media types the agent accepts across all skills. Skills can override this."
            />
          </FieldAnchor>
          <FieldAnchor id={A2A_CARD_ANCHOR.defaultOutputModes}>
            <MediaTypesField
              label="Default output modes"
              uppercaseLabel
              value={card.defaultOutputModes}
              onChange={(defaultOutputModes) => onChange({ defaultOutputModes })}
              fallback={DEFAULT_CARD_MODES}
              hint="Media types the agent produces across all skills. Skills can override this."
            />
          </FieldAnchor>
        </div>
        <FieldAnchor id={A2A_CARD_ANCHOR.capabilities}>
          <div className="space-y-2 rounded-md border border-gray-200 p-3">
          <p className="text-xs font-semibold text-gray-700">Capabilities</p>
          <Checkbox
            label="Streaming"
            checked={Boolean(capabilities.streaming)}
            onChange={(v) => updateCapabilities({ streaming: v })}
          />
          <Checkbox
            label="Push notifications"
            checked={Boolean(capabilities.pushNotifications)}
            onChange={(v) => updateCapabilities({ pushNotifications: v })}
          />
          <Checkbox
            label="Extended Agent Card"
            checked={Boolean(capabilities.extendedAgentCard)}
            onChange={(v) => updateCapabilities({ extendedAgentCard: v })}
          />
          <p className="text-[11px] text-gray-400">
            Only declare what your server implements — A2A clients treat undeclared features as unsupported and
            declared ones as callable.
          </p>
          {preservedExtraCount(capabilities.extra) > 0 ? (
            <p className="text-[11px] text-gray-400">
              {preservedExtraCount(capabilities.extra)} additional capability field
              {preservedExtraCount(capabilities.extra) === 1 ? "" : "s"} preserved from import.
            </p>
          ) : null}
          {(capabilities.extensions ?? []).map((ext, index) => (
            <ExtensionEditor
              key={`ext-${index}`}
              item={ext}
              onChange={(patch) => {
                const list = [...(capabilities.extensions ?? [])];
                list[index] = { ...list[index], ...patch };
                updateCapabilities({ extensions: list });
              }}
              onRemove={() => {
                const list = (capabilities.extensions ?? []).filter((_, i) => i !== index);
                updateCapabilities({ extensions: list.length > 0 ? list : undefined });
              }}
            />
          ))}
          <Button
            variant="secondary"
            className="h-7 px-2 text-xs"
            onClick={() =>
              updateCapabilities({
                extensions: [...(capabilities.extensions ?? []), { uri: "https://example.com/ext" }],
              })
            }
          >
            <Plus className="h-3 w-3" /> Add extension
          </Button>
          </div>
        </FieldAnchor>
      </Collapsible>

      <Collapsible
        open={securityOpen}
        onOpenChange={setSecurityOpen}
        title="Security & signatures"
        subtitle={
          securityFromInterface
            ? "Card security is generated from A2A Interface policies."
            : "Security schemes, requirements, and JWS card signatures."
        }
      >
        {securityFromInterface ? (
          <DerivedCardSecurityPanel
            derivedSecurity={derivedSecurity}
            onNavigateToA2aInterface={onNavigateToA2aInterface}
          />
        ) : (
          <>
            <SecuritySchemesEditor
              value={card.securitySchemes}
              onChange={(securitySchemes) => onChange({ securitySchemes })}
            />
            <SecurityRequirementsListEditor
              label="Card security requirements"
              value={card.securityRequirements}
              onChange={(securityRequirements) => onChange({ securityRequirements })}
            />
          </>
        )}
        <SignaturesListEditor
          value={card.signatures}
          onChange={(signatures) => onChange({ signatures })}
        />
      </Collapsible>

      {extraInterfaces.length > 0 || interfaces.length > 1 ? (
        <Collapsible
          anchorId={A2A_CARD_ANCHOR.additionalEndpoints}
          open={additionalEndpointsOpen}
          onOpenChange={setAdditionalEndpointsOpen}
          title="Additional endpoints"
          subtitle={`${extraInterfaces.length} extra supported interface${extraInterfaces.length === 1 ? "" : "s"}`}
        >
          {extraInterfaces.map((item, i) => (
            <SupportedInterfaceEditor
              key={`extra-iface-${i}`}
              item={item}
              onChange={(patch) => updateExtraInterface(i + 1, patch)}
              onRemove={() => removeExtraInterface(i + 1)}
            />
          ))}
          <Button variant="secondary" className="h-7 px-2 text-xs" onClick={addExtraInterface}>
            <Plus className="h-3 w-3" /> Add interface
          </Button>
        </Collapsible>
      ) : (
        <Button variant="secondary" className="h-7 px-2 text-xs" onClick={addExtraInterface}>
          <Plus className="h-3 w-3" /> Add another endpoint
        </Button>
      )}

      <Section title="Primary skill" subtitle="Describe the main capability clients can invoke.">
        <div className="grid grid-cols-2 gap-2">
          <FieldAnchor id={A2A_CARD_ANCHOR.primarySkill}>
            <TextField
              label="Skill name"
              uppercaseLabel
              value={primarySkill?.name ?? ""}
              onChange={(name) => setPrimarySkill({ name })}
            />
          </FieldAnchor>
          <FieldAnchor id={A2A_CARD_ANCHOR.skillTags}>
            <TextField
              label="Skill tags (required)"
              uppercaseLabel
              value={commaList(primarySkill?.tags)}
              onChange={(raw) => setPrimarySkill({ tags: parseCommaList(raw) })}
              hint={SKILL_TAGS_HINT}
              alwaysShowHint
            />
          </FieldAnchor>
        </div>
        <FieldAnchor id={A2A_CARD_ANCHOR.skillDescription}>
          <TextArea
            label="Skill description"
            uppercaseLabel
            value={primarySkill?.description ?? ""}
            onChange={(description) => setPrimarySkill({ description: description || undefined })}
            rows={3}
          />
        </FieldAnchor>
        <Collapsible title="Advanced skill fields" subtitle="Skill id, examples, and per-skill content modes.">
          <div className="grid grid-cols-2 gap-2">
            <TextField
              label="Skill id"
              uppercaseLabel
              value={primarySkill?.id ?? "skill-1"}
              onChange={(id) => setPrimarySkill({ id })}
              mono
            />
          </div>
          <SkillExamplesEditor
            examples={primarySkill?.examples}
            onChange={(examples) => setPrimarySkill({ examples })}
          />
          <div className="grid grid-cols-2 gap-2">
            <MediaTypesField
              label="Input modes"
              uppercaseLabel
              value={primarySkill?.inputModes}
              onChange={(inputModes) => setPrimarySkill({ inputModes })}
              hint="Overrides the card default input modes for this skill."
            />
            <MediaTypesField
              label="Output modes"
              uppercaseLabel
              value={primarySkill?.outputModes}
              onChange={(outputModes) => setPrimarySkill({ outputModes })}
              hint="Overrides the card default output modes for this skill."
            />
          </div>
          {!securityFromInterface ? (
            <SecurityRequirementsListEditor
              label="Skill security requirements"
              value={primarySkill?.securityRequirements}
              onChange={(securityRequirements) => setPrimarySkill({ securityRequirements })}
            />
          ) : null}
        </Collapsible>
      </Section>

      <Collapsible
        anchorId={A2A_CARD_ANCHOR.additionalSkills}
        open={additionalSkillsOpen}
        onOpenChange={setAdditionalSkillsOpen}
        title="Additional skills"
        subtitle={`${extraSkills.length} extra skill${extraSkills.length === 1 ? "" : "s"}`}
      >
        {extraSkills.map((skill, i) => (
          <SkillEditor
            key={`extra-skill-${i}`}
            skill={skill}
            onChange={(patch) => updateExtraSkill(i + 1, patch)}
            onRemove={() => removeExtraSkill(i + 1)}
            securityFromInterface={securityFromInterface}
          />
        ))}
        <Button variant="secondary" className="h-7 px-2 text-xs" onClick={addExtraSkill}>
          <Plus className="h-3 w-3" /> Add skill
        </Button>
      </Collapsible>

      {preservedExtraCount(card.extra) > 0 ? (
        <p className="text-[11px] text-amber-700">
          {preservedExtraCount(card.extra)} additional card field
          {preservedExtraCount(card.extra) === 1 ? "" : "s"} preserved from import.
        </p>
      ) : null}
    </div>
  );
}
