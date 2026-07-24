/**
 * Reverse of serialize/broker-agent.ts: parse a brokers/<name>.agent file back
 * into the pieces the model needs. Names (not ids) are used for transition
 * targets; the assembler in ./index.ts resolves them to node ids.
 *
 * The parser is tolerant: unknown lines are ignored, and it round-trips the
 * exact shape our serializer emits (see scripts/composer-test.mts).
 */

import type { GraphNodeKind, OutputProperty } from "@/lib/composer/model";
import { readExpressionValue } from "@/lib/composer/echo-expressions";
import { normalizeParsedInstructionText } from "@/lib/composer/instruction-text";

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
  artifactExpr?: string;
  echoAppend?: boolean;
  echoLastChunk?: boolean;
  metadataExpr?: string;
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

/** Lines nested under `lines[startIdx]` within a slice (indent > keyIndent). */
function collectDeeperFromSlice(lines: string[], startIdx: number, keyIndent: number): string[] {
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

/** Collect consecutive text lines at `baseIndent` starting at `startIdx`. */
function collectIndentedTextBlock(lines: string[], startIdx: number, baseIndent: number): string {
  const parts: string[] = [];
  for (let j = startIdx; j < lines.length; j++) {
    const l = lines[j];
    if (isBlank(l)) {
      parts.push("");
      continue;
    }
    const ind = getIndent(l);
    if (ind < baseIndent) break;
    if (ind === baseIndent && j > startIdx && /^[\w]+:/.test(l.trim())) break;
    parts.push(ind >= baseIndent ? l.slice(baseIndent) : l.trimStart());
  }
  return parts.join("\n").trimEnd();
}

/** Body of `key: ->` — nested `| …` block or indented expression/text lines. */
function readProcedureBlock(lines: string[], lineIdx: number, keyIndent: number): string | undefined {
  const deeper = collectDeeper(lines, lineIdx, keyIndent);
  if (deeper.length === 0) return undefined;

  for (let j = 0; j < deeper.length; j++) {
    const dl = deeper[j];
    if (isBlank(dl)) continue;
    const dt = dl.trim();
    const dIndent = getIndent(dl);

    if (dt.startsWith("|")) {
      const inline = dt.slice(1).trim();
      if (inline) return inline;
      const block = dedent(collectDeeperFromSlice(deeper, j, dIndent), dIndent + 2);
      return block.trimEnd() || undefined;
    }

    if (/^[\w]+:\s*(->\s*)?$/.test(dt)) continue;

    return collectIndentedTextBlock(deeper, j, dIndent) || undefined;
  }
  return undefined;
}

/** Read text for `key: value` at `lines[lineIdx]` (inline, `|`, or `->` procedure). */
function readMappingValue(lines: string[], lineIdx: number): string | undefined {
  const line = lines[lineIdx];
  const keyIndent = getIndent(line);
  const m = line.trim().match(/^([\w]+):\s*(.*)$/);
  if (!m) return undefined;
  const val = m[2].trim();

  if (val === "|") {
    const content = dedent(collectDeeper(lines, lineIdx, keyIndent), keyIndent + 2);
    return content.trimEnd() || undefined;
  }

  if (val === "->") {
    return readProcedureBlock(lines, lineIdx, keyIndent);
  }

  if (val === "") return undefined;

  return unquote(val);
}

/** Find `key:` in `lines`; return its block-scalar, procedure, or inline value. */
function readTextByKey(lines: string[], key: string): string | undefined {
  const re = new RegExp(`^(\\s*)${key}:\\s*(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].match(re)) continue;
    return readMappingValue(lines, i);
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

function parseBool(raw: string): boolean | undefined {
  const s = raw.trim().toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
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
        node.message = readExpressionValue(body, i);
        break;
      case "artifact":
        node.artifactExpr = readExpressionValue(body, i);
        break;
      case "append": {
        const b = parseBool(val);
        if (b !== undefined) node.echoAppend = b;
        break;
      }
      case "lastChunk": {
        const b = parseBool(val);
        if (b !== undefined) node.echoLastChunk = b;
        break;
      }
      case "metadata":
        node.metadataExpr = readExpressionValue(body, i);
        break;
      case "prompt": {
        const text = normalizeParsedInstructionText(readMappingValue(body, i));
        if (text !== undefined) node.prompt = text;
        break;
      }
      case "system": {
        const text = normalizeParsedInstructionText(readTextByKey(collectDeeper(body, i, 2), "instructions"));
        if (text !== undefined) node.systemInstructions = text;
        break;
      }
      case "reasoning": {
        const sub = collectDeeper(body, i, 2);
        const text = normalizeParsedInstructionText(readTextByKey(sub, "instructions"));
        if (text !== undefined) node.reasoningInstructions = text;
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

export function parseBrokerAgent(text: string): ParsedBrokerAgent {
  const groups = splitTopLevel(text);
  const result: ParsedBrokerAgent = { llmBindings: [], actions: [], nodes: [] };
  for (const g of groups) {
    if (g.header === "system:") {
      result.systemInstructions = normalizeParsedInstructionText(readTextByKey(g.body, "instructions")) ?? "";
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
