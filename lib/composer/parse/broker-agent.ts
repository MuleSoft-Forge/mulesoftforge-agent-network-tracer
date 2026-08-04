/**
 * Reverse of serialize/broker-agent.ts: parse a brokers/<name>.agent file back
 * into the pieces the model needs. Names (not ids) are used for transition
 * targets; the assembler in ./index.ts resolves them to node ids.
 *
 * The parser is tolerant: unknown lines are ignored, and it round-trips the
 * exact shape our serializer emits (see scripts/composer-test.mts).
 */

import type { ExecutorStatement, GraphNodeKind, OrchestratorActionBinding, OutputProperty } from "@/lib/composer/model";
import { applyLlmYamlParam } from "@/lib/composer/llm-binding-params";
import { readExpressionValue } from "@/lib/composer/echo-expressions";
import { normalizeParsedInstructionText } from "@/lib/composer/instruction-text";

export interface ParsedLlmBinding {
  name: string;
  connectionName: string;
  provider: "OpenAI" | "Gemini";
  model: string;
  reasoningEffort?: "NONE" | "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
  temperature?: number;
  topP?: number;
  topLogprobs?: number;
  maxOutputTokens?: number;
  thinkingLevel?: "LOW" | "HIGH";
  thinkingBudget?: number;
  responseLogprobs?: boolean;
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
  httpHeaders?: Array<{ name: string; value: string }>;
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
  triggerTarget?: string;
  llmBindingName?: string;
  systemInstructions?: string;
  prompt?: string;
  reasoningInstructions?: string;
  reasoningInstructionsProcedure?: boolean;
  actionRefs?: string[];
  actionBindings?: OrchestratorActionBinding[];
  promptProcedure?: boolean;
  outputs?: OutputProperty[];
  executorStatements?: ExecutorStatement[];
  routes?: ParsedRoute[];
  otherwiseTargetName?: string;
  echoKind?: "a2a:status_update_event" | "a2a:artifact_update_event" | "a2a:response";
  state?: string;
  message?: string;
  taskExpr?: string;
  echoMessageMultiline?: boolean;
  echoTaskMultiline?: boolean;
  artifactExpr?: string;
  echoAppend?: boolean;
  echoLastChunk?: boolean;
  metadataExpr?: string;
  onExitTargetName?: string;
  maxNumberOfLoops?: number;
  taskTimeoutSecs?: number;
  maxConsecutiveErrors?: number;
}

export interface ParsedBrokerAgent {
  systemInstructions?: string;
  systemInstructionsProcedure?: boolean;
  agentDialectVersion?: string;
  agentName?: string;
  agentConfigLabel?: string;
  agentConfigDescription?: string;
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

function parseConfig(body: string[]): {
  agentName?: string;
  agentConfigLabel?: string;
  agentConfigDescription?: string;
  defaultLlm?: string;
} {
  const out: {
    agentName?: string;
    agentConfigLabel?: string;
    agentConfigDescription?: string;
    defaultLlm?: string;
  } = {};
  for (const line of body) {
    const an = line.match(/^\s*agent_name:\s*(.*)$/);
    if (an) out.agentName = unquote(an[1]);
    const label = line.match(/^\s*label:\s*(.*)$/);
    if (label) out.agentConfigLabel = unquote(label[1]);
    const desc = line.match(/^\s*description:\s*(.*)$/);
    if (desc) out.agentConfigDescription = unquote(desc[1]);
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
      applyLlmYamlParam(current, key, parseScalar(val));
    }
  }
  return bindings;
}

function parseActions(body: string[]): ParsedAction[] {
  const actions: ParsedAction[] = [];
  let current: ParsedAction | null = null;
  let block: "inputs" | "http_headers" | null = null;
  for (const line of body) {
    if (isBlank(line)) continue;
    const ind = getIndent(line);
    const t = line.trim();
    if (ind === 2) {
      const name = t.match(/^([\w-]+):$/);
      if (name) {
        current = { name: name[1], actionKind: "a2a:send_message", connectionName: "" };
        actions.push(current);
        block = null;
      }
      continue;
    }
    if (!current) continue;
    if (ind === 4) {
      block = null;
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
        block = "inputs";
      } else if (key === "http_headers") {
        block = "http_headers";
      }
      continue;
    }
    if (ind >= 6 && block === "inputs") {
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
      continue;
    }
    if (ind >= 6 && block === "http_headers") {
      // `Header-Name: "value"` — header names allow more punctuation than ids.
      const m = t.match(/^([\w.-]+):\s*(.+)$/);
      if (m) {
        current.httpHeaders = current.httpHeaders ?? [];
        current.httpHeaders.push({ name: m[1], value: unquote(m[2]) });
      }
    }
  }
  return actions;
}

function parseOutputProperties(body: string[], startIdx: number, listIndent: number): { props: OutputProperty[]; endIdx: number } {
  const props: OutputProperty[] = [];
  let i = startIdx;
  while (i < body.length) {
    const line = body[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const ind = getIndent(line);
    if (ind <= listIndent) break;
    if (ind !== listIndent + 2) {
      i++;
      continue;
    }
    const nameMatch = line.trim().match(/^([\w-]+):$/);
    if (!nameMatch) {
      i++;
      continue;
    }
    const prop: OutputProperty = { name: nameMatch[1], type: "string" };
    i++;
    const fieldIndent = listIndent + 4;
    while (i < body.length) {
      const fieldLine = body[i];
      if (isBlank(fieldLine)) {
        i++;
        continue;
      }
      const fieldInd = getIndent(fieldLine);
      if (fieldInd <= listIndent + 2) break;
      const fieldText = fieldLine.trim();

      if (fieldInd === fieldIndent) {
        const typeMatch = fieldText.match(/^type:\s*(.*)$/);
        if (typeMatch) {
          const parsed = unquote(typeMatch[1]);
          if (OUTPUT_TYPES.has(parsed)) prop.type = parsed as OutputProperty["type"];
          i++;
          continue;
        }
        const descMatch = fieldText.match(/^description:\s*(.*)$/);
        if (descMatch) {
          prop.description = unquote(descMatch[1]);
          i++;
          continue;
        }
        const defaultMatch = fieldText.match(/^default:\s*(.*)$/);
        if (defaultMatch) {
          prop.default = unquote(defaultMatch[1]);
          i++;
          continue;
        }
        const patternMatch = fieldText.match(/^pattern:\s*(.*)$/);
        if (patternMatch) {
          prop.pattern = unquote(patternMatch[1]);
          i++;
          continue;
        }
        const minLengthMatch = fieldText.match(/^minLength:\s*(.*)$/);
        if (minLengthMatch) {
          prop.minLength = parseOutputInteger(minLengthMatch[1]);
          i++;
          continue;
        }
        const maxLengthMatch = fieldText.match(/^maxLength:\s*(.*)$/);
        if (maxLengthMatch) {
          prop.maxLength = parseOutputInteger(maxLengthMatch[1]);
          i++;
          continue;
        }
        const minimumMatch = fieldText.match(/^minimum:\s*(.*)$/);
        if (minimumMatch) {
          prop.minimum = parseOutputNumber(minimumMatch[1]);
          i++;
          continue;
        }
        const maximumMatch = fieldText.match(/^maximum:\s*(.*)$/);
        if (maximumMatch) {
          prop.maximum = parseOutputNumber(maximumMatch[1]);
          i++;
          continue;
        }
        const exclusiveMinimumMatch = fieldText.match(/^exclusiveMinimum:\s*(.*)$/);
        if (exclusiveMinimumMatch) {
          prop.exclusiveMinimum = parseOutputNumber(exclusiveMinimumMatch[1]);
          i++;
          continue;
        }
        const exclusiveMaximumMatch = fieldText.match(/^exclusiveMaximum:\s*(.*)$/);
        if (exclusiveMaximumMatch) {
          prop.exclusiveMaximum = parseOutputNumber(exclusiveMaximumMatch[1]);
          i++;
          continue;
        }
        const minItemsMatch = fieldText.match(/^minItems:\s*(.*)$/);
        if (minItemsMatch) {
          prop.minItems = parseOutputInteger(minItemsMatch[1]);
          i++;
          continue;
        }
        const maxItemsMatch = fieldText.match(/^maxItems:\s*(.*)$/);
        if (maxItemsMatch) {
          prop.maxItems = parseOutputInteger(maxItemsMatch[1]);
          i++;
          continue;
        }
        if (fieldText === "required:") {
          prop.required = [];
          i++;
          while (i < body.length) {
            const reqLine = body[i];
            if (isBlank(reqLine)) {
              i++;
              continue;
            }
            if (getIndent(reqLine) <= fieldIndent) break;
            const reqItem = reqLine.trim().match(/^-\s*(.*)$/);
            if (reqItem) prop.required!.push(unquote(reqItem[1]));
            i++;
          }
          continue;
        }
        if (fieldText === "enum:") {
          prop.enum = [];
          i++;
          while (i < body.length) {
            const enumLine = body[i];
            if (isBlank(enumLine)) {
              i++;
              continue;
            }
            if (getIndent(enumLine) <= fieldIndent) break;
            const enumItem = enumLine.trim().match(/^-\s*(.*)$/);
            if (enumItem) prop.enum.push(unquote(enumItem[1]));
            i++;
          }
          continue;
        }
        if (fieldText === "properties:") {
          const nested = parseOutputProperties(body, i + 1, fieldInd);
          prop.properties = nested.props;
          i = nested.endIdx;
          continue;
        }
        if (fieldText === "items:") {
          i++;
          const itemsIndent = fieldIndent + 2;
          while (i < body.length) {
            const itemLine = body[i];
            if (isBlank(itemLine)) {
              i++;
              continue;
            }
            const itemInd = getIndent(itemLine);
            if (itemInd <= fieldIndent) break;
            const itemText = itemLine.trim();
            if (itemInd === itemsIndent) {
              const itemTypeMatch = itemText.match(/^type:\s*(.*)$/);
              if (itemTypeMatch) {
                const parsed = unquote(itemTypeMatch[1]);
                if (OUTPUT_TYPES.has(parsed)) prop.itemsType = parsed as OutputProperty["itemsType"];
                i++;
                continue;
              }
              if (itemText === "properties:") {
                const nested = parseOutputProperties(body, i + 1, itemInd);
                prop.itemsProperties = nested.props;
                i = nested.endIdx;
                continue;
              }
            }
            i++;
          }
          continue;
        }
      }
      i++;
    }
    props.push(prop);
  }
  return { props, endIdx: i };
}

function parseOutputs(body: string[]): OutputProperty[] | undefined {
  const propsIdx = body.findIndex((l) => /^\s*properties:\s*$/.test(l));
  if (propsIdx < 0) return undefined;
  const propsIndent = getIndent(body[propsIdx]);
  const { props } = parseOutputProperties(body, propsIdx + 1, propsIndent);
  return props.length > 0 ? props : undefined;
}

function parseWithArgLine(line: string): { name: string; value: string } | null {
  const w = line.match(/^\s*with\s+([\w-]+)\s*=\s*(.*)$/);
  if (!w) return null;
  return { name: w[1], value: w[2].trim() };
}

function parseOutputNumber(raw: string): number | undefined {
  const parsed = Number(unquote(raw));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOutputInteger(raw: string): number | undefined {
  const parsed = parseOutputNumber(raw);
  if (parsed === undefined) return undefined;
  return Number.isInteger(parsed) ? parsed : Math.trunc(parsed);
}

function parseExecutorDoStatements(sub: string[]): ExecutorStatement[] {
  const statements: ExecutorStatement[] = [];
  let pendingWith: Array<{ name: string; value: string }> = [];
  let currentRun: { actionName: string } | null = null;

  function flushRun() {
    if (!currentRun) return;
    statements.push({
      kind: "run",
      actionName: currentRun.actionName,
      ...(pendingWith.length > 0 ? { withArgs: pendingWith } : {}),
    });
    currentRun = null;
    pendingWith = [];
  }

  for (const raw of sub) {
    const withArg = parseWithArgLine(raw);
    if (withArg && currentRun) {
      pendingWith.push(withArg);
      continue;
    }

    let line = raw.trim();
    if (line.startsWith("->")) line = line.slice(2).trim();
    if (!line) continue;

    const setPattern = /set\s+@variables\.([\w.-]+)\s*=\s*/g;
    let cursor = 0;
    let setMatch: RegExpExecArray | null;
    while ((setMatch = setPattern.exec(line)) !== null) {
      flushRun();
      const varName = setMatch[1];
      const exprStart = setMatch.index + setMatch[0].length;
      const runIdx = line.indexOf(" run @actions.", exprStart);
      const exprEnd = runIdx >= 0 ? runIdx : line.length;
      const expression = line.slice(exprStart, exprEnd).trim();
      if (expression) {
        statements.push({ kind: "set", variable: varName, expression });
      }
      cursor = runIdx >= 0 ? runIdx : line.length;
      if (runIdx >= 0) break;
    }

    const remainder = cursor > 0 ? line.slice(cursor) : line;
    const runMatch = remainder.match(/run\s+@actions\.([\w.-]+)/);
    if (runMatch) {
      flushRun();
      currentRun = { actionName: runMatch[1] };
      const afterRun = remainder.slice(runMatch.index! + runMatch[0].length);
      const inlineWith = afterRun.match(/^\s*with\s+([\w-]+)\s*=\s*(.*)$/);
      if (inlineWith) {
        pendingWith.push({ name: inlineWith[1], value: inlineWith[2].trim() });
      }
    }
  }

  flushRun();
  return statements;
}

function readRootSystemInstructions(body: string[]): { text?: string; procedure?: boolean } {
  for (let i = 0; i < body.length; i++) {
    const m = body[i].match(/^(\s*)instructions:\s*(.*)$/);
    if (!m) continue;
    const val = m[2].trim();
    if (val === "->") {
      return {
        text: normalizeParsedInstructionText(readProcedureBlock(body, i, getIndent(body[i]))),
        procedure: true,
      };
    }
    if (val === "|") {
      const content = dedent(collectDeeper(body, i, getIndent(body[i])), getIndent(body[i]) + 2);
      return {
        text: normalizeParsedInstructionText(content.trimEnd() || undefined),
        procedure: true,
      };
    }
    return {
      text: normalizeParsedInstructionText(readMappingValue(body, i)),
      procedure: false,
    };
  }
  return {};
}

function parseActionBindings(sub: string[]): OrchestratorActionBinding[] {
  const bindings: OrchestratorActionBinding[] = [];
  let actionsIndent = -1;
  for (let i = 0; i < sub.length; i++) {
    const line = sub[i];
    if (isBlank(line)) continue;
    const t = line.trim();
    const ind = getIndent(line);
    if (t === "actions:") {
      actionsIndent = ind;
      continue;
    }
    if (actionsIndent < 0 || ind <= actionsIndent) continue;
    const aliasMatch = t.match(/^([\w-]+):\s*@actions\.([\w.-]+)\s*$/);
    if (aliasMatch && ind === actionsIndent + 2) {
      bindings.push({ alias: aliasMatch[1], actionName: aliasMatch[2] });
      continue;
    }
    const withArg = parseWithArgLine(line);
    if (withArg && bindings.length > 0) {
      const last = bindings[bindings.length - 1];
      last.withArgs = last.withArgs ?? [];
      last.withArgs.push(withArg);
    }
  }
  return bindings;
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
        // May be a `|` block scalar, so go through readMappingValue rather than
        // treating the inline remainder as the whole value.
        node.label = readMappingValue(body, i);
        break;
      case "description":
        node.description = readMappingValue(body, i);
        break;
      case "llm": {
        const m = val.match(/@llm\.([\w.-]+)/);
        if (m) node.llmBindingName = m[1];
        break;
      }
      case "kind": {
        const k = unquote(val);
        if (kind === "trigger") node.interfaceName = k;
        else if (kind === "echo") {
          if (k === "a2a:artifact_update_event") node.echoKind = "a2a:artifact_update_event";
          else if (k === "a2a:response") node.echoKind = "a2a:response";
          else node.echoKind = "a2a:status_update_event";
        }
        break;
      }
      case "state":
        node.state = unquote(val);
        break;
      case "task": {
        const inline = val.trim();
        node.taskExpr = readExpressionValue(body, i);
        if (inline === "a2a.task({" || (inline.startsWith("a2a.task({") && !inline.endsWith("})"))) {
          node.echoTaskMultiline = true;
        }
        break;
      }
      case "message": {
        const inline = val.trim();
        node.message = readExpressionValue(body, i);
        if (
          inline === "a2a.message({" ||
          (inline.startsWith("a2a.message({") && !inline.endsWith("})"))
        ) {
          node.echoMessageMultiline = true;
        }
        break;
      }
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
      case "target":
        if (kind === "trigger") node.triggerTarget = unquote(val);
        break;
      case "metadata":
        node.metadataExpr = readExpressionValue(body, i);
        break;
      case "prompt": {
        if (val.trim() === "->") node.promptProcedure = true;
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
        const instr = readInstructionsField(sub);
        if (instr.text !== undefined) node.reasoningInstructions = instr.text;
        if (instr.procedure) node.reasoningInstructionsProcedure = true;
        const bindings = parseActionBindings(sub);
        if (bindings.length > 0) {
          node.actionBindings = bindings;
          node.actionRefs = [...new Set(bindings.map((b) => b.actionName))];
        } else {
          const refs = readActionRefs(sub);
          if (refs.length > 0) node.actionRefs = refs;
        }
        for (let ri = 0; ri < sub.length; ri++) {
          const st = sub[ri].trim();
          if (st === "outputs:") {
            node.outputs = parseOutputs(collectDeeper(sub, ri, getIndent(sub[ri])));
            break;
          }
        }
        for (const rl of sub) {
          const loops = rl.trim().match(/^max_number_of_loops:\s*(\d+)\s*$/);
          if (loops) node.maxNumberOfLoops = Number.parseInt(loops[1], 10);
          const timeout = rl.trim().match(/^task_timeout_secs:\s*(\d+)\s*$/);
          if (timeout) node.taskTimeoutSecs = Number.parseInt(timeout[1], 10);
          const maxErrors = rl.trim().match(/^max_consecutive_errors:\s*(\d+)\s*$/);
          if (maxErrors) node.maxConsecutiveErrors = Number.parseInt(maxErrors[1], 10);
        }
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
        const statements = parseExecutorDoStatements(collectDeeper(body, i, 2));
        if (statements.length > 0) node.executorStatements = statements;
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

function readInstructionsField(sub: string[]): { text?: string; procedure?: boolean } {
  for (let i = 0; i < sub.length; i++) {
    const m = sub[i].match(/^(\s*)instructions:\s*(.*)$/);
    if (!m) continue;
    const val = m[2].trim();
    if (val === "->") {
      return {
        text: normalizeParsedInstructionText(readProcedureBlock(sub, i, getIndent(sub[i]))),
        procedure: true,
      };
    }
    return {
      text: normalizeParsedInstructionText(readMappingValue(sub, i)),
      procedure: false,
    };
  }
  return {};
}

function parseDialectHeader(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const dialect = t.match(/^#\s*@dialect:\s*AGENTFABRIC=(.+)$/i);
    if (dialect) return dialect[1].trim();
    if (!t.startsWith("#")) break;
  }
  return undefined;
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
  const result: ParsedBrokerAgent = {
    llmBindings: [],
    actions: [],
    nodes: [],
    agentDialectVersion: parseDialectHeader(text),
  };
  for (const g of groups) {
    if (g.header === "system:") {
      const system = readRootSystemInstructions(g.body);
      if (system.text !== undefined) result.systemInstructions = system.text;
      if (system.procedure) result.systemInstructionsProcedure = true;
      continue;
    }
    if (g.header === "config:") {
      const cfg = parseConfig(g.body);
      result.agentName = cfg.agentName;
      result.agentConfigLabel = cfg.agentConfigLabel;
      result.agentConfigDescription = cfg.agentConfigDescription;
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
