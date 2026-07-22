"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { ConnectionAccess, ConnectionPolicies, ConnectionPolicyItem } from "@/lib/composer/connectivity";
import { sanitizeConnectionPolicyItems } from "@/lib/composer/connectivity/connection-extras";
import type { DeclaredPolicyBinding } from "@/lib/composer/connectivity/policy-bindings-zod";
import { newId } from "@/lib/composer/factory";
import { PolicyConfigurationEditor } from "@/components/composer/PolicyConfigurationEditor";
import type {
  ExchangePolicyCatalog,
  ExchangePolicyOption,
} from "@/components/composer/useExchangePolicies";
import { Button, SelectField, TextArea, TextField } from "@/components/composer/ui";

const CUSTOM_POLICY = "__custom__";

const DEFAULT_INLINE_POLICY = {
  policy: {
    ref: { name: "" },
    configuration: {},
  },
};

function refItems(items: ConnectionPolicyItem[] | undefined): Array<{ mode: "ref"; name: string; namespace?: string }> {
  return (items ?? []).filter((item): item is Extract<ConnectionPolicyItem, { mode: "ref" }> => item.mode === "ref");
}

function inlineItems(items: ConnectionPolicyItem[] | undefined): Array<{ mode: "inline"; document: Record<string, unknown> }> {
  return (items ?? []).filter((item): item is Extract<ConnectionPolicyItem, { mode: "inline" }> => item.mode === "inline");
}

function policyOptionKey(p: ExchangePolicyOption): string {
  return `${p.groupId}:${p.assetId}`;
}

function policyOptionLabel(p: ExchangePolicyOption): string {
  const provider = p.provider === "mulesoft" ? "MuleSoft" : "Org";
  return `[${provider}] ${p.name}`;
}

const UNCATEGORIZED_POLICY_CATEGORY = "Other";

function groupPoliciesByCategory(policies: ExchangePolicyOption[]) {
  const byCategory = new Map<string, ExchangePolicyOption[]>();
  for (const policy of policies) {
    const category = policy.category?.trim() || UNCATEGORIZED_POLICY_CATEGORY;
    const list = byCategory.get(category) ?? [];
    list.push(policy);
    byCategory.set(category, list);
  }
  return Array.from(byCategory.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, items]) => ({
      label,
      policies: [...items].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

function policySelectGroups(policies: ExchangePolicyOption[]) {
  return groupPoliciesByCategory(policies).map((group) => ({
    label: group.label,
    options: group.policies.map((p) => ({
      value: policyOptionKey(p),
      label: policyOptionLabel(p),
    })),
  }));
}

function findPolicyOption(
  policies: ExchangePolicyOption[],
  item: { name: string; namespace?: string }
): ExchangePolicyOption | undefined {
  return policies.find(
    (p) => p.assetId === item.name && (item.namespace ? p.groupId === item.namespace : true)
  );
}

function bindingFromPolicy(p: ExchangePolicyOption, organizationId: string): { name: string; namespace?: string } {
  return {
    name: p.assetId,
    namespace: p.groupId !== organizationId ? p.groupId : undefined,
  };
}

type DraftPolicyRow = {
  id: string;
  mode: "pick" | "custom";
  customName?: string;
  customNamespace?: string;
};

function InlinePolicyEditor({
  document,
  onChange,
  onRemove,
}: {
  document: Record<string, unknown>;
  onChange: (document: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(document, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(JSON.stringify(document, null, 2));
    setError(null);
  }, [document]);

  function commit() {
    try {
      const parsed = JSON.parse(draft) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Inline policy must be a JSON object.");
        return;
      }
      const obj = parsed as Record<string, unknown>;
      if (!("policy" in obj)) {
        setError('Inline policy object must include a "policy" property.');
        return;
      }
      setError(null);
      onChange(obj);
    } catch {
      setError("Invalid JSON.");
    }
  }

  return (
    <div className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50/50 p-2">
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-[11px] font-medium text-amber-800">Inline policy</p>
        <TextArea
          label="Policy binding (JSON)"
          value={draft}
          onChange={setDraft}
          onBlur={commit}
          rows={6}
          mono
          hint='Schema shape: { "policy": { "ref": { "name": "..." }, "configuration": { ... } } }'
        />
        {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
      </div>
      <Button variant="danger" className="mt-5 shrink-0" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function PolicyBindingList({
  label,
  items,
  organizationId,
  variableGroup,
  exchangePolicies,
  policyBindings,
  policiesLoading,
  policiesError,
  onChange,
  onEnsurePolicyBinding,
  onUpdatePolicyBinding,
}: {
  label: string;
  items: ConnectionPolicyItem[] | undefined;
  organizationId: string;
  variableGroup: string;
  exchangePolicies: ExchangePolicyOption[];
  policyBindings: Record<string, DeclaredPolicyBinding>;
  policiesLoading: boolean;
  policiesError: string | null;
  onChange: (items: ConnectionPolicyItem[] | undefined) => void;
  onEnsurePolicyBinding: (bindingName: string, binding: DeclaredPolicyBinding) => void;
  onUpdatePolicyBinding: (bindingName: string, patch: Partial<DeclaredPolicyBinding>) => void;
}) {
  const [drafts, setDrafts] = useState<DraftPolicyRow[]>([]);
  const refs = refItems(items).filter((item) => item.name.trim().length > 0);
  const inlines = inlineItems(items);

  useEffect(() => {
    if (!items?.some((item) => item.mode === "ref" && !item.name.trim())) return;
    onChange(sanitizeConnectionPolicyItems(items));
  }, [items, onChange]);

  function commitAll(
    nextRefs: Array<{ mode: "ref"; name: string; namespace?: string }>,
    nextInlines: Array<{ mode: "inline"; document: Record<string, unknown> }>
  ) {
    const merged: ConnectionPolicyItem[] = [...nextRefs, ...nextInlines];
    onChange(sanitizeConnectionPolicyItems(merged));
  }

  function commitRefs(nextRefs: Array<{ mode: "ref"; name: string; namespace?: string }>) {
    commitAll(nextRefs, inlines);
  }

  function commitInlines(nextInlines: Array<{ mode: "inline"; document: Record<string, unknown> }>) {
    commitAll(refs, nextInlines);
  }

  function pickPolicy(picked: ExchangePolicyOption) {
    const ref = bindingFromPolicy(picked, organizationId);
    onEnsurePolicyBinding(ref.name, {
      ref: { name: ref.name, ...(ref.namespace ? { namespace: ref.namespace } : {}) },
      configuration: policyBindings[ref.name]?.configuration ?? {},
      templateVersion: picked.version,
    });
    commitRefs([...refs, { mode: "ref", ...ref }]);
  }

  function commitCustomDraft(draft: DraftPolicyRow) {
    const name = draft.customName?.trim() ?? "";
    if (!name) return;
    const namespace = draft.customNamespace?.trim();
    onEnsurePolicyBinding(name, {
      ref: { name, ...(namespace ? { namespace } : {}) },
      configuration: policyBindings[name]?.configuration ?? {},
    });
    commitRefs([...refs, { mode: "ref", name, ...(namespace ? { namespace } : {}) }]);
    setDrafts((rows) => rows.filter((row) => row.id !== draft.id));
  }

  function addBinding() {
    setDrafts((rows) => [...rows, { id: newId(), mode: "pick" }]);
  }

  function addInlinePolicy() {
    commitInlines([...inlines, { mode: "inline", document: structuredClone(DEFAULT_INLINE_POLICY) }]);
  }

  const policySelectHint =
    policiesError ??
    (exchangePolicies.length > 0
      ? "Filtered by injection point and asset type."
      : "Sign in and set organization id to load the policy catalog.");

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <div className="flex gap-1">
          <Button variant="secondary" className="h-7 px-2 text-xs" onClick={addInlinePolicy}>
            Inline
          </Button>
          <Button variant="secondary" className="h-7 px-2 text-xs" onClick={addBinding}>
            <Plus className="h-3 w-3" />
            Ref
          </Button>
        </div>
      </div>
      {!policiesLoading && exchangePolicies.length > 0 ? (
        <p className="text-[11px] text-gray-400">
          {exchangePolicies.length} {label.toLowerCase()}{" "}
          {exchangePolicies.length === 1 ? "template" : "templates"} available
        </p>
      ) : null}
      {refs.length === 0 && inlines.length === 0 && drafts.length === 0 ? (
        <p className="text-[11px] text-gray-400">No policy bindings.</p>
      ) : null}
      {inlines.map((item, index) => (
        <InlinePolicyEditor
          key={`inline-${index}`}
          document={item.document}
          onChange={(document) => {
            const next = inlines.map((row, i) => (i === index ? { mode: "inline" as const, document } : row));
            commitInlines(next);
          }}
          onRemove={() => commitInlines(inlines.filter((_, i) => i !== index))}
        />
      ))}
      {refs.map((item, index) => {
        const matched = findPolicyOption(exchangePolicies, item);
        const selectValue = matched ? policyOptionKey(matched) : CUSTOM_POLICY;

        return (
          <div key={`${item.name}-${index}`} className="flex items-start gap-1.5 rounded border border-gray-200 bg-gray-50/80 p-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <SelectField
                label="Policy template"
                value={selectValue}
                options={[
                  { value: "", label: policiesLoading ? "Loading policy catalog…" : "— Select policy —" },
                ]}
                groups={policySelectGroups(exchangePolicies)}
                trailingOptions={[{ value: CUSTOM_POLICY, label: "Custom binding name…" }]}
                onChange={(v) => {
                  if (!v) {
                    commitRefs(refs.filter((_, i) => i !== index));
                    return;
                  }
                  if (v === CUSTOM_POLICY) {
                    return;
                  }
                  const picked = exchangePolicies.find((p) => policyOptionKey(p) === v);
                  if (!picked) return;
                  const ref = bindingFromPolicy(picked, organizationId);
                  onEnsurePolicyBinding(ref.name, {
                    ref: { name: ref.name, ...(ref.namespace ? { namespace: ref.namespace } : {}) },
                    configuration: policyBindings[ref.name]?.configuration ?? {},
                    templateVersion: picked.version,
                  });
                  const next = refs.map((r, i) => (i === index ? { mode: "ref" as const, ...ref } : r));
                  commitRefs(next);
                }}
                hint={policySelectHint}
              />
              {selectValue === CUSTOM_POLICY ? (
                <>
                  <TextField
                    label="Binding name"
                    value={item.name}
                    onChange={(name) => {
                      const next = refs.map((r, i) => (i === index ? { ...r, name } : r));
                      commitRefs(next);
                    }}
                    mono
                    hint="Policy binding ref name (context.policies key or custom)."
                  />
                  <TextField
                    label="Namespace (optional)"
                    value={item.namespace ?? ""}
                    onChange={(namespace) => {
                      const next = refs.map((r, i) =>
                        i === index ? { ...r, ...(namespace ? { namespace } : { namespace: undefined }) } : r
                      );
                      commitRefs(next);
                    }}
                    mono
                  />
                </>
              ) : matched ? (
                <>
                  <p className="text-[11px] text-gray-400">
                    Ref: <span className="font-mono">{item.name}</span>
                    {item.namespace ? (
                      <>
                        {" "}
                        · namespace <span className="font-mono">{item.namespace}</span>
                      </>
                    ) : null}
                    {matched.version ? (
                      <>
                        {" "}
                        · v<span className="font-mono">{matched.version}</span>
                      </>
                    ) : null}
                  </p>
                  <PolicyConfigurationEditor
                    organizationId={organizationId}
                    bindingName={item.name}
                    binding={policyBindings[item.name]}
                    variableGroup={variableGroup}
                    groupId={matched.groupId}
                    assetId={matched.assetId}
                    templateVersion={policyBindings[item.name]?.templateVersion ?? matched.version}
                    onChange={onUpdatePolicyBinding}
                  />
                </>
              ) : null}
            </div>
            <Button
              variant="danger"
              className="mt-5 shrink-0"
              onClick={() => commitRefs(refs.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
      {drafts.map((draft) => (
        <div key={draft.id} className="flex items-start gap-1.5 rounded border border-dashed border-gray-200 bg-gray-50/50 p-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            {draft.mode === "pick" ? (
              <SelectField
                label="Policy template"
                value=""
                options={[
                  { value: "", label: policiesLoading ? "Loading policy catalog…" : "— Select policy —" },
                ]}
                groups={policySelectGroups(exchangePolicies)}
                trailingOptions={[{ value: CUSTOM_POLICY, label: "Custom binding name…" }]}
                onChange={(v) => {
                  if (!v) {
                    setDrafts((rows) => rows.filter((row) => row.id !== draft.id));
                    return;
                  }
                  if (v === CUSTOM_POLICY) {
                    setDrafts((rows) =>
                      rows.map((row) =>
                        row.id === draft.id
                          ? { ...row, mode: "custom" as const, customName: "", customNamespace: "" }
                          : row
                      )
                    );
                    return;
                  }
                  const picked = exchangePolicies.find((p) => policyOptionKey(p) === v);
                  if (!picked) return;
                  pickPolicy(picked);
                  setDrafts((rows) => rows.filter((row) => row.id !== draft.id));
                }}
                hint={policySelectHint}
              />
            ) : (
              <>
                <SelectField
                  label="Policy template"
                  value={CUSTOM_POLICY}
                  options={[{ value: CUSTOM_POLICY, label: "Custom binding name…" }]}
                  onChange={() => setDrafts((rows) => rows.filter((row) => row.id !== draft.id))}
                  hint={policySelectHint}
                />
                <TextField
                  label="Binding name"
                  value={draft.customName ?? ""}
                  onChange={(customName) => {
                    setDrafts((rows) =>
                      rows.map((row) => (row.id === draft.id ? { ...row, customName } : row))
                    );
                  }}
                  onBlur={() => commitCustomDraft(draft)}
                  mono
                  hint="Required before the binding is written to agent-network.yaml."
                />
                <TextField
                  label="Namespace (optional)"
                  value={draft.customNamespace ?? ""}
                  onChange={(customNamespace) => {
                    setDrafts((rows) =>
                      rows.map((row) => (row.id === draft.id ? { ...row, customNamespace } : row))
                    );
                  }}
                  onBlur={() => commitCustomDraft({ ...draft, customNamespace: draft.customNamespace ?? "" })}
                  mono
                />
              </>
            )}
          </div>
          <Button
            variant="danger"
            className="mt-5 shrink-0"
            onClick={() => setDrafts((rows) => rows.filter((row) => row.id !== draft.id))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function PolicyBindingsPanel({
  organizationId,
  variableGroup,
  policies,
  policyCatalog,
  policyBindings,
  policiesLoading,
  policiesError,
  showAccess,
  access,
  onAccessChange,
  onPoliciesChange,
  onEnsurePolicyBinding,
  onUpdatePolicyBinding,
}: {
  organizationId: string;
  variableGroup: string;
  policies: ConnectionPolicies | undefined;
  policyCatalog: ExchangePolicyCatalog;
  policyBindings: Record<string, DeclaredPolicyBinding>;
  policiesLoading: boolean;
  policiesError: string | null;
  showAccess?: boolean;
  access?: ConnectionAccess;
  onAccessChange?: (access: ConnectionAccess | undefined) => void;
  onPoliciesChange: (policies: ConnectionPolicies | undefined) => void;
  onEnsurePolicyBinding: (bindingName: string, binding: DeclaredPolicyBinding) => void;
  onUpdatePolicyBinding: (bindingName: string, patch: Partial<DeclaredPolicyBinding>) => void;
}) {
  const catalogTotal = policyCatalog.inbound.length + policyCatalog.outbound.length;

  return (
    <div className="space-y-2">
      {showAccess && onAccessChange ? (
        <SelectField
          label="Access"
          value={access ?? "internal"}
          options={[
            { value: "internal", label: "Internal (default)" },
            { value: "shared", label: "Shared" },
          ]}
          onChange={(v) => onAccessChange(v === "internal" ? undefined : v)}
          hint="Omitted from agent-network.yaml when internal (schema default)."
        />
      ) : null}
      <div className="space-y-3 rounded-md border border-gray-200 p-2">
        <div className="flex items-center gap-2">
          <span className="block text-xs font-medium text-gray-600">Policies</span>
          {policiesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" aria-hidden /> : null}
          {!policiesLoading && catalogTotal > 0 ? (
            <span className="text-[11px] text-gray-400">
              {policyCatalog.inbound.length} inbound · {policyCatalog.outbound.length} outbound
            </span>
          ) : null}
        </div>
        <PolicyBindingList
          label="Inbound"
          items={policies?.inbound}
          organizationId={organizationId}
          variableGroup={variableGroup}
          exchangePolicies={policyCatalog.inbound}
          policyBindings={policyBindings}
          policiesLoading={policiesLoading}
          policiesError={policiesError}
          onEnsurePolicyBinding={onEnsurePolicyBinding}
          onUpdatePolicyBinding={onUpdatePolicyBinding}
          onChange={(inbound) => {
            const outbound = policies?.outbound;
            if (!inbound && !outbound) {
              onPoliciesChange(undefined);
              return;
            }
            onPoliciesChange({ ...(inbound ? { inbound } : {}), ...(outbound ? { outbound } : {}) });
          }}
        />
        <PolicyBindingList
          label="Outbound"
          items={policies?.outbound}
          organizationId={organizationId}
          variableGroup={variableGroup}
          exchangePolicies={policyCatalog.outbound}
          policyBindings={policyBindings}
          policiesLoading={policiesLoading}
          policiesError={policiesError}
          onEnsurePolicyBinding={onEnsurePolicyBinding}
          onUpdatePolicyBinding={onUpdatePolicyBinding}
          onChange={(outbound) => {
            const inbound = policies?.inbound;
            if (!inbound && !outbound) {
              onPoliciesChange(undefined);
              return;
            }
            onPoliciesChange({ ...(inbound ? { inbound } : {}), ...(outbound ? { outbound } : {}) });
          }}
        />
      </div>
    </div>
  );
}
