"use client";

import { Plus, Trash2 } from "lucide-react";
import { HelpSectionHeader } from "@/components/composer/HelpLabel";
import { helpForSection } from "@/lib/composer/help/section-help-catalog";
import type {
  Broker,
  ExecutorSetStatement,
  ExecutorStatement,
  GraphNode,
} from "@/lib/composer/model";
import { Button, SelectField, TextField } from "@/components/composer/ui";
import InstructionTextArea from "@/components/composer/InstructionTextArea";
import {
  buildExpressionCatalog,
  type ExpressionCatalog,
} from "@/lib/composer/agentfabric-expression-catalog";

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
                { name: availableNames[0] ?? inputNames[0] ?? "arg", value: '""' },
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
              hint="Fully resolved expression or literal; executors do not support slot filling."
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

function patchStatement(statements: ExecutorStatement[], index: number, patch: Partial<ExecutorStatement>): ExecutorStatement[] {
  return statements.map((row, i) => (i === index ? ({ ...row, ...patch } as ExecutorStatement) : row));
}

function CapturesEditor({
  captures,
  variableOptions,
  catalog,
  onChange,
}: {
  captures: ExecutorSetStatement[];
  variableOptions: Array<{ value: string; label: string }>;
  catalog: ExpressionCatalog;
  onChange: (captures: ExecutorSetStatement[]) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-md border border-dashed border-gray-200 bg-gray-50/80 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
          Capture action outputs
        </p>
        <Button
          variant="ghost"
          onClick={() =>
            onChange([
              ...captures,
              {
                kind: "set",
                variable: variableOptions[0]?.value ?? "variable",
                expression: "@outputs",
              },
            ])
          }
        >
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
      {captures.length === 0 ? (
        <p className="text-[10px] text-gray-400">
          Optional assignments nested under run; expressions can reference @outputs.
        </p>
      ) : null}
      {captures.map((capture, index) => (
        <div key={index} className="flex items-end gap-2">
          <div className="w-40 shrink-0">
            {variableOptions.length > 0 ? (
              <SelectField
                label="Variable"
                value={capture.variable}
                options={[
                  ...variableOptions,
                  ...(variableOptions.some((option) => option.value === capture.variable)
                    ? []
                    : [{ value: capture.variable, label: `${capture.variable} (undeclared)` }]),
                ]}
                onChange={(variable) =>
                  onChange(
                    captures.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, variable } : row
                    )
                  )
                }
              />
            ) : (
              <TextField
                label="Variable"
                value={capture.variable}
                onChange={(variable) =>
                  onChange(
                    captures.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, variable } : row
                    )
                  )
                }
                mono
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <InstructionTextArea
              label="Expression"
              value={capture.expression}
              onChange={(expression) =>
                onChange(
                  captures.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, expression } : row
                  )
                )
              }
              mono
              rows={2}
              hint="Run-scoped result, e.g. @outputs or @outputs.result."
              catalog={catalog}
            />
          </div>
          <Button
            variant="danger"
            onClick={() => onChange(captures.filter((_, rowIndex) => rowIndex !== index))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
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
  const mutableVariableOptions = (broker.agentScriptVariables ?? [])
    .filter((variable) => variable.modifier === "mutable")
    .map((variable) => ({ value: variable.name, label: variable.name }));
  const expressionCatalog = buildExpressionCatalog(broker, { excludeNodeId: node.id });

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
                  : {
                      kind: "set",
                      variable: mutableVariableOptions[0]?.value ?? "variable",
                      expression: '""',
                    },
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
                        captures: undefined,
                      } as Partial<ExecutorStatement>)
                    );
                  } else {
                    update(
                      patchStatement(statements, index, {
                        kind: "set",
                        variable: mutableVariableOptions[0]?.value ?? "variable",
                        expression: '""',
                        actionName: undefined,
                        withArgs: undefined,
                        captures: undefined,
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
                inputNames={
                  broker.actions.find((action) => action.name === statement.actionName)?.inputs?.map((input) => input.name) ??
                  []
                }
                catalog={expressionCatalog}
                onChange={(withArgs) =>
                  update(patchStatement(statements, index, { withArgs: withArgs.length > 0 ? withArgs : undefined }))
                }
              />
              <CapturesEditor
                captures={statement.captures ?? []}
                variableOptions={mutableVariableOptions}
                catalog={expressionCatalog}
                onChange={(captures) =>
                  update(
                    patchStatement(statements, index, {
                      captures: captures.length > 0 ? captures : undefined,
                    })
                  )
                }
              />
            </>
          ) : (
            <>
              {mutableVariableOptions.length > 0 ? (
                <SelectField
                  label="Variable"
                  value={statement.variable}
                  options={[
                    ...mutableVariableOptions,
                    ...(mutableVariableOptions.some((option) => option.value === statement.variable)
                      ? []
                      : [{ value: statement.variable, label: `${statement.variable} (undeclared)` }]),
                  ]}
                  onChange={(variable) =>
                    update(patchStatement(statements, index, { variable }))
                  }
                  hint="Only declared mutable variables can be assigned."
                />
              ) : (
                <TextField
                  label="Variable"
                  value={statement.variable}
                  onChange={(variable) =>
                    update(patchStatement(statements, index, { variable }))
                  }
                  mono
                  hint="Declare a mutable AgentScript variable before assigning it."
                />
              )}
              <InstructionTextArea
                label="Expression"
                value={statement.expression}
                onChange={(expression) => update(patchStatement(statements, index, { expression }))}
                mono
                hint='Value assigned to @variables.<name>, e.g. "resolved" or @generator.node.output.field'
                rows={2}
                catalog={expressionCatalog}
              />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
