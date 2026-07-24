"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { BrokerCard, BrokerCardSkill, BrokerCardSupportedInterface } from "@/lib/composer/model";
import { Button, Checkbox, SelectField, TextArea, TextField } from "@/components/composer/ui";

const PROTOCOL_BINDING_OPTIONS = [
  { value: "HTTP+JSON", label: "HTTP+JSON" },
  { value: "JSONRPC", label: "JSONRPC" },
  { value: "GRPC", label: "GRPC" },
] as const;

const DEFAULT_BINDING = "HTTP+JSON";
const DEFAULT_VERSION = "1.0";

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

function Collapsible({
  title,
  subtitle,
  defaultOpen,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="overflow-hidden rounded-md border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-gray-50 px-3 py-2 text-left transition-colors hover:bg-gray-100"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-gray-700">{title}</span>
          {subtitle ? <span className="block truncate text-[11px] text-gray-400">{subtitle}</span> : null}
        </span>
      </button>
      {open ? <div className="space-y-3 border-t border-gray-200 p-3">{children}</div> : null}
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
}: {
  skill: BrokerCardSkill;
  onChange: (patch: Partial<BrokerCardSkill>) => void;
  onRemove: () => void;
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
        />
      </div>
      <TextArea
        label="Description"
        uppercaseLabel
        value={skill.description ?? ""}
        onChange={(description) => onChange({ description: description || undefined })}
        rows={2}
      />
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Skill id" uppercaseLabel value={skill.id} onChange={(id) => onChange({ id })} mono />
        <TextField
          label="Examples"
          uppercaseLabel
          value={commaList(skill.examples)}
          onChange={(raw) => onChange({ examples: parseCommaList(raw) })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Input modes"
          uppercaseLabel
          value={commaList(skill.inputModes)}
          onChange={(raw) => onChange({ inputModes: parseCommaList(raw) })}
          mono
        />
        <TextField
          label="Output modes"
          uppercaseLabel
          value={commaList(skill.outputModes)}
          onChange={(raw) => onChange({ outputModes: parseCommaList(raw) })}
          mono
        />
      </div>
      {preservedExtraCount(skill.extra) > 0 ? (
        <p className="text-[11px] text-gray-400">
          {preservedExtraCount(skill.extra)} additional skill field
          {preservedExtraCount(skill.extra) === 1 ? "" : "s"} preserved from import.
        </p>
      ) : null}
    </div>
  );
}

export function BrokerCardEditor({
  card,
  onChange,
}: {
  card: BrokerCard;
  onChange: (patch: Partial<BrokerCard>) => void;
}) {
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

  return (
    <div className="space-y-6">
      <Section title="Agent details" subtitle="Enter the public details of your deployed service.">
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Agent name" uppercaseLabel value={card.name} onChange={(name) => onChange({ name })} />
          <TextField
            label="Agent version"
            uppercaseLabel
            value={card.version}
            onChange={(version) => onChange({ version })}
            mono
          />
        </div>
        <TextArea
          label="Description"
          uppercaseLabel
          value={card.description ?? ""}
          onChange={(description) => onChange({ description: description || undefined })}
          rows={3}
        />
        <TextField
          label="A2A endpoint URL"
          uppercaseLabel
          value={primary?.url ?? ""}
          onChange={(url) => setPrimaryInterface({ url })}
          mono
          hint="Preferred interface where clients invoke this broker."
        />
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label="Protocol binding"
            uppercaseLabel
            value={primary?.protocolBinding ?? DEFAULT_BINDING}
            options={bindingOptionsFor(primary?.protocolBinding ?? DEFAULT_BINDING)}
            onChange={(protocolBinding) => setPrimaryInterface({ protocolBinding })}
          />
          <TextField
            label="Protocol version"
            uppercaseLabel
            value={primary?.protocolVersion ?? DEFAULT_VERSION}
            onChange={(protocolVersion) => setPrimaryInterface({ protocolVersion })}
            mono
          />
        </div>
        <TextField
          label="Endpoint tenant (optional)"
          uppercaseLabel
          value={primary?.tenant ?? ""}
          onChange={(tenant) => setPrimaryInterface({ tenant: tenant || undefined })}
        />
      </Section>

      <Collapsible
        title="More settings: provider, capabilities and defaults"
        subtitle="Provider identity, supported capabilities, and default content modes."
      >
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Provider organization"
            uppercaseLabel
            value={provider.organization ?? ""}
            onChange={(organization) =>
              onChange({ provider: { ...provider, organization: organization || undefined } })
            }
          />
          <TextField
            label="Provider URL"
            uppercaseLabel
            value={provider.url ?? ""}
            onChange={(url) => onChange({ provider: { ...provider, url: url || undefined } })}
            mono
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Documentation URL (optional)"
            uppercaseLabel
            value={card.documentationUrl ?? ""}
            onChange={(documentationUrl) => onChange({ documentationUrl: documentationUrl || undefined })}
            mono
          />
          <TextField
            label="Icon URL (optional)"
            uppercaseLabel
            value={card.iconUrl ?? ""}
            onChange={(iconUrl) => onChange({ iconUrl: iconUrl || undefined })}
            mono
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Default input modes"
            uppercaseLabel
            value={commaList(card.defaultInputModes)}
            onChange={(raw) => onChange({ defaultInputModes: parseCommaList(raw) ?? ["text/plain"] })}
            mono
          />
          <TextField
            label="Default output modes"
            uppercaseLabel
            value={commaList(card.defaultOutputModes)}
            onChange={(raw) => onChange({ defaultOutputModes: parseCommaList(raw) ?? ["text/plain"] })}
            mono
          />
        </div>
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
        </div>
      </Collapsible>

      {extraInterfaces.length > 0 || interfaces.length > 1 ? (
        <Collapsible
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
          <TextField
            label="Skill name"
            uppercaseLabel
            value={primarySkill?.name ?? ""}
            onChange={(name) => setPrimarySkill({ name })}
          />
          <TextField
            label="Skill tags (required)"
            uppercaseLabel
            value={commaList(primarySkill?.tags)}
            onChange={(raw) => setPrimarySkill({ tags: parseCommaList(raw) })}
            hint="Comma-separated."
          />
        </div>
        <TextArea
          label="Skill description"
          uppercaseLabel
          value={primarySkill?.description ?? ""}
          onChange={(description) => setPrimarySkill({ description: description || undefined })}
          rows={3}
        />
        <Collapsible title="Advanced skill fields" subtitle="Skill id, examples, and per-skill content modes.">
          <div className="grid grid-cols-2 gap-2">
            <TextField
              label="Skill id"
              uppercaseLabel
              value={primarySkill?.id ?? "skill-1"}
              onChange={(id) => setPrimarySkill({ id })}
              mono
            />
            <TextField
              label="Examples"
              uppercaseLabel
              value={commaList(primarySkill?.examples)}
              onChange={(raw) => setPrimarySkill({ examples: parseCommaList(raw) })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TextField
              label="Input modes"
              uppercaseLabel
              value={commaList(primarySkill?.inputModes)}
              onChange={(raw) => setPrimarySkill({ inputModes: parseCommaList(raw) })}
              mono
            />
            <TextField
              label="Output modes"
              uppercaseLabel
              value={commaList(primarySkill?.outputModes)}
              onChange={(raw) => setPrimarySkill({ outputModes: parseCommaList(raw) })}
              mono
            />
          </div>
        </Collapsible>
      </Section>

      <Collapsible
        title="Additional skills"
        subtitle={`${extraSkills.length} extra skill${extraSkills.length === 1 ? "" : "s"}`}
      >
        {extraSkills.map((skill, i) => (
          <SkillEditor
            key={skill.id || `extra-skill-${i}`}
            skill={skill}
            onChange={(patch) => updateExtraSkill(i + 1, patch)}
            onRemove={() => removeExtraSkill(i + 1)}
          />
        ))}
        <Button variant="secondary" className="h-7 px-2 text-xs" onClick={addExtraSkill}>
          <Plus className="h-3 w-3" /> Add skill
        </Button>
      </Collapsible>

      {preservedExtraCount(card.extra) > 0 ? (
        <p className="text-[11px] text-amber-700">
          {preservedExtraCount(card.extra)} additional card field
          {preservedExtraCount(card.extra) === 1 ? "" : "s"} preserved from import (e.g. securitySchemes).
        </p>
      ) : null}
    </div>
  );
}
