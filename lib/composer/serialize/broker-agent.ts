import type {
  Broker,
  BrokerAction,
  AgentScriptVariable,
  GraphNode,
  LlmBinding,
  OutputProperty,
  OutputSchemaNode,
  OutputValue,
} from "@/lib/composer/model";
import { emitStatusMessageLines, formatMessageExpr } from "@/lib/composer/echo-expressions";
import { llmTuningYamlEntries } from "@/lib/composer/llm-binding-params";
import { brokerKey, indentBlock } from "@/lib/composer/serialize/util";
import { AGENTSCRIPT_CONTRACT } from "@/lib/composer/agentscript-contract";
import { compactAgentScriptExpression } from "@/lib/composer/agentscript-expression";

/** Double-quoted, escaped single-line string. */
function q(s: string): string {
  return JSON.stringify(s ?? "");
}

function outputValue(value: OutputValue): string {
  if (typeof value === "string") return q(value);
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

function agentScriptBoolean(value: boolean): string {
  return value ? "True" : "False";
}

function oneLineExpression(value: string): string {
  return compactAgentScriptExpression(value);
}

/** Reference to a node in transition/route syntax: `@<kind>.<name>`. */
function nodeRef(node: GraphNode): string {
  return `@${node.kind}.${node.name}`;
}

function unresolvedNodeRef(targetId: string | undefined, field: string): string {
  const rawName = targetId?.trim() || `missing_${field}`;
  const normalized = rawName.replace(/[^A-Za-z0-9_]/g, "_");
  const name = /^[A-Za-z]/.test(normalized) ? normalized : `node_${normalized}`;
  return `@unresolved.${name}`;
}

/** Emit one recursively nested output schema at the given indent. */
function emitOutputSchema(schema: OutputSchemaNode, indent: number): string[] {
  const lines: string[] = [];
  const pad = " ".repeat(indent);
  lines.push(`${pad}type: ${q(schema.type)}`);
  if (schema.description) lines.push(`${pad}description: ${q(schema.description)}`);
  if (schema.default !== undefined) {
    const defaultValue =
      (schema.type === "object" || schema.type === "array") &&
      typeof schema.default === "string"
        ? oneLineExpression(schema.default)
        : outputValue(schema.default);
    lines.push(`${pad}default: ${defaultValue}`);
  }
  if (schema.pattern) lines.push(`${pad}pattern: ${q(schema.pattern)}`);
  if (schema.minLength !== undefined) lines.push(`${pad}minLength: ${schema.minLength}`);
  if (schema.maxLength !== undefined) lines.push(`${pad}maxLength: ${schema.maxLength}`);
  if (schema.minimum !== undefined) lines.push(`${pad}minimum: ${schema.minimum}`);
  if (schema.maximum !== undefined) lines.push(`${pad}maximum: ${schema.maximum}`);
  if (schema.exclusiveMinimum !== undefined) lines.push(`${pad}exclusiveMinimum: ${schema.exclusiveMinimum}`);
  if (schema.exclusiveMaximum !== undefined) lines.push(`${pad}exclusiveMaximum: ${schema.exclusiveMaximum}`);
  if (schema.minItems !== undefined) lines.push(`${pad}minItems: ${schema.minItems}`);
  if (schema.maxItems !== undefined) lines.push(`${pad}maxItems: ${schema.maxItems}`);
  if (schema.required && schema.required.length > 0) {
    lines.push(`${pad}required:`);
    for (const req of schema.required) {
      lines.push(`${pad}  - ${q(req)}`);
    }
  }
  if (schema.enum && schema.enum.length > 0) {
    lines.push(`${pad}enum:`);
    for (const entry of schema.enum) {
      lines.push(`${pad}  - ${outputValue(entry)}`);
    }
  }
  if (schema.type === "object" && schema.properties && schema.properties.length > 0) {
    lines.push(`${pad}properties:`);
    for (const child of schema.properties) {
      lines.push(...emitOutputProperty(child, indent + 2));
    }
  }
  if (schema.type === "array" && schema.items) {
    lines.push(`${pad}items:`);
    lines.push(...emitOutputSchema(schema.items, indent + 2));
  }
  return lines;
}

/** Emit one named output property at the given indent. */
function emitOutputProperty(property: OutputProperty, indent: number): string[] {
  const pad = " ".repeat(indent);
  return [`${pad}${property.name}:`, ...emitOutputSchema(property, indent + 2)];
}

/** Emit an `outputs:` block (schema notation) at the given base indent. */
function emitOutputs(outputs: OutputProperty[], indent: number): string[] {
  if (!outputs || outputs.length === 0) return [];
  const lines: string[] = [];
  const pad = " ".repeat(indent);
  lines.push(`${pad}outputs:`);
  lines.push(`${pad}  properties:`);
  for (const p of outputs) {
    lines.push(...emitOutputProperty(p, indent + 4));
  }
  return lines;
}

/** Emit a `|` block scalar for multi-line instruction/prompt text. */
function emitBlockScalar(key: string, value: string, indent: number): string[] {
  const pad = " ".repeat(indent);
  const lines = [`${pad}${key}: |`];
  lines.push(indentBlock(value, indent + 2));
  return lines;
}

/**
 * The `->` arrow-prefixed template form only parses as a single line — the
 * official parser rejects a bare `|` followed by continuation lines
 * (`Expected a string or a template, got identifier`). Multi-line content
 * drops the arrow and uses a plain `|` block scalar instead, which the
 * parser treats as a template too (interpolation still works) and does
 * support continuation lines.
 */
function emitProcedureInstruction(content: string, indent: number, inline = false): string[] {
  const pad = " ".repeat(indent);
  if (inline) return [`${pad}instructions: -> ${oneLineExpression(content)}`];
  if (content.includes("\n")) {
    return [`${pad}instructions: |`, indentBlock(content, indent + 2)];
  }
  return [`${pad}instructions: ->`, `${pad}  | ${content}`];
}

function emitPromptProcedure(content: string, indent: number, inline = false): string[] {
  const pad = " ".repeat(indent);
  if (inline) return [`${pad}prompt: -> ${oneLineExpression(content)}`];
  if (content.includes("\n")) {
    return [`${pad}prompt: |`, indentBlock(content, indent + 2)];
  }
  return [`${pad}prompt: ->`, `${pad}  | ${content}`];
}

function emitLlm(bindings: LlmBinding[]): string[] {
  if (bindings.length === 0) return [];
  const lines: string[] = ["llm:"];
  for (const b of bindings) {
    lines.push(`  ${b.name}:`);
    lines.push(`    target: ${q(`llm://${b.connectionName}`)}`);
    lines.push(`    kind: ${q(b.provider)}`);
    lines.push(`    model: ${q(b.model)}`);
    if (b.headers) lines.push(`    headers: ${oneLineExpression(b.headers)}`);
    if (b.timeout !== undefined) lines.push(`    timeout: ${b.timeout}`);
    if (b.apiKey) lines.push(`    api_key: ${q(b.apiKey)}`);
    for (const [key, value] of llmTuningYamlEntries(b)) {
      lines.push(`    ${key}: ${typeof value === "string" ? q(value) : String(value)}`);
    }
    if (b.params) {
      for (const [k, v] of Object.entries(b.params)) {
        if (k === "headers" || k === "timeout" || k === "api_key") continue;
        lines.push(`    ${k}: ${typeof v === "string" ? q(v) : String(v)}`);
      }
    }
  }
  lines.push("");
  return lines;
}

function emitVariables(variables: AgentScriptVariable[]): string[] {
  if (variables.length === 0) return [];
  const lines = ["variables:"];
  for (const variable of variables) {
    const defaultValue = variable.defaultExpression
      ? ` = ${oneLineExpression(variable.defaultExpression)}`
      : "";
    lines.push(`  ${variable.name}: ${variable.modifier} ${variable.type}${defaultValue}`);
    if (variable.label) lines.push(`    label: ${q(variable.label)}`);
    if (variable.description) lines.push(`    description: ${q(variable.description)}`);
    if (variable.isRequired !== undefined) {
      lines.push(`    is_required: ${variable.isRequired ? "True" : "False"}`);
    }
  }
  lines.push("");
  return lines;
}

function emitActions(actions: BrokerAction[]): string[] {
  if (actions.length === 0) return [];
  const lines: string[] = ["actions:"];
  for (const a of actions) {
    const scheme = a.actionKind === "mcp:tool" ? "mcp" : "a2a";
    lines.push(`  ${a.name}:`);
    if (a.label) lines.push(`    label: ${q(a.label)}`);
    if (a.description) lines.push(`    description: ${q(a.description)}`);
    lines.push(`    target: ${q(`${scheme}://${a.connectionName}`)}`);
    lines.push(`    kind: ${q(a.actionKind)}`);
    if (a.actionKind === "mcp:tool" && a.toolName) {
      lines.push(`    tool_name: ${q(a.toolName)}`);
    }
    if (a.inputs && a.inputs.length > 0) {
      lines.push(`    inputs:`);
      for (const inp of a.inputs) {
        const defaultValue =
          inp.type === "object" && typeof inp.default === "string"
            ? oneLineExpression(inp.default)
            : inp.default !== undefined
              ? outputValue(inp.default)
              : "";
        const def =
          inp.default !== undefined && inp.default !== ""
            ? ` = ${defaultValue}`
            : "";
        lines.push(`      ${inp.name}: ${inp.type}${def}`);
      }
    }
    lines.push("");
  }
  return lines;
}

/** Emit a single `transition to` on_exit for non-router/non-echo nodes. */
function emitOnExit(node: GraphNode, byId: Map<string, GraphNode>): string[] {
  if (!node.onExitTarget) return [];
  const target = byId.get(node.onExitTarget);
  return [
    "  on_exit: ->",
    `    transition to ${target ? nodeRef(target) : unresolvedNodeRef(node.onExitTarget, "on_exit")}`,
  ];
}

function emitTrigger(node: GraphNode, broker: Broker, byId: Map<string, GraphNode>): string[] {
  const lines: string[] = [`trigger ${node.name}:`];
  if (node.label) lines.push(`  label: ${q(node.label)}`);
  lines.push(...emitNodeDescription(node));
  lines.push(`  kind: ${q(node.interfaceName || broker.interfaceName || "a2a")}`);
  lines.push(`  target: ${q(node.triggerTarget ?? `brokers://${brokerKey(broker)}/${broker.interfaceName || "a2a"}`)}`);
  const target = node.onExitTarget ? byId.get(node.onExitTarget) : undefined;
  lines.push("  on_message: ->");
  lines.push(
    `    transition to ${
      target ? nodeRef(target) : unresolvedNodeRef(node.onExitTarget, "on_message")
    }`
  );
  lines.push("");
  return lines;
}

function emitNodeDescription(node: GraphNode): string[] {
  return node.description ? [`  description: ${q(node.description)}`] : [];
}

function emitGenerator(node: GraphNode, byId: Map<string, GraphNode>): string[] {
  const lines: string[] = [`generator ${node.name}:`];
  lines.push(...emitNodeDescription(node));
  if (node.label) lines.push(`  label: ${q(node.label)}`);
  if (node.llmBindingName) lines.push(`  llm: @llm.${node.llmBindingName}`);
  if (node.systemInstructions) {
    lines.push("  system:");
    lines.push(...emitBlockScalar("instructions", node.systemInstructions, 4));
  }
  if (node.prompt) {
    if (node.promptProcedure) {
      lines.push(...emitPromptProcedure(node.prompt, 2, node.promptProcedureInline));
    } else {
      lines.push(...emitBlockScalar("prompt", node.prompt, 2));
    }
  }
  if (node.outputs) lines.push(...emitOutputs(node.outputs, 2));
  lines.push(...emitOnExit(node, byId));
  lines.push("");
  return lines;
}

function emitAgentic(node: GraphNode, byId: Map<string, GraphNode>): string[] {
  // orchestrator / subagent share the same emission shape.
  const lines: string[] = [`${node.kind} ${node.name}:`];
  lines.push(...emitNodeDescription(node));
  if (node.label) lines.push(`  label: ${q(node.label)}`);
  if (node.llmBindingName) lines.push(`  llm: @llm.${node.llmBindingName}`);
  if (node.systemInstructions) {
    lines.push("  system:");
    lines.push(...emitBlockScalar("instructions", node.systemInstructions, 4));
  }
  lines.push("  reasoning:");
  if (node.reasoningInstructionsProcedure) {
    lines.push(
      ...emitProcedureInstruction(
        node.reasoningInstructions || "",
        4,
        node.reasoningInstructionsProcedureInline,
      ),
    );
  } else {
    lines.push(...emitBlockScalar("instructions", node.reasoningInstructions || "", 4));
  }
  if (node.actionBindings && node.actionBindings.length > 0) {
    lines.push("    actions:");
    for (const binding of node.actionBindings) {
      lines.push(`      ${binding.alias}: @actions.${binding.actionName}`);
      if (binding.withArgs) {
        for (const arg of binding.withArgs) {
          lines.push(`        with ${arg.name} = ${oneLineExpression(arg.value)}`);
        }
      }
    }
  } else if (node.actionRefs && node.actionRefs.length > 0) {
    lines.push("    actions:");
    for (const ref of node.actionRefs) {
      lines.push(`      ${ref}: @actions.${ref}`);
    }
  }
  if (node.outputs) lines.push(...emitOutputs(node.outputs, 4));
  if (node.maxNumberOfLoops !== undefined) {
    lines.push(`    max_number_of_loops: ${node.maxNumberOfLoops}`);
  }
  if (node.taskTimeoutSecs !== undefined) {
    lines.push(`    task_timeout_secs: ${node.taskTimeoutSecs}`);
  }
  if (node.maxConsecutiveErrors !== undefined) {
    lines.push(`    max_consecutive_errors: ${node.maxConsecutiveErrors}`);
  }
  lines.push(...emitOnExit(node, byId));
  lines.push("");
  return lines;
}

function emitExecutor(node: GraphNode, byId: Map<string, GraphNode>): string[] {
  const lines: string[] = [`executor ${node.name}:`];
  lines.push(...emitNodeDescription(node));
  if (node.label) lines.push(`  label: ${q(node.label)}`);
  lines.push("  do: ->");
  for (const statement of node.executorStatements ?? []) {
    if (statement.kind === "set") {
      lines.push(
        `    set @variables.${statement.variable} = ${oneLineExpression(statement.expression)}`
      );
      continue;
    }
    lines.push(`    run @actions.${statement.actionName}`);
    if (statement.withArgs) {
      for (const arg of statement.withArgs) {
        lines.push(`      with ${arg.name} = ${oneLineExpression(arg.value)}`);
      }
    }
    if (statement.captures) {
      for (const capture of statement.captures) {
        lines.push(
          `      set @variables.${capture.variable} = ${oneLineExpression(capture.expression)}`
        );
      }
    }
  }
  lines.push(...emitOnExit(node, byId));
  lines.push("");
  return lines;
}

function emitRouter(node: GraphNode, byId: Map<string, GraphNode>): string[] {
  const lines: string[] = [`router ${node.name}:`];
  lines.push(...emitNodeDescription(node));
  if (node.label) lines.push(`  label: ${q(node.label)}`);
  lines.push("  routes:");
  for (const route of node.routes ?? []) {
    const target = byId.get(route.targetNodeId);
    lines.push(
      `    - target: ${
        target ? nodeRef(target) : unresolvedNodeRef(route.targetNodeId, "route")
      }`
    );
    // `when` is an AgentScript expression, so it is emitted raw rather than
    // quoted. Fold any newlines in so a multi-line condition can't break out of
    // the mapping and truncate the route.
    lines.push(`      when: ${route.when.replace(/\s*\r?\n\s*/g, " ").trim()}`);
    if (route.label) lines.push(`      label: ${q(route.label)}`);
  }
  const otherwise = node.otherwiseTargetNodeId ? byId.get(node.otherwiseTargetNodeId) : undefined;
  lines.push("  otherwise:");
  lines.push(
    `    target: ${
      otherwise
        ? nodeRef(otherwise)
        : unresolvedNodeRef(node.otherwiseTargetNodeId, "otherwise")
    }`
  );
  lines.push("");
  return lines;
}

function emitEcho(node: GraphNode, byId: Map<string, GraphNode>): string[] {
  const lines: string[] = [`echo ${node.name}:`];
  lines.push(...emitNodeDescription(node));
  if (node.label) lines.push(`  label: ${q(node.label)}`);
  const kind = node.echoKind;
  if (kind) lines.push(`  kind: ${q(kind)}`);

  if (kind === "a2a:artifact_update_event") {
    if (node.artifactExpr) {
      lines.push(`  artifact: ${oneLineExpression(node.artifactExpr)}`);
    }
    if (node.echoAppend !== undefined) {
      lines.push(`  append: ${agentScriptBoolean(node.echoAppend)}`);
    }
    if (node.echoLastChunk !== undefined) {
      lines.push(`  lastChunk: ${agentScriptBoolean(node.echoLastChunk)}`);
    }
  } else if (kind === "a2a:status_update_event") {
    if (node.state) lines.push(`  state: ${q(node.state)}`);
    if (node.message !== undefined) {
      if (node.echoMessageMultiline) {
        lines.push(...emitStatusMessageLines(node.message, 2));
      } else {
        lines.push(`  message: ${formatMessageExpr(node.message)}`);
      }
    }
  }
  if (node.metadataExpr) {
    lines.push(`  metadata: ${oneLineExpression(node.metadataExpr)}`);
  }
  lines.push(...emitOnExit(node, byId));
  lines.push("");
  return lines;
}

function emitNode(node: GraphNode, broker: Broker, byId: Map<string, GraphNode>): string[] {
  switch (node.kind) {
    case "trigger":
      return emitTrigger(node, broker, byId);
    case "generator":
      return emitGenerator(node, byId);
    case "orchestrator":
    case "subagent":
      return emitAgentic(node, byId);
    case "executor":
      return emitExecutor(node, byId);
    case "router":
      return emitRouter(node, byId);
    case "echo":
      return emitEcho(node, byId);
    default: {
      const _exhaustive: never = node.kind;
      return _exhaustive;
    }
  }
}

/** Serialize one broker's brokers/<name>.agent file. */
export function serializeBrokerAgent(broker: Broker): string {
  const byId = new Map<string, GraphNode>(broker.nodes.map((n) => [n.id, n]));
  const lines: string[] = [
    `# @dialect: AGENTFABRIC=${broker.agentDialectVersion || AGENTSCRIPT_CONTRACT.defaultDialectVersion}`,
    "",
  ];

  lines.push("system:");
  if (broker.systemInstructionsProcedure) {
    lines.push(
      ...emitProcedureInstruction(
        broker.systemInstructions || "",
        2,
        broker.systemInstructionsProcedureInline,
      ),
    );
  } else {
    lines.push(`  instructions: ${q(broker.systemInstructions || "")}`);
  }
  lines.push("");

  lines.push("config:");
  lines.push(`  agent_name: ${q(brokerKey(broker))}`);
  if (broker.agentConfigLabel) lines.push(`  label: ${q(broker.agentConfigLabel)}`);
  if (broker.agentConfigDescription) lines.push(`  description: ${q(broker.agentConfigDescription)}`);
  if (broker.defaultLlmBindingName) {
    lines.push(`  default_llm: @llm.${broker.defaultLlmBindingName}`);
  }
  lines.push("");

  lines.push(...emitVariables(broker.agentScriptVariables ?? []));
  lines.push(...emitLlm(broker.llmBindings));
  lines.push(...emitActions(broker.actions));

  // Emit trigger(s) first, then the rest in declared order.
  const triggers = broker.nodes.filter((n) => n.kind === "trigger");
  const rest = broker.nodes.filter((n) => n.kind !== "trigger");
  for (const t of triggers) lines.push(...emitNode(t, broker, byId));
  for (const n of rest) lines.push(...emitNode(n, broker, byId));

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
