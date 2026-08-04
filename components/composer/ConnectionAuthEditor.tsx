"use client";

import {
  allowedAuthOptions,
  authFieldSpecs,
  authKindFromAuth,
  authKindRequiresAuthentication,
  createDefaultAuth,
  readAuthField,
  writeAuthField,
  type ConnectionAuth,
  type ConnectionAuthKind,
  type ConnectionKind,
} from "@/lib/composer/connectivity";
import { variableGroupForAsset, type ImportedAsset } from "@/lib/composer/model";
import { SelectField, TextField } from "@/components/composer/ui";
import { Checkbox } from "@/components/composer/ui";

function fieldHint(secret: boolean, custom?: string): string | undefined {
  if (custom) return custom;
  if (secret) return "Deploy secret (${group.field} or literal)";
  return undefined;
}

export function ConnectionAuthEditor({
  asset,
  onChange,
}: {
  asset: ImportedAsset;
  onChange: (authentication: ConnectionAuth | undefined) => void;
}) {
  const connectionKind: ConnectionKind =
    asset.kind === "agent" ? "a2a" : asset.kind === "mcp" ? "mcp" : "llm";
  const options = allowedAuthOptions(connectionKind);
  const selectedKind = authKindFromAuth(asset.authentication);
  const variableGroup = variableGroupForAsset(asset);

  function setKind(kind: ConnectionAuthKind | "none") {
    if (kind === "none") {
      onChange(undefined);
      return;
    }
    onChange(createDefaultAuth(kind, variableGroup));
  }

  const auth = asset.authentication;

  return (
    <div className="space-y-2">
      <SelectField
        label="Authentication"
        value={selectedKind}
        options={options.map((o) => ({ value: o.kind, label: o.label }))}
        onChange={(v) => setKind(v as ConnectionAuthKind | "none")}
        hint={
          authKindRequiresAuthentication(connectionKind)
            ? "Required for LLM connections (agent_network_v2.json)."
            : "Optional connection authentication per official schema."
        }
      />
      {auth
        ? authFieldSpecs(auth.kind)
            .filter((field) => {
              if (!field.showWhen) return true;
              return readAuthField(auth, field.showWhen.path) === field.showWhen.equals;
            })
            .map((field) => {
            const value = readAuthField(auth, field.path);
            const hint = fieldHint(field.secret, field.hint);
            if (field.input === "boolean") {
              return (
                <Checkbox
                  key={field.path}
                  label={field.label}
                  checked={value === "true"}
                  onChange={(checked) =>
                    onChange(writeAuthField(auth, field.path, checked ? "true" : "false", "boolean"))
                  }
                />
              );
            }
            if (field.input === "select" && field.options?.length) {
              return (
                <SelectField
                  key={field.path}
                  label={field.label}
                  value={value}
                  options={field.options}
                  onChange={(v) => onChange(writeAuthField(auth, field.path, v, field.input))}
                  hint={hint}
                />
              );
            }
            return (
              <TextField
                key={field.path}
                label={field.label}
                value={value}
                onChange={(v) => onChange(writeAuthField(auth, field.path, v, field.input))}
                mono={field.mono}
                hint={hint}
              />
            );
          })
        : null}
    </div>
  );
}
