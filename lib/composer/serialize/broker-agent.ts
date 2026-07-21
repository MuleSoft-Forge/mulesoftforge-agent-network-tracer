import type {
  Broker,
  BrokerAction,
  GraphNode,
  LlmBinding,
  OutputProperty,
} from "@/lib/composer/model";
import { brokerKey, indentBlock } from "@/lib/composer/serialize/util";

const DIALECT_HEADER = "# @dialect: AGENTFABRIC=1.0";

/** Double-quoted, escaped single-line string. */
function q(s: string): string {
  return JSON.stringify(s ?? "");
}

/** Reference to a node in transition/route syntax: `@<kind>.<name>`. */
function nodeRef(node: GraphNode): string {
  return `@${node.kind}.${node.name}`;
}

/** Emit an `outputs:` block (schema notation) at the given base indent. */
function emitOutputs(outputs: OutputProperty[], indent: number): string[] {
  if (!outputs || outputs.length === 0) return [];
  const lines: string[] = [];
  const pad = " ".repeat(indent);
  lines.push(`${pad}outputs:`);
  lines.push(`${pad}  properties:`);
  for (const p of outputs) {
    lines.push(`${pad}    ${p.name}:`);
    lines.push(`${pad}      type: ${q(p.type)}`);
    if (p.description) lines.push(`${pad}      description: ${q(p.description)}`);
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

function emitLlm(bindings: LlmBinding[]): string[] {
  if (bindings.length === 0) return [];
  const lines: string[] = ["llm:"];
  for (const b of bindings) {
    lines.push(`  ${b.name}:`);
    lines.push(`    target: ${q(`llm://${b.connectionName}`)}`);
    lines.push(`    kind: ${q(b.provider)}`);
    lines.push(`    model: ${q(b.model)}`);
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
  lines.push(`  target: ${q(`brokers://${brokerKey(broker)}/${broker.interfaceName || "a2a"}`)}`);
  const target = node.onExitTarget ? byId.get(node.onExitTarget) : undefined;
  lines.push("  on_message: ->");
  lines.push(`    transition to ${target ? nodeRef(target) : "@echo.response"}`);
  lines.push("");
  return lines;
}

function emitGenerator(node: GraphNode, byId: Map<string, GraphNode>): string[] {
  const lines: string[] = [`generator ${node.name}:`];
  if (node.llmBindingName) lines.push(`  llm: @llm.${node.llmBindingName}`);
  if (node.systemInstructions) {
    lines.push("  system:");
    lines.push(...emitBlockScalar("instructions", node.systemInstructions, 4));
  }
  if (node.prompt) {
    lines.push(...emitBlockScalar("prompt", node.prompt, 2));
  }
  if (node.outputs) lines.push(...emitOutputs(node.outputs, 2));
  lines.push(...emitOnExit(node, byId));
  lines.push("");
  return lines;
}

function emitAgentic(node: GraphNode, byId: Map<string, GraphNode>): string[] {
  // orchestrator / subagent share the same emission shape.
  const lines: string[] = [`${node.kind} ${node.name}:`];
  if (node.description) lines.push(`  description: ${q(node.description)}`);
  if (node.llmBindingName) lines.push(`  llm: @llm.${node.llmBindingName}`);
  if (node.systemInstructions) {
    lines.push("  system:");
    lines.push(...emitBlockScalar("instructions", node.systemInstructions, 4));
  }
  lines.push("  reasoning:");
  lines.push(...emitBlockScalar("instructions", node.reasoningInstructions || "", 4));
  if (node.actionRefs && node.actionRefs.length > 0) {
    lines.push("    actions:");
    for (const ref of node.actionRefs) {
      lines.push(`      ${ref}: @actions.${ref}`);
    }
  }
  if (node.outputs) lines.push(...emitOutputs(node.outputs, 2));
  lines.push(...emitOnExit(node, byId));
  lines.push("");
  return lines;
}

function emitExecutor(node: GraphNode, byId: Map<string, GraphNode>): string[] {
  const lines: string[] = [`executor ${node.name}:`];
  lines.push("  do: ->");
  if (node.runActionName) {
    lines.push(`    run @actions.${node.runActionName}`);
    if (node.withArgs) {
      for (const arg of node.withArgs) {
        lines.push(`    with ${arg.name}= ${arg.value}`);
      }
    }
  }
  lines.push(...emitOnExit(node, byId));
  lines.push("");
  return lines;
}

function emitRouter(node: GraphNode, byId: Map<string, GraphNode>): string[] {
  const lines: string[] = [`router ${node.name}:`];
  lines.push("  routes:");
  for (const route of node.routes ?? []) {
    const target = byId.get(route.targetNodeId);
    lines.push(`    - target: ${target ? nodeRef(target) : "@echo.response"}`);
    lines.push(`      when: ${route.when}`);
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
  lines.push(`  kind: ${q(node.echoKind || "a2a:status_update_event")}`);
  if ((node.echoKind || "a2a:status_update_event") === "a2a:status_update_event") {
    lines.push(`  state: ${q(node.state || "TASK_STATE_COMPLETED")}`);
  }
  const msg = node.message ?? "";
  // Treat text starting with @ as an expression; otherwise a quoted literal.
  const part = msg.trimStart().startsWith("@") ? `a2a.textPart(${msg})` : `a2a.textPart(${q(msg)})`;
  lines.push(`  message: a2a.message({messageId: uuid(), parts: [${part}]})`);
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
  const lines: string[] = [DIALECT_HEADER, ""];

  lines.push("system:");
  lines.push(`  instructions: ${q(broker.systemInstructions || "")}`);
  lines.push("");

  lines.push("config:");
  lines.push(`  agent_name: ${q(brokerKey(broker))}`);
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
