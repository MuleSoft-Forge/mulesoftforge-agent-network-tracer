"use client";

import { Plus, Trash2 } from "lucide-react";
import InstructionTextArea from "@/components/composer/InstructionTextArea";
import { Button, Checkbox, SelectField, TextField } from "@/components/composer/ui";
import { buildExpressionCatalog } from "@/lib/composer/agentfabric-expression-catalog";
import { AGENTSCRIPT_ACTION_INPUT_TYPES } from "@/lib/composer/agentscript-contract";
import type { AgentScriptVariable, Broker } from "@/lib/composer/model";
import { useComposer } from "@/lib/composer/store";

function patchVariable(
  variables: AgentScriptVariable[],
  index: number,
  patch: Partial<AgentScriptVariable>
): AgentScriptVariable[] {
  return variables.map((variable, variableIndex) =>
    variableIndex === index ? { ...variable, ...patch } : variable
  );
}

export default function AgentScriptVariablesEditor({ broker }: { broker: Broker }) {
  const { dispatch } = useComposer();
  const variables = broker.agentScriptVariables ?? [];
  const catalog = buildExpressionCatalog(broker);

  function update(agentScriptVariables: AgentScriptVariable[]) {
    dispatch({ type: "updateBroker", patch: { agentScriptVariables } });
  }

  return (
    <div className="space-y-2 rounded-md border border-gray-200 p-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-gray-700">AgentScript variables</p>
          <p className="text-[10px] text-gray-400">
            Declared in brokers/*.agent and referenced as @variables.&lt;name&gt;.
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() =>
            update([
              ...variables,
              { name: "variable", modifier: "mutable", type: "string" },
            ])
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
      {variables.length === 0 ? (
        <p className="text-[10px] text-gray-400">
          No declarations. Add a mutable variable before assigning it from an executor.
        </p>
      ) : null}
      {variables.map((variable, index) => (
        <div
          key={`${variable.name}-${index}`}
          className="space-y-2 rounded-md border border-dashed border-gray-200 bg-gray-50/50 p-2"
        >
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <TextField
                label="Name"
                value={variable.name}
                onChange={(name) => update(patchVariable(variables, index, { name }))}
                mono
              />
            </div>
            <div className="w-28 shrink-0">
              <SelectField
                label="Modifier"
                value={variable.modifier}
                options={[
                  { value: "mutable", label: "mutable" },
                  { value: "linked", label: "linked" },
                ]}
                onChange={(modifier) =>
                  update(
                    patchVariable(variables, index, {
                      modifier,
                      ...(modifier === "linked" ? { defaultExpression: undefined } : {}),
                    })
                  )
                }
              />
            </div>
            <div className="w-28 shrink-0">
              <SelectField
                label="Type"
                value={variable.type}
                options={AGENTSCRIPT_ACTION_INPUT_TYPES.map((type) => ({
                  value: type,
                  label: type,
                }))}
                onChange={(type) => update(patchVariable(variables, index, { type }))}
              />
            </div>
            <Button
              variant="danger"
              onClick={() => update(variables.filter((_, variableIndex) => variableIndex !== index))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {variable.modifier === "mutable" ? (
            <InstructionTextArea
              label="Default expression"
              value={variable.defaultExpression ?? ""}
              onChange={(defaultExpression) =>
                update(
                  patchVariable(variables, index, {
                    defaultExpression: defaultExpression.trim()
                      ? defaultExpression
                      : undefined,
                  })
                )
              }
              rows={2}
              mono
              catalog={catalog}
              hint={'Optional AgentScript expression, e.g. "", 0, False, or {}.'}
            />
          ) : null}
          <TextField
            label="Label"
            value={variable.label ?? ""}
            onChange={(label) =>
              update(
                patchVariable(variables, index, {
                  label: label.trim() ? label : undefined,
                })
              )
            }
          />
          <TextField
            label="Description"
            value={variable.description ?? ""}
            onChange={(description) =>
              update(
                patchVariable(variables, index, {
                  description: description.trim() ? description : undefined,
                })
              )
            }
          />
          <Checkbox
            label="Required"
            checked={variable.isRequired ?? false}
            onChange={(isRequired) =>
              update(
                patchVariable(variables, index, {
                  isRequired: isRequired || undefined,
                })
              )
            }
          />
        </div>
      ))}
    </div>
  );
}
