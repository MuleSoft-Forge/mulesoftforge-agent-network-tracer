import type {
  Broker,
  BrokerAction,
  GraphNode,
  LlmBinding,
  OutputProperty,
} from "@/lib/composer/model";
import { defaultArtifactExpr, emitStatusMessageLines, emitTaskLines, formatMessageExpr } from "@/lib/composer/echo-expressions";
import { llmTuningYamlEntries } from "@/lib/composer/llm-binding-params";
import { resolvedNodeDescription, nodeKindRequiresDescription } from "@/lib/composer/node-description";
import { brokerKey, indentBlock } from "@/lib/composer/serialize/util";

const DEFAULT_DIALECT_VERSION = "1.0";

/** Double-quoted, escaped single-line string. */
function q(s: string): string {
  return JSON.stringify(s ?? "");
}

/** Reference to a node in transition/route syntax: `@<kind>.<name>`. */
function nodeRef(node: GraphNode): string {
  return `@${node.kind}.${node.name}`;
}

/** Emit one output property (and optional nested properties) at the given indent. */
function emitOutputProperty(p: OutputProperty, indent: number): string[] {
  const lines: string[] = [];
  const pad = " ".repeat(indent);
  lines.push(`${pad}${p.name}:`);
  lines.push(`${pad}  type: ${q(p.type)}`);
  if (p.description) lines.push(`${pad}  description: ${q(p.description)}`);
  if (p.default !== undefined) lines.push(`${pad}  default: ${q(p.default)}`);
  if (p.pattern) lines.push(`${pad}  pattern: ${q(p.pattern)}`);
  if (p.minLength !== undefined) lines.push(`${pad}  minLength: ${p.minLength}`);
  if (p.maxLength !== undefined) lines.push(`${pad}  maxLength: ${p.maxLength}`);
  if (p.minimum !== undefined) lines.push(`${pad}  minimum: ${p.minimum}`);
  if (p.maximum !== undefined) lines.push(`${pad}  maximum: ${p.maximum}`);
  if (p.exclusiveMinimum !== undefined) lines.push(`${pad}  exclusiveMinimum: ${p.exclusiveMinimum}`);
  if (p.exclusiveMaximum !== undefined) lines.push(`${pad}  exclusiveMaximum: ${p.exclusiveMaximum}`);
  if (p.minItems !== undefined) lines.push(`${pad}  minItems: ${p.minItems}`);
  if (p.maxItems !== undefined) lines.push(`${pad}  maxItems: ${p.maxItems}`);
  if (p.required && p.required.length > 0) {
    lines.push(`${pad}  required:`);
    for (const req of p.required) {
      lines.push(`${pad}    - ${q(req)}`);
    }
  }
  if (p.enum && p.enum.length > 0) {
    lines.push(`${pad}  enum:`);
    for (const e of p.enum) {
      lines.push(`${pad}    - ${q(e)}`);
    }
  }
  if (p.type === "object" && p.properties && p.properties.length > 0) {
    lines.push(`${pad}  properties:`);
    for (const child of p.properties) {
      lines.push(...emitOutputProperty(child, indent + 4));
    }
  }
  if (p.type === "array" && p.itemsType) {
    lines.push(`${pad}  items:`);
    lines.push(`${pad}    type: ${q(p.itemsType)}`);
    if (p.itemsType === "object" && p.itemsProperties && p.itemsProperties.length > 0) {
      lines.push(`${pad}    properties:`);
      for (const child of p.itemsProperties) {
        lines.push(...emitOutputProperty(child, indent + 6));
      }
    }
  }
  return lines;
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

function emitProcedureInstruction(content: string, indent: number): string[] {
  const pad = " ".repeat(indent);
  const lines = [`${pad}instructions: ->`];
  if (content.includes("\n")) {
    lines.push(`${pad}  |`);
    lines.push(indentBlock(content, indent + 4));
  } else {
    lines.push(`${pad}  | ${content}`);
  }
  return lines;
}

function emitPromptProcedure(content: string, indent: number): string[] {
  const pad = " ".repeat(indent);
  const lines = [`${pad}prompt: ->`];
  if (content.includes("\n")) {
    lines.push(`${pad}  |`);
    lines.push(indentBlock(content, indent + 4));
  } else {
    lines.push(`${pad}  | ${content}`);
  }
  return lines;
}

function emitLlm(bindings: LlmBinding[]): string[] {
  if (bindings.length === 0) return [];
  const lines: string[] = ["llm:"];
  for (const b of bindings) {
    lines.push(`  ${b.name}:`);
    lines.push(`    target: ${q(`llm://${b.connectionName}`)}`);
    lines.push(`    kind: ${q(b.provider)}`);
    lines.push(`    model: ${q(b.model)}`);
    for (const [key, value] of llmTuningYamlEntries(b)) {
      lines.push(`    ${key}: ${typeof value === "string" ? q(value) : String(value)}`);
    }
    if (b.params) {
      for (const [k, v] of Object.entries(b.params)) {
        lines.push(`    ${k}: ${typeof v === "string" ? q(v) : String(v)}`);
      }
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
    lines.push(`    target: ${q(`${scheme}://${a.connectionName}`)}`);
    lines.push(`    kind: ${q(a.actionKind)}`);
    if (a.actionKind === "mcp:tool" && a.toolName) {
      lines.push(`    tool_name: ${q(a.toolName)}`);
    }
    if (a.inputs && a.inputs.length > 0) {
      lines.push(`    inputs:`);
      for (const inp of a.inputs) {
        const def = inp.default !== undefined && inp.default !== "" ? ` = ${q(inp.default)}` : "";
        lines.push(`      ${inp.name}: ${inp.type}${def}`);
      }
    }
    if (a.httpHeaders && a.httpHeaders.length > 0) {
      lines.push(`    http_headers:`);
      for (const h of a.httpHeaders) {
        lines.push(`      ${h.name}: ${q(h.value)}`);
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
  if (!target) return [];
  return ["  on_exit: ->", `    transition to ${nodeRef(target)}`];
}

function emitTrigger(node: GraphNode, broker: Broker, byId: Map<string, GraphNode>): string[] {
  const lines: string[] = [`trigger ${node.name}:`];
  lines.push(`  kind: ${q(node.interfaceName || broker.interfaceName || "a2a")}`);
  lines.push(`  target: ${q(node.triggerTarget ?? `brokers://${brokerKey(broker)}/${broker.interfaceName || "a2a"}`)}`);
  const target = node.onExitTarget ? byId.get(node.onExitTarget) : undefined;
  lines.push("  on_message: ->");
  lines.push(`    transition to ${target ? nodeRef(target) : "@echo.response"}`);
  lines.push("");
  return lines;
}

/** Emit `description:` when required by the AgentFabric dialect. */
function emitNodeDescription(node: GraphNode): string[] {
  if (!nodeKindRequiresDescription(node.kind)) return [];
  return [`  description: ${q(resolvedNodeDescription(node))}`];
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
      lines.push(...emitPromptProcedure(node.prompt, 2));
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
    lines.push(...emitProcedureInstruction(node.reasoningInstructions || "", 4));
  } else {
    lines.push(...emitBlockScalar("instructions", node.reasoningInstructions || "", 4));
  }
  if (node.actionBindings && node.actionBindings.length > 0) {
    lines.push("    actions:");
    for (const binding of node.actionBindings) {
      lines.push(`      ${binding.alias}: @actions.${binding.actionName}`);
      if (binding.withArgs) {
        for (const arg of binding.withArgs) {
          lines.push(`        with ${arg.name} = ${arg.value}`);
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
  lines.push("  do: ->");
  for (const statement of node.executorStatements ?? []) {
    if (statement.kind === "set") {
      lines.push(`    set @variables.${statement.variable} = ${statement.expression}`);
      continue;
    }
    lines.push(`    run @actions.${statement.actionName}`);
    if (statement.withArgs) {
      for (const arg of statement.withArgs) {
        lines.push(`      with ${arg.name} = ${arg.value}`);
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
  lines.push("  routes:");
  for (const route of node.routes ?? []) {
    const target = byId.get(route.targetNodeId);
    lines.push(`    - target: ${target ? nodeRef(target) : "@echo.response"}`);
    // `when` is an AgentScript expression, so it is emitted raw rather than
    // quoted. Fold any newlines in so a multi-line condition can't break out of
    // the mapping and truncate the route.
    lines.push(`      when: ${route.when.replace(/\s*\r?\n\s*/g, " ").trim()}`);
    if (route.label) lines.push(`      label: ${q(route.label)}`);
  }
  const otherwise = node.otherwiseTargetNodeId ? byId.get(node.otherwiseTargetNodeId) : undefined;
  lines.push("  otherwise:");
  lines.push(`    target: ${otherwise ? nodeRef(otherwise) : "@echo.response"}`);
  lines.push("");
  return lines;
}

function emitEcho(node: GraphNode): string[] {
  const lines: string[] = [`echo ${node.name}:`];
  lines.push(...emitNodeDescription(node));
  const kind = node.echoKind || "a2a:status_update_event";
  lines.push(`  kind: ${q(kind)}`);

  if (kind === "a2a:response") {
    const task = node.taskExpr ?? "";
    if (node.echoTaskMultiline && task.startsWith("a2a.task(")) {
      lines.push(...emitTaskLines(task, 2));
    } else {
      lines.push(`  task: ${task || 'a2a.task({state: "completed", message: a2a.message({messageId: uuid(), parts: [a2a.textPart("")]}), metadata: None})'}`);
    }
  } else if (kind === "a2a:artifact_update_event") {
    lines.push(`  artifact: ${node.artifactExpr ?? defaultArtifactExpr()}`);
    if (node.echoAppend !== undefined) lines.push(`  append: ${node.echoAppend}`);
    if (node.echoLastChunk !== undefined) lines.push(`  lastChunk: ${node.echoLastChunk}`);
  } else {
    lines.push(`  state: ${q(node.state || "TASK_STATE_COMPLETED")}`);
    if (node.echoMessageMultiline) {
      lines.push(...emitStatusMessageLines(node.message ?? "", 2));
    } else {
      lines.push(`  message: ${formatMessageExpr(node.message ?? "")}`);
    }
    if (node.metadataExpr) lines.push(`  metadata: ${node.metadataExpr}`);
  }
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
      return emitEcho(node);
    default: {
      const _exhaustive: never = node.kind;
      return _exhaustive;
    }
  }
}

/** Serialize one broker's brokers/<name>.agent file. */
export function serializeBrokerAgent(broker: Broker): string {
  const byId = new Map<string, GraphNode>(broker.nodes.map((n) => [n.id, n]));
  const dialectVersion = broker.agentDialectVersion ?? DEFAULT_DIALECT_VERSION;
  const lines: string[] = [`# @dialect: AGENTFABRIC=${dialectVersion}`, ""];

  lines.push("system:");
  if (broker.systemInstructionsProcedure) {
    lines.push(...emitProcedureInstruction(broker.systemInstructions || "", 2));
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

  lines.push(...emitLlm(broker.llmBindings));
  lines.push(...emitActions(broker.actions));

  // Emit trigger(s) first, then the rest in declared order.
  const triggers = broker.nodes.filter((n) => n.kind === "trigger");
  const rest = broker.nodes.filter((n) => n.kind !== "trigger");
  for (const t of triggers) lines.push(...emitNode(t, broker, byId));
  for (const n of rest) lines.push(...emitNode(n, broker, byId));

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
