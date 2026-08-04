"use client";

import { Plus, Trash2 } from "lucide-react";
import { HelpSectionHeader } from "@/components/composer/HelpLabel";
import { helpForSection } from "@/lib/composer/help/section-help-catalog";
import type { Broker, ExecutorStatement, GraphNode } from "@/lib/composer/model";
import { Button, SelectField, TextField } from "@/components/composer/ui";

function WithArgsEditor({
  args,
  onChange,
}: {
  args: Array<{ name: string; value: string }>;
  onChange: (next: Array<{ name: string; value: string }>) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-md border border-dashed border-gray-200 bg-gray-50/80 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">With arguments</p>
        <Button variant="ghost" onClick={() => onChange([...args, { name: "arg", value: "..." }])}>
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
      {args.length === 0 ? (
        <p className="text-[10px] text-gray-400">Optional fixed arguments bound when the action is invoked.</p>
      ) : null}
      {args.map((arg, index) => (
        <div key={index} className="flex items-end gap-2">
          <div className="w-32 shrink-0">
            <TextField
              label="Name"
              value={arg.name}
              onChange={(value) => onChange(args.map((row, i) => (i === index ? { ...row, name: value } : row)))}
              mono
            />
          </div>
          <div className="min-w-0 flex-1">
            <TextField
              label="Value"
              value={arg.value}
              onChange={(value) => onChange(args.map((row, i) => (i === index ? { ...row, value } : row)))}
              mono
              hint="Expression or literal, e.g. @variables.submissionId or ..."
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

function patchStatement(statements: ExecutorStatement[], index: number, patch: Partial<ExecutorStatement>): ExecutorStatement[] {
  return statements.map((row, i) => (i === index ? ({ ...row, ...patch } as ExecutorStatement) : row));
}

export default function ExecutorStatementsEditor({
  node,
  broker,
  onChange,
}: {
  node: GraphNode;
  broker: Broker;
  onChange: (next: ExecutorStatement[] | undefined) => void;
}) {
  const statements = node.executorStatements ?? [];
  const actionOptions = broker.actions.map((a) => ({ value: a.name, label: a.name }));

  function update(next: ExecutorStatement[]) {
    onChange(next.length > 0 ? next : undefined);
  }

  return (
    <div className="space-y-2">
      <HelpSectionHeader
        label="Do block"
        help={helpForSection("field.runAction")}
        action={
          <Button
            variant="ghost"
            onClick={() =>
              update([
                ...statements,
                actionOptions[0]
                  ? { kind: "run", actionName: actionOptions[0].value }
                  : { kind: "set", variable: "name", expression: '""' },
              ])
            }
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        }
      />
      {statements.length === 0 ? (
        <p className="text-xs text-gray-400">Add run or set statements for the executor do: block.</p>
      ) : null}
      {statements.map((statement, index) => (
        <div key={index} className="space-y-2 rounded-md border border-gray-200 p-2">
          <div className="flex items-end gap-2">
            <div className="w-28 shrink-0">
              <SelectField
                label="Kind"
                value={statement.kind}
                options={[
                  { value: "run", label: "run" },
                  { value: "set", label: "set" },
                ]}
                onChange={(kind) => {
                  if (kind === "run") {
                    update(
                      patchStatement(statements, index, {
                        kind: "run",
                        actionName: actionOptions[0]?.value ?? "action",
                        variable: undefined,
                        expression: undefined,
                        withArgs: undefined,
                      } as Partial<ExecutorStatement>)
                    );
                  } else {
                    update(
                      patchStatement(statements, index, {
                        kind: "set",
                        variable: "variable",
                        expression: '""',
                        actionName: undefined,
                        withArgs: undefined,
                      } as Partial<ExecutorStatement>)
                    );
                  }
                }}
              />
            </div>
            <Button variant="danger" onClick={() => update(statements.filter((_, i) => i !== index))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {statement.kind === "run" ? (
            <>
              <SelectField
                label="Action"
                value={statement.actionName}
                options={actionOptions.length > 0 ? actionOptions : [{ value: "", label: "(no actions)" }]}
                onChange={(actionName) => update(patchStatement(statements, index, { actionName }))}
                hint="Deterministic action invoked in the executor do: block."
              />
              <WithArgsEditor
                args={statement.withArgs ?? []}
                onChange={(withArgs) =>
                  update(patchStatement(statements, index, { withArgs: withArgs.length > 0 ? withArgs : undefined }))
                }
              />
            </>
          ) : (
            <>
              <TextField
                label="Variable"
                value={statement.variable}
                onChange={(variable) => update(patchStatement(statements, index, { variable }))}
                mono
                hint="Without @variables. prefix — e.g. ticketStatus"
              />
              <TextField
                label="Expression"
                value={statement.expression}
                onChange={(expression) => update(patchStatement(statements, index, { expression }))}
                mono
                hint='Value assigned to @variables.<name>, e.g. "resolved" or @generator.node.output.field'
              />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
