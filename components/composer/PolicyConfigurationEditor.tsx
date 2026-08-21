"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { DeclaredPolicyBinding } from "@/lib/composer/connectivity/policy-bindings-zod";
import { applyPolicyConfigVariableDefaults, policyConfigFieldHint } from "@/lib/composer/connectivity/policy-config-defaults";
import { validatePolicyConfiguration } from "@/lib/composer/connectivity/policy-config-validation";
import {
  policyConfigFieldSpecs,
  policyConfigScaffold,
  policyConfigUnsupportedPaths,
  readPolicyConfigField,
  writePolicyConfigField,
} from "@/lib/composer/connectivity/policy-schema-fields";
import { usePolicyTemplate } from "@/components/composer/usePolicyTemplate";
import { Button, SelectField, TextArea, TextField } from "@/components/composer/ui";

type ConfigMode = "fields" | "yaml";

function serializeConfiguration(configuration: Record<string, unknown>): string {
  return Object.keys(configuration).length === 0 ? "" : stringifyYaml(configuration);
}

function parameterNames(configurationSchema: unknown): string[] {
  const props = (configurationSchema as { properties?: Record<string, unknown> } | null)?.properties;
  return props ? Object.keys(props) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMergeScaffold(
  existing: Record<string, unknown>,
  scaffold: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(scaffold)) {
    const current = out[key];
    if (isRecord(current) && isRecord(value)) {
      out[key] = deepMergeScaffold(current, value);
      continue;
    }
    if (current === undefined) out[key] = value;
  }
  return out;
}

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
  const schema = detail?.configurationSchema ?? null;
  const fields = schema ? policyConfigFieldSpecs(schema, configuration) : [];
  const unsupportedPaths = useMemo(() => policyConfigUnsupportedPaths(schema), [schema]);
  const issues = useMemo(() => validatePolicyConfiguration(schema, configuration), [schema, configuration]);
  const defaultsAppliedKey = useRef<string | null>(null);

  const [modeOverride, setModeOverride] = useState<ConfigMode | null>(null);
  // Policies whose parameters the form can't express (arrays, free-form objects)
  // open in YAML so the whole configuration is always reachable.
  const mode = modeOverride ?? (unsupportedPaths.length > 0 ? "yaml" : "fields");

  const canonicalYaml = useMemo(() => serializeConfiguration(configuration), [configuration]);
  const [draft, setDraft] = useState(canonicalYaml);
  const [yamlError, setYamlError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(canonicalYaml);
    setYamlError(null);
  }, [canonicalYaml]);

  useEffect(() => {
    if (!schema || !binding) return;
    const key = `${bindingName}:${detail?.assetId}:${detail?.version ?? ""}`;
    if (defaultsAppliedKey.current === key) return;

    const withDefaults = applyPolicyConfigVariableDefaults(binding.configuration ?? {}, schema, variableGroup);
    if (withDefaults !== binding.configuration) {
      onChange(bindingName, { configuration: withDefaults });
    }
    defaultsAppliedKey.current = key;
  }, [binding, bindingName, detail?.assetId, detail?.version, onChange, schema, variableGroup]);

  if (!binding) return null;

  function commitDraft() {
    const text = draft.trim();
    if (!text) {
      setYamlError(null);
      if (Object.keys(configuration).length > 0) onChange(bindingName, { configuration: {} });
      return;
    }
    let parsed: unknown;
    try {
      parsed = parseYaml(text);
    } catch (e) {
      setYamlError((e as Error).message);
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setYamlError("Configuration must be a YAML mapping of policy parameters.");
      return;
    }
    setYamlError(null);
    onChange(bindingName, { configuration: parsed as Record<string, unknown> });
  }

  function insertScaffold(mode: "required" | "defaults") {
    if (!schema) return;
    const scaffold = policyConfigScaffold(schema, mode);
    const merged = deepMergeScaffold(configuration, scaffold);
    onChange(bindingName, { configuration: merged });
    setModeOverride("yaml");
  }

  const parameters = parameterNames(schema);

  return (
    <div className="space-y-1.5 rounded border border-dashed border-gray-200 bg-white p-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-gray-500">
          Configuration · <span className="font-mono">{bindingName}</span>
        </span>
        {loading ? <Loader2 className="h-3 w-3 animate-spin text-gray-400" aria-hidden /> : null}
        <div className="ml-auto flex gap-1">
          <Button
            variant={mode === "fields" ? "primary" : "secondary"}
            className="h-6 px-2 text-[11px]"
            onClick={() => setModeOverride("fields")}
          >
            Fields
          </Button>
          <Button
            variant={mode === "yaml" ? "primary" : "secondary"}
            className="h-6 px-2 text-[11px]"
            onClick={() => setModeOverride("yaml")}
          >
            YAML
          </Button>
        </div>
      </div>
      <SelectField
        label="Binding access"
        value={binding.access ?? "internal"}
        options={[
          { value: "internal", label: "Internal (default)" },
          { value: "shared", label: "Shared" },
        ]}
        onChange={(v) => onChange(bindingName, { access: v === "internal" ? undefined : v })}
        alwaysShowHint
        hint="Optional — internal is the default and keeps the policy private to this network. Choose shared to let other networks reuse it."
      />
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}

      {mode === "yaml" ? (
        <>
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="secondary"
              className="h-6 px-2 text-[11px]"
              onClick={() => insertScaffold("required")}
              disabled={!schema}
            >
              Insert required structure
            </Button>
            <Button
              variant="secondary"
              className="h-6 px-2 text-[11px]"
              onClick={() => insertScaffold("defaults")}
              disabled={!schema}
            >
              Insert defaults
            </Button>
          </div>
          <TextArea
            label="Configuration (YAML)"
            value={draft}
            onChange={setDraft}
            onBlur={commitDraft}
            rows={8}
            mono
            error={yamlError ?? undefined}
            alwaysShowHint
            hint={
              parameters.length > 0
                ? `Parameters: ${parameters.join(", ")}. Expand the schema below for types and defaults.`
                : "Written verbatim to context.policies.<binding>.configuration."
            }
          />
        </>
      ) : (
        <>
          {!loading && !error && fields.length === 0 ? (
            <p className="text-[11px] text-gray-400">
              {templateVersion
                ? "No editable parameters in this policy schema (may use defaults)."
                : "Pick a catalog policy with a version to load parameters."}
            </p>
          ) : null}
          {unsupportedPaths.length > 0 ? (
            <p className="text-[11px] text-amber-700">
              <span className="font-mono">{unsupportedPaths.join(", ")}</span>{" "}
              {unsupportedPaths.length === 1 ? "takes" : "take"} structured values — edit in YAML mode.
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
        </>
      )}

      {issues.length > 0 ? (
        <div className="rounded border border-red-200 bg-red-50 p-2">
          <p className="text-[11px] font-medium text-red-700">
            {issues.length === 1 ? "1 problem" : `${issues.length} problems`} the CLI will reject on deploy
          </p>
          <ul className="mt-1 space-y-0.5">
            {issues.map((issue) => (
              <li key={`${issue.path}::${issue.message}`} className="text-[11px] text-red-700">
                <span className="font-mono">{issue.path}</span> {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {schema ? (
        <details className="rounded border border-gray-200 bg-gray-50/60 px-2 py-1.5">
          <summary className="cursor-pointer text-[11px] text-gray-500">
            Policy schema · <span className="font-mono">{assetId}</span>
            {templateVersion ? ` ${templateVersion}` : ""}
          </summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed text-gray-600">
            {JSON.stringify(schema, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
