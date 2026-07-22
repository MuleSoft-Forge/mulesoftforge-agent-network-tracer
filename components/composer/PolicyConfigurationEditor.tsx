"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { DeclaredPolicyBinding } from "@/lib/composer/connectivity/policy-bindings-zod";
import { applyPolicyConfigVariableDefaults, policyConfigFieldHint } from "@/lib/composer/connectivity/policy-config-defaults";
import {
  policyConfigFieldSpecs,
  readPolicyConfigField,
  writePolicyConfigField,
} from "@/lib/composer/connectivity/policy-schema-fields";
import { usePolicyTemplate } from "@/components/composer/usePolicyTemplate";
import { SelectField, TextField } from "@/components/composer/ui";

export function PolicyConfigurationEditor({
  organizationId,
  bindingName,
  binding,
  variableGroup,
  groupId,
  assetId,
  templateVersion,
  onChange,
}: {
  organizationId: string;
  bindingName: string;
  binding: DeclaredPolicyBinding | undefined;
  /** exchange.json metadata.variables group for ${group.field} placeholders. */
  variableGroup: string;
  groupId: string | undefined;
  assetId: string | undefined;
  templateVersion: string | null | undefined;
  onChange: (bindingName: string, patch: Partial<DeclaredPolicyBinding>) => void;
}) {
  const { detail, loading, error } = usePolicyTemplate({
    organizationId,
    groupId,
    assetId,
    version: templateVersion,
    enabled: Boolean(groupId && assetId && templateVersion),
  });

  const configuration = binding?.configuration ?? {};
  const fields = detail?.configurationSchema ? policyConfigFieldSpecs(detail.configurationSchema) : [];
  const defaultsAppliedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!detail?.configurationSchema || !binding) return;
    const key = `${bindingName}:${detail.assetId}:${detail.version ?? ""}`;
    if (defaultsAppliedKey.current === key) return;

    const withDefaults = applyPolicyConfigVariableDefaults(
      binding.configuration ?? {},
      detail.configurationSchema,
      variableGroup
    );
    if (withDefaults !== binding.configuration) {
      onChange(bindingName, { configuration: withDefaults });
    }
    defaultsAppliedKey.current = key;
  }, [
    binding,
    bindingName,
    detail?.assetId,
    detail?.configurationSchema,
    detail?.version,
    onChange,
    variableGroup,
  ]);

  if (!binding) return null;

  return (
    <div className="space-y-1.5 rounded border border-dashed border-gray-200 bg-white p-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-gray-500">
          Configuration · <span className="font-mono">{bindingName}</span>
        </span>
        {loading ? <Loader2 className="h-3 w-3 animate-spin text-gray-400" aria-hidden /> : null}
      </div>
      <SelectField
        label="Binding access"
        value={binding.access ?? "internal"}
        options={[
          { value: "internal", label: "Internal (default)" },
          { value: "shared", label: "Shared" },
        ]}
        onChange={(v) => onChange(bindingName, { access: v === "internal" ? undefined : v })}
        hint="context.policies.{name}.access — omitted when internal."
      />
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
      {!loading && !error && fields.length === 0 ? (
        <p className="text-[11px] text-gray-400">
          {templateVersion
            ? "No editable parameters in this policy schema (may use defaults)."
            : "Pick a catalog policy with a version to load parameters."}
        </p>
      ) : null}
      {fields.map((field) => {
        const value = readPolicyConfigField(configuration, field.path);
        const hint = policyConfigFieldHint(field, variableGroup);
        if (field.input === "boolean") {
          return (
            <SelectField
              key={field.path}
              label={`${field.label}${field.required ? " *" : ""}`}
              value={value || "false"}
              options={[
                { value: "false", label: "false" },
                { value: "true", label: "true" },
              ]}
              onChange={(v) =>
                onChange(bindingName, {
                  configuration: writePolicyConfigField(configuration, field.path, v, field.input),
                })
              }
              hint={hint}
            />
          );
        }
        if (field.input === "select" && field.options?.length) {
          return (
            <SelectField
              key={field.path}
              label={`${field.label}${field.required ? " *" : ""}`}
              value={value}
              options={[{ value: "", label: "—" }, ...field.options]}
              onChange={(v) =>
                onChange(bindingName, {
                  configuration: writePolicyConfigField(configuration, field.path, v, field.input),
                })
              }
              hint={hint}
            />
          );
        }
        return (
          <TextField
            key={field.path}
            label={`${field.label}${field.required ? " *" : ""}`}
            value={value}
            onChange={(v) =>
              onChange(bindingName, {
                configuration: writePolicyConfigField(configuration, field.path, v, field.input),
              })
            }
            mono={field.secret || value.includes("${")}
            hint={hint}
          />
        );
      })}
    </div>
  );
}
