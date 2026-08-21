"use client";

import { Plus, Trash2 } from "lucide-react";
import { HelpSectionHeader } from "@/components/composer/HelpLabel";
import { helpForSection } from "@/lib/composer/help/section-help-catalog";
import { useComposer } from "@/lib/composer/store";
import type { Broker, GraphNode, OrchestratorActionBinding } from "@/lib/composer/model";
import { Button, SelectField, TextField } from "@/components/composer/ui";
import InstructionTextArea from "@/components/composer/InstructionTextArea";
import {
  buildExpressionCatalog,
  type ExpressionCatalog,
} from "@/lib/composer/agentfabric-expression-catalog";

function effectiveBindings(node: GraphNode): OrchestratorActionBinding[] {
  if (node.actionBindings && node.actionBindings.length > 0) return node.actionBindings;
  return (node.actionRefs ?? []).map((name) => ({ alias: name, actionName: name }));
}

function syncBindings(dispatch: ReturnType<typeof useComposer>["dispatch"], node: GraphNode, bindings: OrchestratorActionBinding[]) {
  dispatch({
    type: "updateNode",
    id: node.id,
    patch: {
      actionBindings: bindings,
      actionRefs: bindings.map((b) => b.actionName),
    },
  });
}

function patchBinding(
  bindings: OrchestratorActionBinding[],
  index: number,
  patch: Partial<OrchestratorActionBinding>
): OrchestratorActionBinding[] {
  return bindings.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

function WithArgsEditor({
  args,
  inputNames,
  catalog,
  onChange,
}: {
  args: Array<{ name: string; value: string }>;
  inputNames: string[];
  catalog: ExpressionCatalog;
  onChange: (next: Array<{ name: string; value: string }>) => void;
}) {
  const availableNames = inputNames.filter((name) => !args.some((argument) => argument.name === name));
  return (
    <div className="space-y-1.5 rounded-md border border-dashed border-gray-200 bg-gray-50/80 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">With arguments</p>
        <div className="flex items-center gap-1">
          {!args.some((argument) => argument.name === "http_headers") ? (
            <Button
              variant="ghost"
              onClick={() => onChange([...args, { name: "http_headers", value: "{}" }])}
              title="Invocation-level HTTP headers"
            >
              Headers
            </Button>
          ) : null}
          <Button
            variant="ghost"
            onClick={() =>
              onChange([
                ...args,
                { name: availableNames[0] ?? inputNames[0] ?? "arg", value: "..." },
              ])
            }
          >
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
      </div>
      {args.length === 0 ? (
        <p className="text-[10px] text-gray-400">Optional fixed arguments bound when the action is invoked.</p>
      ) : null}
      {args.map((arg, index) => (
        <div key={index} className="flex items-end gap-2">
          <div className="w-32 shrink-0">
            {inputNames.length > 0 ? (
              <SelectField
                label="Name"
                value={arg.name}
                options={[...new Set([...inputNames, "http_headers", arg.name])].map((name) => ({
                  value: name,
                  label: name,
                }))}
                onChange={(value) =>
                  onChange(args.map((row, rowIndex) => (rowIndex === index ? { ...row, name: value } : row)))
                }
              />
            ) : (
              <TextField
                label="Name"
                value={arg.name}
                onChange={(value) =>
                  onChange(args.map((row, rowIndex) => (rowIndex === index ? { ...row, name: value } : row)))
                }
                mono
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <InstructionTextArea
              label="Value"
              value={arg.value}
              onChange={(value) =>
                onChange(args.map((row, rowIndex) => (rowIndex === index ? { ...row, value } : row)))
              }
              mono
              hint="Expression or literal, e.g. @variables.submissionId or ..."
              rows={2}
              catalog={catalog}
            />
          </div>
          <Button variant="danger" onClick={() => onChange(args.filter((_, i) => i !== index))}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

export default function ActionBindingsEditor({ node, broker }: { node: GraphNode; broker: Broker }) {
  const { dispatch } = useComposer();
  const bindings = effectiveBindings(node);
  const actionOptions = broker.actions.map((a) => ({ value: a.name, label: a.name }));
  const expressionCatalog = buildExpressionCatalog(broker, { excludeNodeId: node.id });

  function update(next: OrchestratorActionBinding[]) {
    syncBindings(dispatch, node, next);
  }

  return (
    <div className="space-y-2">
      <HelpSectionHeader
        label="Actions available to this node"
        help={helpForSection("section.actionsAvailable")}
        action={
          actionOptions.length > 0 ? (
            <Button
              variant="ghost"
              onClick={() =>
                update([
                  ...bindings,
                  {
                    alias: actionOptions[0].value.replace(/[^a-zA-Z0-9_]/g, "_"),
                    actionName: actionOptions[0].value,
                  },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          ) : null
        }
      />
      {broker.actions.length === 0 ? (
        <p className="text-xs text-gray-400">No actions — compose agents/MCP on the Actions tab first.</p>
      ) : null}
      {bindings.map((binding, index) => (
        <div key={`action-binding-${index}`} className="space-y-2 rounded-md border border-gray-200 p-2">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <TextField
                label="Alias"
                value={binding.alias}
                onChange={(value) => update(patchBinding(bindings, index, { alias: value }))}
                mono
                hint="Name used in reasoning instructions, e.g. extract, assess"
              />
            </div>
            <div className="min-w-0 flex-1">
              <SelectField
                label="Action"
                value={binding.actionName}
                options={actionOptions}
                onChange={(value) => update(patchBinding(bindings, index, { actionName: value }))}
              />
            </div>
            <Button variant="danger" onClick={() => update(bindings.filter((_, i) => i !== index))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <WithArgsEditor
            args={binding.withArgs ?? []}
            inputNames={
              broker.actions.find((action) => action.name === binding.actionName)?.inputs?.map((input) => input.name) ??
              []
            }
            catalog={expressionCatalog}
            onChange={(withArgs) => update(patchBinding(bindings, index, { withArgs: withArgs.length > 0 ? withArgs : undefined }))}
          />
        </div>
      ))}
    </div>
  );
}
