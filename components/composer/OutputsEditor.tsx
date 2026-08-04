"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { HelpSectionHeader } from "@/components/composer/HelpLabel";
import { helpForSection } from "@/lib/composer/help/section-help-catalog";
import { useComposer } from "@/lib/composer/store";
import type { GraphNode, OutputItemsType, OutputProperty } from "@/lib/composer/model";
import { Button, SelectField, TextField } from "@/components/composer/ui";

const OUTPUT_TYPES: OutputProperty["type"][] = ["string", "number", "integer", "boolean", "array", "object"];
const ENUM_TYPES = new Set<OutputProperty["type"]>(["string", "number", "integer"]);
const ITEM_TYPES: OutputItemsType[] = ["string", "number", "integer", "boolean", "object"];

function enumToInput(values: string[] | undefined): string {
  return values?.join(", ") ?? "";
}

function inputToEnum(value: string): string[] | undefined {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function patchOutputList(
  outputs: OutputProperty[],
  index: number,
  patch: Partial<OutputProperty>
): OutputProperty[] {
  return outputs.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

function enumValuesEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function EnumValuesField({
  values,
  onChange,
}: {
  values: string[] | undefined;
  onChange: (next: string[] | undefined) => void;
}) {
  const [draft, setDraft] = useState(() => enumToInput(values));
  const focusedRef = useRef(false);
  const draftRef = useRef(draft);
  const onChangeRef = useRef(onChange);
  const valuesRef = useRef(values);
  draftRef.current = draft;
  onChangeRef.current = onChange;
  valuesRef.current = values;

  const valuesKey = enumToInput(values);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(valuesKey);
    }
  }, [valuesKey]);

  useEffect(() => {
    return () => {
      const next = inputToEnum(draftRef.current);
      if (!enumValuesEqual(next, valuesRef.current)) {
        onChangeRef.current(next);
      }
    };
  }, []);

  function commit() {
    const next = inputToEnum(draft);
    if (enumValuesEqual(next, values)) return;
    onChange(next);
  }

  return (
    <TextField
      label="Allowed values (enum)"
      value={draft}
      onChange={setDraft}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      hint="Comma-separated — e.g. quote, decline, missing-info, refer"
      alwaysShowHint
    />
  );
}

function onTypeChange(output: OutputProperty, nextType: OutputProperty["type"]): Partial<OutputProperty> {
  if (nextType === "array") {
    return { type: nextType, enum: undefined, properties: undefined, itemsType: output.itemsType ?? "string", itemsProperties: undefined };
  }
  if (nextType === "object") {
    return { type: nextType, enum: undefined, itemsType: undefined, itemsProperties: undefined, properties: output.properties ?? [] };
  }
  if (ENUM_TYPES.has(nextType)) {
    return { type: nextType, itemsType: undefined, itemsProperties: undefined, properties: undefined };
  }
  return { type: nextType, enum: undefined, itemsType: undefined, itemsProperties: undefined, properties: undefined };
}

function onItemsTypeChange(output: OutputProperty, nextItemsType: OutputItemsType): Partial<OutputProperty> {
  if (nextItemsType === "object") {
    return { itemsType: nextItemsType, itemsProperties: output.itemsProperties ?? [] };
  }
  return { itemsType: nextItemsType, itemsProperties: undefined };
}

function OutputPropertyList({
  label,
  outputs,
  onChange,
  depth,
}: {
  label: string;
  outputs: OutputProperty[];
  onChange: (next: OutputProperty[]) => void;
  depth: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
        <Button variant="ghost" onClick={() => onChange([...outputs, { name: "field", type: "string" }])}>
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
      {outputs.length === 0 ? <p className="text-[10px] text-gray-400">No nested fields yet.</p> : null}
      {outputs.map((output, index) => (
        <OutputPropertyEditor
          key={`${depth}-${index}-${output.name}`}
          output={output}
          depth={depth}
          onChange={(next) => onChange(patchOutputList(outputs, index, next))}
          onRemove={() => onChange(outputs.filter((_, i) => i !== index))}
        />
      ))}
    </div>
  );
}

function OutputPropertyEditor({
  output,
  onChange,
  onRemove,
  depth,
}: {
  output: OutputProperty;
  onChange: (patch: Partial<OutputProperty>) => void;
  onRemove: () => void;
  depth: number;
}) {
  const borderCls = depth > 0 ? "border-dashed border-gray-200 bg-gray-50/50" : "border-gray-200";

  return (
    <div className={`space-y-2 rounded-md border p-2 ${borderCls}`}>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField label="Name" value={output.name} onChange={(value) => onChange({ name: value })} mono />
        </div>
        <div className="w-28 shrink-0">
          <SelectField
            label="Type"
            value={output.type}
            options={OUTPUT_TYPES.map((type) => ({ value: type, label: type }))}
            onChange={(value) => onChange(onTypeChange(output, value))}
          />
        </div>
        <Button variant="danger" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <TextField
        label="Description"
        value={output.description ?? ""}
        onChange={(value) => onChange({ description: value.trim() ? value : undefined })}
      />

      <TextField
        label="Default"
        value={output.default ?? ""}
        onChange={(value) => onChange({ default: value.trim() ? value : undefined })}
        mono
      />

      {output.type === "string" ? (
        <>
          <TextField
            label="Pattern"
            value={output.pattern ?? ""}
            onChange={(value) => onChange({ pattern: value.trim() ? value : undefined })}
            mono
          />
          <div className="grid grid-cols-2 gap-2">
            <TextField
              label="Min length"
              value={output.minLength !== undefined ? String(output.minLength) : ""}
              onChange={(value) => {
                const trimmed = value.trim();
                onChange({ minLength: trimmed ? Number.parseInt(trimmed, 10) : undefined });
              }}
            />
            <TextField
              label="Max length"
              value={output.maxLength !== undefined ? String(output.maxLength) : ""}
              onChange={(value) => {
                const trimmed = value.trim();
                onChange({ maxLength: trimmed ? Number.parseInt(trimmed, 10) : undefined });
              }}
            />
          </div>
        </>
      ) : null}

      {output.type === "number" || output.type === "integer" ? (
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Minimum"
            value={output.minimum !== undefined ? String(output.minimum) : ""}
            onChange={(value) => {
              const trimmed = value.trim();
              onChange({ minimum: trimmed ? Number(trimmed) : undefined });
            }}
          />
          <TextField
            label="Maximum"
            value={output.maximum !== undefined ? String(output.maximum) : ""}
            onChange={(value) => {
              const trimmed = value.trim();
              onChange({ maximum: trimmed ? Number(trimmed) : undefined });
            }}
          />
          <TextField
            label="Exclusive min"
            value={output.exclusiveMinimum !== undefined ? String(output.exclusiveMinimum) : ""}
            onChange={(value) => {
              const trimmed = value.trim();
              onChange({ exclusiveMinimum: trimmed ? Number(trimmed) : undefined });
            }}
          />
          <TextField
            label="Exclusive max"
            value={output.exclusiveMaximum !== undefined ? String(output.exclusiveMaximum) : ""}
            onChange={(value) => {
              const trimmed = value.trim();
              onChange({ exclusiveMaximum: trimmed ? Number(trimmed) : undefined });
            }}
          />
        </div>
      ) : null}

      {output.type === "array" ? (
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Min items"
            value={output.minItems !== undefined ? String(output.minItems) : ""}
            onChange={(value) => {
              const trimmed = value.trim();
              onChange({ minItems: trimmed ? Number.parseInt(trimmed, 10) : undefined });
            }}
          />
          <TextField
            label="Max items"
            value={output.maxItems !== undefined ? String(output.maxItems) : ""}
            onChange={(value) => {
              const trimmed = value.trim();
              onChange({ maxItems: trimmed ? Number.parseInt(trimmed, 10) : undefined });
            }}
          />
        </div>
      ) : null}

      {output.type === "object" ? (
        <TextField
          label="Required fields"
          value={output.required?.join(", ") ?? ""}
          onChange={(value) => {
            const parts = value
              .split(",")
              .map((part) => part.trim())
              .filter(Boolean);
            onChange({ required: parts.length > 0 ? parts : undefined });
          }}
          hint="Comma-separated property names"
          alwaysShowHint
        />
      ) : null}

      {ENUM_TYPES.has(output.type) ? (
        <EnumValuesField values={output.enum} onChange={(enumValues) => onChange({ enum: enumValues })} />
      ) : null}

      {output.type === "array" ? (
        <>
          <SelectField
            label="Items type"
            value={output.itemsType ?? "string"}
            options={ITEM_TYPES.map((type) => ({ value: type, label: type }))}
            onChange={(value) => onChange(onItemsTypeChange(output, value))}
            hint="Use object for arrays of structured rows (e.g. triage results)"
            alwaysShowHint
          />
          {output.itemsType === "object" ? (
            <OutputPropertyList
              label="Item properties"
              outputs={output.itemsProperties ?? []}
              onChange={(itemsProperties) => onChange({ itemsProperties })}
              depth={depth + 1}
            />
          ) : null}
        </>
      ) : null}

      {output.type === "object" ? (
        <OutputPropertyList
          label="Object properties"
          outputs={output.properties ?? []}
          onChange={(properties) => onChange({ properties })}
          depth={depth + 1}
        />
      ) : null}
    </div>
  );
}

export default function OutputsEditor({ node }: { node: GraphNode }) {
  const { dispatch } = useComposer();
  const outputs = node.outputs ?? [];
  const help = helpForSection("section.structuredOutputs");

  function update(next: OutputProperty[]) {
    dispatch({ type: "updateNode", id: node.id, patch: { outputs: next } });
  }

  return (
    <div className="space-y-2">
      <HelpSectionHeader
        label="Structured outputs"
        help={help}
        action={
          <Button variant="ghost" onClick={() => update([...outputs, { name: "field", type: "string" }])}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        }
      />
      {outputs.length === 0 ? (
        <p className="px-1 text-[10px] text-gray-400">No output fields — add properties for routers and downstream @kind.node.output references.</p>
      ) : null}
      {outputs.map((output, index) => (
        <OutputPropertyEditor
          key={`${node.id}-${index}-${output.name}`}
          output={output}
          depth={0}
          onChange={(patch) => update(patchOutputList(outputs, index, patch))}
          onRemove={() => update(outputs.filter((_, i) => i !== index))}
        />
      ))}
    </div>
  );
}
