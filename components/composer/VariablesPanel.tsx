"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import { deriveVariables } from "@/lib/composer/model";
import { findUndeclaredMarkers, splitMarkerKey } from "@/lib/composer/variable-markers";
import {
  RUNTIME_SYSTEM_LIMITS_DOCS_URL,
  RUNTIME_SYSTEM_LIMIT_VARIABLES,
} from "@/lib/composer/runtime-system-limits";
import { variableDisplayLabel, variableStorageKey } from "@/lib/composer/variable-keys";
import { HelpPanelLine } from "@/components/composer/HelpLabel";
import { helpForSection } from "@/lib/composer/help/section-help-catalog";
import { Button, Checkbox, TextField } from "@/components/composer/ui";

export function VariablesPanel() {
  const { project, dispatch } = useComposer();

  const variables = deriveVariables(project);
  const customKeys = useMemo(
    () => new Set((project.customVariables ?? []).map((v) => variableStorageKey(v))),
    [project.customVariables]
  );
  const undeclared = useMemo(() => findUndeclaredMarkers(project), [project]);

  const [addOpen, setAddOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [group, setGroup] = useState("");
  const [field, setField] = useState("");
  const [def, setDef] = useState("");
  const [secret, setSecret] = useState(false);

  const declaredKeys = useMemo(
    () => new Set(variables.map((v) => variableStorageKey(v))),
    [variables]
  );
  const trimmedGroup = group.trim();
  const trimmedField = field.trim();
  const newKey = `${trimmedGroup}.${trimmedField}`;
  const duplicate = Boolean(trimmedGroup && trimmedField && declaredKeys.has(newKey));
  const canAdd = Boolean(trimmedGroup && trimmedField && !duplicate);

  function addVariable() {
    if (!canAdd) return;
    dispatch({
      type: "addCustomVariable",
      variable: {
        group: trimmedGroup,
        field: trimmedField,
        ...(def.trim() ? { default: def.trim() } : {}),
        ...(secret ? { secret: true } : {}),
      },
    });
    setGroup("");
    setField("");
    setDef("");
    setSecret(false);
  }

  function addMarker(key: string) {
    const { group: g, field: f } = splitMarkerKey(key);
    if (!g || !f) return;
    dispatch({ type: "addCustomVariable", variable: { group: g, field: f } });
  }

  function addRuntimeLimit(key: string) {
    const spec = RUNTIME_SYSTEM_LIMIT_VARIABLES.find((v) => v.key === key);
    if (!spec || declaredKeys.has(key)) return;
    dispatch({
      type: "addCustomVariable",
      variable: {
        field: spec.key,
        flat: true,
        description: spec.description,
        default: spec.defaultValue,
        secret: false,
      },
    });
  }

  const availableRuntimeLimits = RUNTIME_SYSTEM_LIMIT_VARIABLES.filter((v) => !declaredKeys.has(v.key));

  return (
    <div className="space-y-4">
      <HelpPanelLine help={helpForSection("panel.variables")} />

      <div className="rounded-md border border-gray-200">
        <button
          type="button"
          onClick={() => setLimitsOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-700"
        >
          {limitsOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
          )}
          Runtime system limits (optional)
        </button>
        {limitsOpen && (
          <div className="space-y-2 border-t border-gray-200 p-3">
            <p className="text-xs text-gray-500">
              Optional graph execution limits in{" "}
              <span className="font-mono">exchange.json</span> metadata.variables. Values are strings;
              all are non-secret.{" "}
              <a
                href={RUNTIME_SYSTEM_LIMITS_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                MuleSoft docs
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </p>
            {availableRuntimeLimits.length === 0 ? (
              <p className="text-xs text-gray-400">All runtime limit variables are already added.</p>
            ) : (
              availableRuntimeLimits.map((spec) => (
                <div
                  key={spec.key}
                  className="flex items-start justify-between gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] text-gray-800">{spec.key}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-gray-500">{spec.description}</p>
                    <p className="mt-0.5 text-[10px] text-gray-400">Default: {spec.defaultValue}</p>
                  </div>
                  <Button variant="secondary" className="shrink-0" onClick={() => addRuntimeLimit(spec.key)}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {undeclared.length > 0 && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            Undeclared markers found in source ({undeclared.length})
          </div>
          <p className="text-xs text-amber-700">
            These <code className="font-mono">${"{...}"}</code> markers are used but not declared as
            variables. Add them so they&apos;re published to exchange.json.
          </p>
          {undeclared.map((m) => (
            <div
              key={m.key}
              className="flex items-center justify-between gap-2 rounded border border-amber-200 bg-white px-2 py-1.5"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-gray-800">
                  ${"{"}
                  {m.key}
                  {"}"}
                </p>
                <p className="truncate text-[11px] text-gray-400">in {m.locations.join(", ")}</p>
              </div>
              <Button variant="secondary" onClick={() => addMarker(m.key)}>
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-md border border-gray-200">
        <button
          type="button"
          onClick={() => setAddOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-700"
        >
          {addOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
          )}
          Add custom variable
        </button>
        {addOpen && (
          <div className="space-y-2 border-t border-gray-200 p-3">
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Group" value={group} onChange={setGroup} placeholder="myGroup" mono />
              <TextField label="Field" value={field} onChange={setField} placeholder="apiKey" mono />
            </div>
            <TextField label="Default" value={def} onChange={setDef} placeholder="(optional)" mono />
            <div className="flex items-center justify-between">
              <Checkbox label="Secret" checked={secret} onChange={setSecret} />
              <Button variant="primary" onClick={addVariable} disabled={!canAdd}>
                <Plus className="h-3.5 w-3.5" /> Add variable
              </Button>
            </div>
            {duplicate && (
              <p className="text-xs text-red-500">
                <code className="font-mono">
                  ${"{"}
                  {newKey}
                  {"}"}
                </code>{" "}
                is already declared.
              </p>
            )}
          </div>
        )}
      </div>

      {variables.length === 0 ? (
        <p className="text-xs text-gray-400">No variables yet.</p>
      ) : (
        variables.map((v) => {
          const key = variableStorageKey(v);
          const label = variableDisplayLabel(v);
          const isCustom = customKeys.has(key);
          return (
            <div key={key} className="space-y-2 rounded-md border border-gray-200 p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-xs text-gray-700">
                  {v.flat ? label : <>${"{"}{label}{"}"}</>}{" "}
                  {v.secret ? <span className="text-red-500">(secret)</span> : null}
                  {isCustom ? (
                    <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] uppercase text-gray-500">
                      {v.flat ? "runtime limit" : "custom"}
                    </span>
                  ) : null}
                </p>
                {isCustom && (
                  <Button
                    variant="ghost"
                    title="Remove variable"
                    onClick={() =>
                      dispatch({
                        type: "removeCustomVariable",
                        group: v.group,
                        field: v.field,
                        ...(v.flat ? { flat: true } : {}),
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5 text-gray-400" />
                  </Button>
                )}
              </div>
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
        })
      )}
    </div>
  );
}

export default VariablesPanel;
