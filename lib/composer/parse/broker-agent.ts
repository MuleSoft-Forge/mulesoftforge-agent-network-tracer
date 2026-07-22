/**
 * Reverse of serialize/broker-agent.ts: parse a brokers/<name>.agent file back
 * into the pieces the model needs. Names (not ids) are used for transition
 * targets; the assembler in ./index.ts resolves them to node ids.
 *
 * The parser is tolerant: unknown lines are ignored, and it round-trips the
 * exact shape our serializer emits (see scripts/composer-test.mts).
 */

import type { GraphNodeKind, OutputProperty } from "@/lib/composer/model";

export interface ParsedLlmBinding {
  name: string;
  connectionName: string;
  provider: "OpenAI" | "Gemini";
  model: string;
  params?: Record<string, string | number | boolean>;
}

export interface ParsedActionInput {
  name: string;
  type: string;
  default?: string;
}

export interface ParsedAction {
  name: string;
  actionKind: "a2a:send_message" | "mcp:tool";
  connectionName: string;
  toolName?: string;
  inputs?: ParsedActionInput[];
}

export interface ParsedRoute {
  targetName: string;
  when: string;
  label?: string;
}

export interface ParsedGraphNode {
  kind: GraphNodeKind;
  name: string;
  label?: string;
  description?: string;
  interfaceName?: string;
  llmBindingName?: string;
  systemInstructions?: string;
  prompt?: string;
  reasoningInstructions?: string;
  actionRefs?: string[];
  outputs?: OutputProperty[];
  runActionName?: string;
  withArgs?: Array<{ name: string; value: string }>;
  routes?: ParsedRoute[];
  otherwiseTargetName?: string;
  echoKind?: "a2a:status_update_event" | "a2a:artifact_update_event";
  state?: string;
  message?: string;
  onExitTargetName?: string;
}

export interface ParsedBrokerAgent {
  systemInstructions?: string;
  agentName?: string;
  defaultLlm?: string;
  llmBindings: ParsedLlmBinding[];
  actions: ParsedAction[];
  nodes: ParsedGraphNode[];
}

const NODE_KINDS: readonly GraphNodeKind[] = [
  "trigger",
  "generator",
  "orchestrator",
  "subagent",
  "executor",
  "router",
  "echo",
];

const OUTPUT_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

function getIndent(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/** Unquote a JSON double-quoted scalar; pass through bare tokens. */
function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"')) {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

/** Parse a scalar that may be a quoted string, number, or boolean. */
function parseScalar(raw: string): string | number | boolean {
  const s = raw.trim();
  if (s.startsWith('"')) return unquote(s);
  if (s === "true") return true;
  if (s === "false") return false;
  if (s !== "" && !Number.isNaN(Number(s))) return Number(s);
  return s;
}

/** Lines strictly nested under the line at `startIdx` (indent > keyIndent). */
function collectDeeper(lines: string[], startIdx: number, keyIndent: number): string[] {
  const out: string[] = [];
  for (let j = startIdx + 1; j < lines.length; j++) {
    const l = lines[j];
    if (isBlank(l)) {
      out.push(l);
      continue;
    }
    if (getIndent(l) <= keyIndent) break;
    out.push(l);
  }
  while (out.length > 0 && isBlank(out[out.length - 1])) out.pop();
  return out;
}

function dedent(lines: string[], n: number): string {
  return lines.map((l) => (l.length >= n ? l.slice(n) : l.replace(/^\s+/, ""))).join("\n");
}

/** Find `key:` in `lines`; return its block-scalar or inline value. */
function readTextByKey(lines: string[], key: string): string | undefined {
  const re = new RegExp(`^(\\s*)${key}:\\s*(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    const ind = m[1].length;
    const val = m[2];
    if (val === "|") return dedent(collectDeeper(lines, i, ind), ind + 2);
    return unquote(val);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Top-level splitting
// ---------------------------------------------------------------------------

interface Group {
  header: string;
  body: string[];
}

function splitTopLevel(text: string): Group[] {
  const lines = text.split("\n");
  const groups: Group[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line) || line.trimStart().startsWith("#") || getIndent(line) !== 0) {
      i += 1;
      continue;
    }
    const header = line.trim();
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const lj = lines[j];
      if (!isBlank(lj) && !lj.trimStart().startsWith("#") && getIndent(lj) === 0) break;
      body.push(lj);
      j += 1;
    }
    groups.push({ header, body });
    i = j;
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Section parsers
// ---------------------------------------------------------------------------

function parseConfig(body: string[]): { agentName?: string; defaultLlm?: string } {
  const out: { agentName?: string; defaultLlm?: string } = {};
  for (const line of body) {
    const an = line.match(/^\s*agent_name:\s*(.*)$/);
    if (an) out.agentName = unquote(an[1]);
    const dl = line.match(/^\s*default_llm:\s*@llm\.([\w.-]+)/);
    if (dl) out.defaultLlm = dl[1];
  }
  return out;
}

function parseLlm(body: string[]): ParsedLlmBinding[] {
  const bindings: ParsedLlmBinding[] = [];
  let current: ParsedLlmBinding | null = null;
  for (const line of body) {
    if (isBlank(line)) continue;
    const ind = getIndent(line);
    const t = line.trim();
    if (ind === 2) {
      const name = t.match(/^([\w-]+):$/);
      if (name) {
        current = { name: name[1], connectionName: "", provider: "OpenAI", model: "" };
        bindings.push(current);
      }
      continue;
    }
    if (!current || ind < 4) continue;
    const kv = t.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (key === "target") {
      const m = val.match(/llm:\/\/([\w.-]+)/);
      if (m) current.connectionName = m[1];
    } else if (key === "kind") {
      const p = unquote(val);
      current.provider = p === "Gemini" ? "Gemini" : "OpenAI";
    } else if (key === "model") {
      current.model = unquote(val);
    } else {
      current.params = current.params ?? {};
      current.params[key] = parseScalar(val);
    }
  }
  return bindings;
}

function parseActions(body: string[]): ParsedAction[] {
  const actions: ParsedAction[] = [];
  let current: ParsedAction | null = null;
  let inInputs = false;
  for (const line of body) {
    if (isBlank(line)) continue;
    const ind = getIndent(line);
    const t = line.trim();
    if (ind === 2) {
      const name = t.match(/^([\w-]+):$/);
      if (name) {
        current = { name: name[1], actionKind: "a2a:send_message", connectionName: "" };
        actions.push(current);
        inInputs = false;
      }
      continue;
    }
    if (!current) continue;
    if (ind === 4) {
      inInputs = false;
      const kv = t.match(/^([\w-]+):\s*(.*)$/);
      if (!kv) continue;
      const [, key, val] = kv;
      if (key === "target") {
        const m = val.match(/(a2a|mcp):\/\/([\w.-]+)/);
        if (m) current.connectionName = m[2];
      } else if (key === "kind") {
        const k = unquote(val);
        current.actionKind = k === "mcp:tool" ? "mcp:tool" : "a2a:send_message";
      } else if (key === "tool_name") {
        current.toolName = unquote(val);
      } else if (key === "inputs") {
        inInputs = true;
      }
      continue;
    }
    if (ind >= 6 && inInputs) {
      // `name: type` or `name: type = "default"`
      const m = t.match(/^([\w-]+):\s*([^\s=]+)(?:\s*=\s*(.*))?$/);
      if (m) {
        current.inputs = current.inputs ?? [];
        current.inputs.push({
          name: m[1],
          type: m[2],
          ...(m[3] !== undefined ? { default: unquote(m[3]) } : {}),
        });
      }
    }
  }
  return actions;
}

function parseOutputs(body: string[]): OutputProperty[] | undefined {
  const propsIdx = body.findIndex((l) => /^\s*properties:\s*$/.test(l));
  if (propsIdx < 0) return undefined;
  const propsIndent = getIndent(body[propsIdx]);
  const props: OutputProperty[] = [];
  let current: OutputProperty | null = null;
  for (let i = propsIdx + 1; i < body.length; i++) {
    const line = body[i];
    if (isBlank(line)) continue;
    const ind = getIndent(line);
    if (ind <= propsIndent) break;
    const t = line.trim();
    if (ind === propsIndent + 2) {
      const name = t.match(/^([\w-]+):$/);
      if (name) {
        current = { name: name[1], type: "string" };
        props.push(current);
      }
    } else if (current && ind >= propsIndent + 4) {
      const type = t.match(/^type:\s*(.*)$/);
      if (type) {
        const parsed = unquote(type[1]);
        if (OUTPUT_TYPES.has(parsed)) current.type = parsed as OutputProperty["type"];
      }
      const desc = t.match(/^description:\s*(.*)$/);
      if (desc) current.description = unquote(desc[1]);
    }
  }
  return props.length > 0 ? props : undefined;
}

/** First `transition to @<kind>.<name>` nested under `body[i]`. */
function readTransition(body: string[], i: number): string | undefined {
  const sub = collectDeeper(body, i, getIndent(body[i]));
  for (const l of sub) {
    const m = l.match(/transition to @[\w-]+\.([\w.-]+)/);
    if (m) return m[1];
  }
  return undefined;
}

function parseNode(kind: GraphNodeKind, name: string, body: string[]): ParsedGraphNode {
  const node: ParsedGraphNode = { kind, name };
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    if (isBlank(line) || getIndent(line) !== 2) continue;
    const kv = line.trim().match(/^([\w]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    switch (key) {
      case "label":
        node.label = unquote(val);
        break;
      case "description":
        node.description = unquote(val);
        break;
      case "llm": {
        const m = val.match(/@llm\.([\w.-]+)/);
        if (m) node.llmBindingName = m[1];
        break;
      }
      case "kind": {
        const k = unquote(val);
        if (kind === "trigger") node.interfaceName = k;
        else if (kind === "echo")
          node.echoKind = k === "a2a:artifact_update_event" ? "a2a:artifact_update_event" : "a2a:status_update_event";
        break;
      }
      case "state":
        node.state = unquote(val);
        break;
      case "message":
        node.message = parseEchoMessage(val);
        break;
      case "prompt":
        node.prompt = val === "|" ? dedent(collectDeeper(body, i, 2), 4) : unquote(val);
        break;
      case "system":
        node.systemInstructions = readTextByKey(collectDeeper(body, i, 2), "instructions");
        break;
      case "reasoning": {
        const sub = collectDeeper(body, i, 2);
        node.reasoningInstructions = readTextByKey(sub, "instructions");
        const refs = readActionRefs(sub);
        if (refs.length > 0) node.actionRefs = refs;
        break;
      }
      case "outputs":
        node.outputs = parseOutputs(collectDeeper(body, i, 2));
        break;
      case "on_message":
      case "on_exit": {
        const target = readTransition(body, i);
        if (target) node.onExitTargetName = target;
        break;
      }
      case "do": {
        const sub = collectDeeper(body, i, 2);
        for (const l of sub) {
          const run = l.match(/run @actions\.([\w.-]+)/);
          if (run) node.runActionName = run[1];
          const w = l.match(/^\s*with\s+([\w-]+)=\s*(.*)$/);
          if (w) {
            node.withArgs = node.withArgs ?? [];
            node.withArgs.push({ name: w[1], value: w[2].trim() });
          }
        }
        break;
      }
      case "routes":
        node.routes = parseRoutes(collectDeeper(body, i, 2));
        break;
      case "otherwise": {
        const sub = collectDeeper(body, i, 2);
        for (const l of sub) {
          const m = l.match(/target:\s*@[\w-]+\.([\w.-]+)/);
          if (m) node.otherwiseTargetName = m[1];
        }
        break;
      }
      default:
        break;
    }
  }
  return node;
}

function readActionRefs(sub: string[]): string[] {
  const refs: string[] = [];
  for (const l of sub) {
    const m = l.match(/@actions\.([\w.-]+)/);
    if (m) refs.push(m[1]);
  }
  return refs;
}

function parseRoutes(sub: string[]): ParsedRoute[] {
  const routes: ParsedRoute[] = [];
  let current: ParsedRoute | null = null;
  for (const l of sub) {
    if (isBlank(l)) continue;
    const t = l.trim();
    const target = t.match(/^-\s*target:\s*@[\w-]+\.([\w.-]+)/);
    if (target) {
      current = { targetName: target[1], when: "true" };
      routes.push(current);
      continue;
    }
    if (!current) continue;
    const when = t.match(/^when:\s*(.*)$/);
    if (when) current.when = when[1].trim();
    const label = t.match(/^label:\s*(.*)$/);
    if (label) current.label = unquote(label[1]);
  }
  return routes;
}

/** Extract the textPart argument from `a2a.message({... a2a.textPart(<arg>)...})`. */
function parseEchoMessage(val: string): string {
  const m = val.match(/a2a\.textPart\((.*)\)\s*\]/);
  const arg = (m ? m[1] : "").trim();
  if (arg.startsWith('"')) return unquote(arg);
  return arg;
}

export function parseBrokerAgent(text: string): ParsedBrokerAgent {
  const groups = splitTopLevel(text);
  const result: ParsedBrokerAgent = { llmBindings: [], actions: [], nodes: [] };
  for (const g of groups) {
    if (g.header === "system:") {
      result.systemInstructions = readTextByKey(g.body, "instructions") ?? "";
      continue;
    }
    if (g.header === "config:") {
      const cfg = parseConfig(g.body);
      result.agentName = cfg.agentName;
      result.defaultLlm = cfg.defaultLlm;
      continue;
    }
    if (g.header === "llm:") {
      result.llmBindings = parseLlm(g.body);
      continue;
    }
    if (g.header === "actions:") {
      result.actions = parseActions(g.body);
      continue;
    }
    const node = g.header.match(/^([\w]+)\s+([\w.-]+):$/);
    if (node && (NODE_KINDS as string[]).includes(node[1])) {
      result.nodes.push(parseNode(node[1] as GraphNodeKind, node[2], g.body));
    }
  }
  return result;
}
