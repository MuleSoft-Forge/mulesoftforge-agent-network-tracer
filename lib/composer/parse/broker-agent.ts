/**
 * Reverse of serialize/broker-agent.ts: parse a brokers/<name>.agent file back
 * into the pieces the model needs. Names (not ids) are used for transition
 * targets; the assembler in ./index.ts resolves them to node ids.
 *
 * The parser is tolerant: unknown lines are ignored, and it round-trips the
 * exact shape our serializer emits (see scripts/composer-test.mts).
 */

import type {
  ExecutorStatement,
  GraphNodeKind,
  OrchestratorActionBinding,
  OutputProperty,
  OutputSchemaNode,
  OutputValue,
} from "@/lib/composer/model";
import { applyLlmYamlParam } from "@/lib/composer/llm-binding-params";
import { readExpressionValue } from "@/lib/composer/echo-expressions";
import { normalizeParsedInstructionText } from "@/lib/composer/instruction-text";

export interface ParsedLlmBinding {
  name: string;
  connectionName: string;
  provider: "OpenAI" | "Gemini";
  model: string;
  reasoningEffort?: "NONE" | "MINIMAL" | "LOW" | "MEDIUM" | "HIGH" | "XHIGH";
  temperature?: number;
  topP?: number;
  topLogprobs?: number;
  maxOutputTokens?: number;
  headers?: string;
  timeout?: number;
  apiKey?: string;
  thinkingLevel?: "LOW" | "HIGH";
  thinkingBudget?: number;
  responseLogprobs?: boolean;
  params?: Record<string, string | number | boolean>;
}

export interface ParsedActionInput {
  name: string;
  type: string;
  default?: OutputValue;
}

export interface ParsedAction {
  name: string;
  label?: string;
  description?: string;
  actionKind: "a2a:send_message" | "mcp:tool";
  connectionName: string;
  toolName?: string;
  inputs?: ParsedActionInput[];
  httpHeaders?: Array<{ name: string; value: string }>;
}

export interface ParsedAgentScriptVariable {
  name: string;
  modifier: "mutable" | "linked";
  type: string;
  defaultExpression?: string;
  label?: string;
  description?: string;
  isRequired?: boolean;
}

export interface ParsedNodeReference {
  kind: GraphNodeKind;
  name: string;
}

export interface ParsedRoute {
  target: ParsedNodeReference;
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
  reasoningInstructionsProcedureInline?: boolean;
  actionRefs?: string[];
  actionBindings?: OrchestratorActionBinding[];
  promptProcedure?: boolean;
  promptProcedureInline?: boolean;
  outputs?: OutputProperty[];
  executorStatements?: ExecutorStatement[];
  routes?: ParsedRoute[];
  otherwiseTarget?: ParsedNodeReference;
  echoKind?: "a2a:status_update_event" | "a2a:artifact_update_event";
  state?: string;
  message?: string;
  echoMessageMultiline?: boolean;
  artifactExpr?: string;
  echoAppend?: boolean;
  echoLastChunk?: boolean;
  metadataExpr?: string;
  onExitTarget?: ParsedNodeReference;
  maxNumberOfLoops?: number;
  taskTimeoutSecs?: number;
  maxConsecutiveErrors?: number;
}

export interface ParsedBrokerAgent {
  systemInstructions?: string;
  systemInstructionsProcedure?: boolean;
  systemInstructionsProcedureInline?: boolean;
  agentDialectVersion?: string;
  agentName?: string;
  agentConfigLabel?: string;
  agentConfigDescription?: string;
  defaultLlm?: string;
  agentScriptVariables: ParsedAgentScriptVariable[];
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
  if (s === "true" || s === "True") return true;
  if (s === "false" || s === "False") return false;
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

  if (/^->(?:\s|$)/.test(val)) {
    const inlineExpression = val.slice(2).trim();
    return inlineExpression || readProcedureBlock(lines, lineIdx, keyIndent);
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
  for (let lineIndex = 0; lineIndex < body.length; lineIndex++) {
    const line = body[lineIndex];
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
    } else if (key === "headers") {
      current.headers = readExpressionValue(body, lineIndex);
    } else if (key === "timeout") {
      current.timeout = Number(val);
    } else if (key === "api_key") {
      current.apiKey = unquote(val);
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
  for (let lineIndex = 0; lineIndex < body.length; lineIndex++) {
    const line = body[lineIndex];
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
      } else if (key === "label") {
        current.label = unquote(val);
      } else if (key === "description") {
        current.description = readMappingValue(body, lineIndex);
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
          ...(m[3] !== undefined ? { default: parseScalar(m[3]) } : {}),
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

function parseVariables(body: string[]): ParsedAgentScriptVariable[] {
  const variables: ParsedAgentScriptVariable[] = [];
  let current: ParsedAgentScriptVariable | null = null;
  for (const line of body) {
    if (isBlank(line) || line.trimStart().startsWith("#")) continue;
    const indent = getIndent(line);
    const text = line.trim();
    if (indent === 2) {
      const declaration = text.match(
        /^([\w-]+):\s*(mutable|linked)\s+([^\s=]+)(?:\s*=\s*(.*))?$/
      );
      if (declaration) {
        current = {
          name: declaration[1],
          modifier: declaration[2] as ParsedAgentScriptVariable["modifier"],
          type: declaration[3],
          ...(declaration[4] !== undefined
            ? { defaultExpression: declaration[4].trim() }
            : {}),
        };
        variables.push(current);
      }
      continue;
    }
    if (!current || indent < 4) continue;
    const property = text.match(/^([\w-]+):\s*(.*)$/);
    if (!property) continue;
    const [, key, rawValue] = property;
    if (key === "label") current.label = unquote(rawValue);
    else if (key === "description") current.description = unquote(rawValue);
    else if (key === "is_required") {
      current.isRequired = rawValue === "True" || rawValue === "true";
    }
  }
  return variables;
}

function parseOutputValue(raw: string): OutputValue {
  const trimmed = raw.trim();
  if (/^(['"]).*\1$/.test(trimmed)) return unquote(trimmed);
  if (trimmed === "true" || trimmed === "True") return true;
  if (trimmed === "false" || trimmed === "False") return false;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : unquote(trimmed);
}

function parseOutputSchema(
  body: string[],
  startIdx: number,
  parentIndent: number
): { schema: OutputSchemaNode; endIdx: number } {
  const schema: OutputSchemaNode = { type: "string" };
  const fieldIndent = parentIndent + 2;
  let i = startIdx;
  while (i < body.length) {
    const line = body[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const indent = getIndent(line);
    if (indent <= parentIndent) break;
    if (indent !== fieldIndent) {
      i++;
      continue;
    }
    const text = line.trim();
    const typeMatch = text.match(/^type:\s*(.*)$/);
    if (typeMatch) {
      const parsed = unquote(typeMatch[1]);
      if (OUTPUT_TYPES.has(parsed)) schema.type = parsed as OutputSchemaNode["type"];
      i++;
      continue;
    }
    const stringFields: Array<[RegExp, keyof Pick<OutputSchemaNode, "description" | "pattern">]> = [
      [/^description:\s*(.*)$/, "description"],
      [/^pattern:\s*(.*)$/, "pattern"],
    ];
    const stringField = stringFields.find(([pattern]) => pattern.test(text));
    if (stringField) {
      const match = text.match(stringField[0]);
      schema[stringField[1]] = unquote(match?.[1] ?? "");
      i++;
      continue;
    }
    const defaultMatch = text.match(/^default:\s*(.*)$/);
    if (defaultMatch) {
      schema.default = parseOutputValue(defaultMatch[1]);
      i++;
      continue;
    }
    const numberFields: Array<
      [RegExp, keyof Pick<OutputSchemaNode, "minimum" | "maximum" | "exclusiveMinimum" | "exclusiveMaximum">]
    > = [
      [/^minimum:\s*(.*)$/, "minimum"],
      [/^maximum:\s*(.*)$/, "maximum"],
      [/^exclusiveMinimum:\s*(.*)$/, "exclusiveMinimum"],
      [/^exclusiveMaximum:\s*(.*)$/, "exclusiveMaximum"],
    ];
    const numberField = numberFields.find(([pattern]) => pattern.test(text));
    if (numberField) {
      const match = text.match(numberField[0]);
      schema[numberField[1]] = parseOutputNumber(match?.[1] ?? "");
      i++;
      continue;
    }
    const integerFields: Array<
      [RegExp, keyof Pick<OutputSchemaNode, "minLength" | "maxLength" | "minItems" | "maxItems">]
    > = [
      [/^minLength:\s*(.*)$/, "minLength"],
      [/^maxLength:\s*(.*)$/, "maxLength"],
      [/^minItems:\s*(.*)$/, "minItems"],
      [/^maxItems:\s*(.*)$/, "maxItems"],
    ];
    const integerField = integerFields.find(([pattern]) => pattern.test(text));
    if (integerField) {
      const match = text.match(integerField[0]);
      schema[integerField[1]] = parseOutputInteger(match?.[1] ?? "");
      i++;
      continue;
    }
    if (text === "required:" || text === "enum:") {
      const values: OutputValue[] = [];
      i++;
      while (i < body.length) {
        const itemLine = body[i];
        if (isBlank(itemLine)) {
          i++;
          continue;
        }
        if (getIndent(itemLine) <= fieldIndent) break;
        const item = itemLine.trim().match(/^-\s*(.*)$/);
        if (item) values.push(parseOutputValue(item[1]));
        i++;
      }
      if (text === "required:") {
        schema.required = values.map(String);
      } else {
        schema.enum = values;
      }
      continue;
    }
    if (text === "properties:") {
      const nested = parseOutputProperties(body, i + 1, indent);
      schema.properties = nested.props;
      i = nested.endIdx;
      continue;
    }
    if (text === "items:") {
      const nested = parseOutputSchema(body, i + 1, indent);
      schema.items = nested.schema;
      i = nested.endIdx;
      continue;
    }
    i++;
  }
  return { schema, endIdx: i };
}

function parseOutputProperties(
  body: string[],
  startIdx: number,
  listIndent: number
): { props: OutputProperty[]; endIdx: number } {
  const props: OutputProperty[] = [];
  let i = startIdx;
  while (i < body.length) {
    const line = body[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const indent = getIndent(line);
    if (indent <= listIndent) break;
    if (indent !== listIndent + 2) {
      i++;
      continue;
    }
    const nameMatch = line.trim().match(/^([\w-]+):$/);
    if (!nameMatch) {
      i++;
      continue;
    }
    const parsed = parseOutputSchema(body, i + 1, indent);
    props.push({ name: nameMatch[1], ...parsed.schema });
    i = parsed.endIdx;
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

function parseInlineWithArgs(fragment: string): Array<{ name: string; value: string }> {
  const markers: Array<{ start: number; valueStart: number; name: string }> = [];
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < fragment.length; index++) {
    const character = fragment[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") {
      depth++;
      continue;
    }
    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (
      depth === 0 &&
      (index === 0 || /\s/.test(fragment[index - 1])) &&
      fragment.startsWith("with", index)
    ) {
      const marker = fragment
        .slice(index)
        .match(/^with\s+([\w-]+)\s*=\s*/);
      if (marker) {
        markers.push({
          start: index,
          valueStart: index + marker[0].length,
          name: marker[1],
        });
        index += marker[0].length - 1;
      }
    }
  }

  return markers.flatMap((marker, index) => {
    const valueEnd = markers[index + 1]?.start ?? fragment.length;
    const value = fragment.slice(marker.valueStart, valueEnd).trim();
    return value ? [{ name: marker.name, value }] : [];
  });
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
  let currentRun: {
    actionName: string;
    indent: number;
    withArgs: Array<{ name: string; value: string }>;
    captures: Array<{ kind: "set"; variable: string; expression: string }>;
  } | null = null;

  function flushRun() {
    if (!currentRun) return;
    statements.push({
      kind: "run",
      actionName: currentRun.actionName,
      ...(currentRun.withArgs.length > 0 ? { withArgs: currentRun.withArgs } : {}),
      ...(currentRun.captures.length > 0 ? { captures: currentRun.captures } : {}),
    });
    currentRun = null;
  }

  for (const raw of sub) {
    const indent = getIndent(raw);
    let line = raw.trim();
    if (line.startsWith("->")) line = line.slice(2).trim();
    if (!line) continue;

    if (currentRun && indent > currentRun.indent) {
      const continuedWithArgs = parseInlineWithArgs(line);
      if (line.startsWith("with ") && continuedWithArgs.length > 0) {
        currentRun.withArgs.push(...continuedWithArgs);
        continue;
      }
      const capture = line.match(/^set\s+@variables\.([\w.-]+)\s*=\s*(.+)$/);
      if (capture) {
        currentRun.captures.push({
          kind: "set",
          variable: capture[1],
          expression: capture[2].trim(),
        });
        continue;
      }
    }
    if (currentRun && indent <= currentRun.indent) flushRun();

    const setPattern = /set\s+@variables\.([\w.-]+)\s*=\s*/g;
    let cursor = 0;
    let setMatch: RegExpExecArray | null;
    while ((setMatch = setPattern.exec(line)) !== null) {
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
      currentRun = {
        actionName: runMatch[1],
        indent,
        withArgs: [],
        captures: [],
      };
      const afterRun = remainder.slice(runMatch.index! + runMatch[0].length);
      currentRun.withArgs.push(...parseInlineWithArgs(afterRun));
    }
  }

  flushRun();
  return statements;
}

function readRootSystemInstructions(body: string[]): { text?: string; procedure?: boolean; inline?: boolean } {
  for (let i = 0; i < body.length; i++) {
    const m = body[i].match(/^(\s*)instructions:\s*(.*)$/);
    if (!m) continue;
    const val = m[2].trim();
    if (/^->(?:\s|$)/.test(val)) {
      return {
        text: normalizeParsedInstructionText(
          val.slice(2).trim() || readProcedureBlock(body, i, getIndent(body[i])),
        ),
        procedure: true,
        inline: val !== "->",
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

function parseActionBindings(sub: string[], nodeName: string): OrchestratorActionBinding[] {
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
    if (actionsIndent < 0) continue;
    if (ind <= actionsIndent) {
      actionsIndent = -1;
      continue;
    }
    const aliasMatch = t.match(/^([\w-]+):\s*@actions\.([\w.-]+)(.*)$/);
    if (aliasMatch && ind === actionsIndent + 2) {
      const withArgs = parseInlineWithArgs(aliasMatch[3]);
      bindings.push({
        alias: aliasMatch[1],
        actionName: aliasMatch[2],
        ...(withArgs.length > 0 ? { withArgs } : {}),
      });
      continue;
    }
    const withArg = parseWithArgLine(line);
    if (withArg && bindings.length > 0) {
      const last = bindings[bindings.length - 1];
      last.withArgs = last.withArgs ?? [];
      last.withArgs.push(withArg);
      continue;
    }
    if (t.startsWith("#")) continue;
    throw new Error(
      `node "${nodeName}" uses an unsupported reasoning action binding statement: ${JSON.stringify(t)}`,
    );
  }
  return bindings;
}

function parseNodeReference(source: string): ParsedNodeReference | undefined {
  const match = source.match(/@([\w-]+)\.([\w.-]+)/);
  if (!match || !NODE_KINDS.includes(match[1] as GraphNodeKind)) return undefined;
  return { kind: match[1] as GraphNodeKind, name: match[2] };
}

/** First `transition to @<kind>.<name>` nested under `body[i]`. */
function readTransition(body: string[], i: number): ParsedNodeReference | undefined {
  const sub = collectDeeper(body, i, getIndent(body[i]));
  for (const l of sub) {
    if (!l.includes("transition to")) continue;
    const target = parseNodeReference(l);
    if (target) return target;
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
          else if (k === "a2a:response") {
            throw new Error(
              `${name}: unsupported echo kind "a2a:response"; use a2a:status_update_event or a2a:artifact_update_event`
            );
          }
          else node.echoKind = "a2a:status_update_event";
        }
        break;
      }
      case "state":
        node.state = unquote(val);
        break;
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
        if (/^->(?:\s|$)/.test(val.trim())) {
          node.promptProcedure = true;
          if (val.trim() !== "->") node.promptProcedureInline = true;
        }
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
        if (instr.inline) node.reasoningInstructionsProcedureInline = true;
        const bindings = parseActionBindings(sub, name);
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
        if (target) node.onExitTarget = target;
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
          if (!l.includes("target:")) continue;
          const target = parseNodeReference(l);
          if (target) node.otherwiseTarget = target;
        }
        break;
      }
      default:
        break;
    }
  }
  return node;
}

function readInstructionsField(sub: string[]): { text?: string; procedure?: boolean; inline?: boolean } {
  for (let i = 0; i < sub.length; i++) {
    const m = sub[i].match(/^(\s*)instructions:\s*(.*)$/);
    if (!m) continue;
    const val = m[2].trim();
    if (/^->(?:\s|$)/.test(val)) {
      return {
        text: normalizeParsedInstructionText(
          val.slice(2).trim() || readProcedureBlock(sub, i, getIndent(sub[i])),
        ),
        procedure: true,
        inline: val !== "->",
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
    if (/^-\s*target:/.test(t)) {
      const target = parseNodeReference(t);
      if (!target) continue;
      current = { target, when: "true" };
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
    agentScriptVariables: [],
    llmBindings: [],
    actions: [],
    nodes: [],
    agentDialectVersion: parseDialectHeader(text),
  };
  for (const g of groups) {
    if (g.header === "system:") {
      const unsupportedSystemFields = g.body.flatMap((line) => {
        if (isBlank(line) || line.trimStart().startsWith("#") || getIndent(line) !== 2) return [];
        const key = line.trim().match(/^([\w-]+):/)?.[1];
        return key && key !== "instructions" ? [key] : [];
      });
      if (unsupportedSystemFields.length > 0) {
        throw new Error(
          `Builder import does not support system field${
            unsupportedSystemFields.length === 1 ? "" : "s"
          } ${unsupportedSystemFields.map((field) => JSON.stringify(field)).join(", ")}; no field was discarded.`
        );
      }
      const system = readRootSystemInstructions(g.body);
      if (system.text !== undefined) result.systemInstructions = system.text;
      if (system.procedure) result.systemInstructionsProcedure = true;
      if (system.inline) result.systemInstructionsProcedureInline = true;
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
    if (g.header === "variables:") {
      result.agentScriptVariables = parseVariables(g.body);
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
