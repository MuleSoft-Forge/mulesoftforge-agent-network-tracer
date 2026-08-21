"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { HelpSectionHeader } from "@/components/composer/HelpLabel";
import { helpForSection } from "@/lib/composer/help/section-help-catalog";
import { useComposer } from "@/lib/composer/store";
import type {
  GraphNode,
  OutputProperty,
  OutputSchemaNode,
  OutputValue,
} from "@/lib/composer/model";
import { Button, SelectField, TextField } from "@/components/composer/ui";

const OUTPUT_TYPES: OutputSchemaNode["type"][] = [
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "object",
];
const ENUM_TYPES = new Set<OutputSchemaNode["type"]>([
  "string",
  "number",
  "integer",
  "boolean",
]);

function enumToInput(values: OutputValue[] | undefined): string {
  return values?.join(", ") ?? "";
}

function inputToEnum(
  value: string,
  type: OutputSchemaNode["type"]
): OutputValue[] | undefined {
  const entries = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (entries.length === 0) return undefined;
  if (type === "number" || type === "integer") {
    return entries
      .map(Number)
      .filter((entry) => Number.isFinite(entry))
      .map((entry) => (type === "integer" ? Math.trunc(entry) : entry));
  }
  if (type === "boolean") {
    return entries.flatMap((entry) => {
      if (entry.toLowerCase() === "true") return [true];
      if (entry.toLowerCase() === "false") return [false];
      return [];
    });
  }
  return entries;
}

function patchOutputList(
  outputs: OutputProperty[],
  index: number,
  patch: Partial<OutputProperty>
): OutputProperty[] {
  return outputs.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row));
}

function enumValuesEqual(
  left: OutputValue[] | undefined,
  right: OutputValue[] | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function EnumValuesField({
  values,
  type,
  onChange,
}: {
  values: OutputValue[] | undefined;
  type: OutputSchemaNode["type"];
  onChange: (next: OutputValue[] | undefined) => void;
}) {
  const [draft, setDraft] = useState(() => enumToInput(values));
  const focusedRef = useRef(false);
  const draftRef = useRef(draft);
  const onChangeRef = useRef(onChange);
  const valuesRef = useRef(values);
  const typeRef = useRef(type);
  draftRef.current = draft;
  onChangeRef.current = onChange;
  valuesRef.current = values;
  typeRef.current = type;

  const valuesKey = enumToInput(values);

  useEffect(() => {
    if (!focusedRef.current) setDraft(valuesKey);
  }, [valuesKey]);

  useEffect(() => {
    return () => {
      const next = inputToEnum(draftRef.current, typeRef.current);
      if (!enumValuesEqual(next, valuesRef.current)) onChangeRef.current(next);
    };
  }, []);

  function commit() {
    const next = inputToEnum(draft, type);
    if (!enumValuesEqual(next, values)) onChange(next);
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
      hint={
        type === "string"
          ? "Comma-separated strings"
          : "Comma-separated numeric values"
      }
      alwaysShowHint
    />
  );
}

function typeChangePatch(
  schema: OutputSchemaNode,
  nextType: OutputSchemaNode["type"]
): Partial<OutputSchemaNode> {
  const cleared: Partial<OutputSchemaNode> = {
    type: nextType,
    default: undefined,
    enum: undefined,
    pattern: undefined,
    minLength: undefined,
    maxLength: undefined,
    minimum: undefined,
    maximum: undefined,
    exclusiveMinimum: undefined,
    exclusiveMaximum: undefined,
    minItems: undefined,
    maxItems: undefined,
    required: undefined,
    properties: undefined,
    items: undefined,
  };
  if (nextType === "array") return { ...cleared, items: schema.items ?? { type: "string" } };
  if (nextType === "object") return { ...cleared, properties: schema.properties ?? [] };
  return cleared;
}

function defaultFromInput(value: string, type: OutputSchemaNode["type"]): OutputValue | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (type === "number" || type === "integer") {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return undefined;
    return type === "integer" ? Math.trunc(numeric) : numeric;
  }
  if (type === "boolean") return trimmed === "true";
  return value;
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
        <Button
          variant="ghost"
          onClick={() => onChange([...outputs, { name: "field", type: "string" }])}
        >
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
      {outputs.length === 0 ? (
        <p className="text-[10px] text-gray-400">No nested fields yet.</p>
      ) : null}
      {outputs.map((output, index) => (
        <OutputPropertyEditor
          key={`${depth}-${index}`}
          output={output}
          depth={depth}
          onChange={(next) => onChange(patchOutputList(outputs, index, next))}
          onRemove={() => onChange(outputs.filter((_, rowIndex) => rowIndex !== index))}
        />
      ))}
    </div>
  );
}

function OutputSchemaFields({
  schema,
  onChange,
  depth,
}: {
  schema: OutputSchemaNode;
  onChange: (patch: Partial<OutputSchemaNode>) => void;
  depth: number;
}) {
  const defaultValue = schema.default === undefined ? "" : String(schema.default);
  return (
    <>
      <TextField
        label="Description"
        value={schema.description ?? ""}
        onChange={(value) => onChange({ description: value.trim() ? value : undefined })}
      />

      {schema.type === "boolean" ? (
        <SelectField
          label="Default"
          value={defaultValue}
          options={[
            { value: "", label: "(none)" },
            { value: "true", label: "true" },
            { value: "false", label: "false" },
          ]}
          onChange={(value) => onChange({ default: defaultFromInput(value, schema.type) })}
        />
      ) : (
        <TextField
          label="Default"
          value={defaultValue}
          onChange={(value) => onChange({ default: defaultFromInput(value, schema.type) })}
          mono
          hint={
            schema.type === "array" || schema.type === "object"
              ? "AgentScript array or object expression emitted without quotes."
              : undefined
          }
        />
      )}

      {schema.type === "string" ? (
        <>
          <TextField
            label="Pattern"
            value={schema.pattern ?? ""}
            onChange={(value) => onChange({ pattern: value.trim() ? value : undefined })}
            mono
          />
          <div className="grid grid-cols-2 gap-2">
            <IntegerField
              label="Min length"
              value={schema.minLength}
              onChange={(minLength) => onChange({ minLength })}
            />
            <IntegerField
              label="Max length"
              value={schema.maxLength}
              onChange={(maxLength) => onChange({ maxLength })}
            />
          </div>
        </>
      ) : null}

      {schema.type === "number" || schema.type === "integer" ? (
        <div className="grid grid-cols-2 gap-2">
          <NumberValueField
            label="Minimum"
            value={schema.minimum}
            onChange={(minimum) => onChange({ minimum })}
          />
          <NumberValueField
            label="Maximum"
            value={schema.maximum}
            onChange={(maximum) => onChange({ maximum })}
          />
          <NumberValueField
            label="Exclusive min"
            value={schema.exclusiveMinimum}
            onChange={(exclusiveMinimum) => onChange({ exclusiveMinimum })}
          />
          <NumberValueField
            label="Exclusive max"
            value={schema.exclusiveMaximum}
            onChange={(exclusiveMaximum) => onChange({ exclusiveMaximum })}
          />
        </div>
      ) : null}

      {schema.type === "array" ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <IntegerField
              label="Min items"
              value={schema.minItems}
              onChange={(minItems) => onChange({ minItems })}
            />
            <IntegerField
              label="Max items"
              value={schema.maxItems}
              onChange={(maxItems) => onChange({ maxItems })}
            />
          </div>
          <OutputItemEditor
            schema={schema.items ?? { type: "string" }}
            depth={depth + 1}
            onChange={(items) => onChange({ items })}
          />
        </>
      ) : null}

      {schema.type === "object" ? (
        <>
          <TextField
            label="Required fields"
            value={schema.required?.join(", ") ?? ""}
            onChange={(value) => {
              const required = value
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean);
              onChange({ required: required.length > 0 ? required : undefined });
            }}
            hint="Comma-separated property names"
            alwaysShowHint
          />
          <OutputPropertyList
            label="Object properties"
            outputs={schema.properties ?? []}
            onChange={(properties) => onChange({ properties })}
            depth={depth + 1}
          />
        </>
      ) : null}

      {ENUM_TYPES.has(schema.type) ? (
        <EnumValuesField
          values={schema.enum}
          type={schema.type}
          onChange={(enumValues) => onChange({ enum: enumValues })}
        />
      ) : null}
    </>
  );
}

function OutputItemEditor({
  schema,
  onChange,
  depth,
}: {
  schema: OutputSchemaNode;
  onChange: (next: OutputSchemaNode) => void;
  depth: number;
}) {
  return (
    <div className="space-y-2 rounded-md border border-dashed border-gray-200 bg-gray-50/50 p-2">
      <SelectField
        label="Items type"
        value={schema.type}
        options={OUTPUT_TYPES.map((type) => ({ value: type, label: type }))}
        onChange={(type) => onChange({ ...schema, ...typeChangePatch(schema, type) })}
        hint="Arrays can nest recursively, including arrays of arrays and structured objects."
        alwaysShowHint
      />
      <OutputSchemaFields
        schema={schema}
        depth={depth}
        onChange={(patch) => onChange({ ...schema, ...patch })}
      />
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
  const borderClass =
    depth > 0 ? "border-dashed border-gray-200 bg-gray-50/50" : "border-gray-200";
  return (
    <div className={`space-y-2 rounded-md border p-2 ${borderClass}`}>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            label="Name"
            value={output.name}
            onChange={(name) => onChange({ name })}
            mono
          />
        </div>
        <div className="w-28 shrink-0">
          <SelectField
            label="Type"
            value={output.type}
            options={OUTPUT_TYPES.map((type) => ({ value: type, label: type }))}
            onChange={(type) => onChange(typeChangePatch(output, type))}
          />
        </div>
        <Button variant="danger" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <OutputSchemaFields schema={output} depth={depth} onChange={onChange} />
    </div>
  );
}

function IntegerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
}) {
  return (
    <TextField
      label={label}
      value={value === undefined ? "" : String(value)}
      onChange={(next) => {
        const trimmed = next.trim();
        if (!trimmed) {
          onChange(undefined);
          return;
        }
        const parsed = Number(trimmed);
        if (Number.isInteger(parsed)) onChange(parsed);
      }}
    />
  );
}

function NumberValueField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
}) {
  return (
    <TextField
      label={label}
      value={value === undefined ? "" : String(value)}
      onChange={(next) => {
        const trimmed = next.trim();
        if (!trimmed) {
          onChange(undefined);
          return;
        }
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
    />
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
          <Button
            variant="ghost"
            onClick={() => update([...outputs, { name: "field", type: "string" }])}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        }
      />
      {outputs.length === 0 ? (
        <p className="px-1 text-[10px] text-gray-400">
          No output fields — add properties for routers and downstream @kind.node.output
          references.
        </p>
      ) : null}
      {outputs.map((output, index) => (
        <OutputPropertyEditor
          key={`${node.id}-${index}`}
          output={output}
          depth={0}
          onChange={(patch) => update(patchOutputList(outputs, index, patch))}
          onRemove={() => update(outputs.filter((_, rowIndex) => rowIndex !== index))}
        />
      ))}
    </div>
  );
}
