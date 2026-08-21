import { gunzipSync } from "node:zlib";
import type {
  TaskStory,
  TaskStoryArtifact,
  TaskStoryMessage,
  TaskStoryStateEntry,
} from "./v2-parser";
import { parseGraphStateEntries } from "./v2-parser";

/**
 * The v2 (Python) Agent Broker persists A2A `Task` objects to the Object Store as
 * **base64-encoded Python pickles** (protocol 2–5), not JSON. This module provides
 * a small, dependency-free pickle reader plus a mapper from the pickled
 * `a2a.types.Task` object graph into our {@link TaskStory}. Only the opcode subset
 * emitted by CPython's default pickler for pydantic models is supported; anything
 * unexpected throws and callers fall back to raw string extraction.
 */

/** A reconstructed Python object instance (from NEWOBJ + BUILD/__setstate__). */
interface PyObject {
  __pickleClass: string;
  fields: Record<string, unknown>;
}

/** A `module.attr` reference pushed by STACK_GLOBAL. */
interface PyGlobal {
  __pickleGlobal: string;
}

/** The result of a REDUCE (e.g. an Enum like `TaskState('completed')`). */
interface PyReduce {
  __pickleReduce: string;
  args: unknown[];
}

const MARK = Symbol("pickle.mark");

function isPyObject(value: unknown): value is PyObject {
  return typeof value === "object" && value !== null && "__pickleClass" in value;
}

function isPyReduce(value: unknown): value is PyReduce {
  return typeof value === "object" && value !== null && "__pickleReduce" in value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) && !isPyObject(value) && !isPyReduce(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Minimal pickle virtual machine. Returns the single object left on the stack at
 * STOP. Throws on unsupported opcodes so the caller can fall back safely.
 */
function unpickle(buf: Buffer): unknown {
  const stack: unknown[] = [];
  const memo: unknown[] = [];
  let pos = 0;

  const readLine = (): void => {
    // Only used by legacy text opcodes we don't expect; skip to newline.
    while (pos < buf.length && buf[pos] !== 0x0a) pos++;
    pos++;
  };
  void readLine;

  const popMark = (): unknown[] => {
    const idx = stack.lastIndexOf(MARK);
    if (idx === -1) throw new Error("pickle: mark not found");
    const items = stack.slice(idx + 1);
    stack.length = idx;
    return items;
  };

  const readUtf8 = (len: number): string => {
    const s = buf.toString("utf8", pos, pos + len);
    pos += len;
    return s;
  };

  while (pos < buf.length) {
    const op = buf[pos++];
    switch (op) {
      case 0x80: // PROTO
        pos += 1;
        break;
      case 0x95: // FRAME (8-byte length; we stream regardless)
        pos += 8;
        break;
      case 0x2e: // STOP '.'
        return stack.pop();
      case 0x28: // MARK '('
        stack.push(MARK);
        break;
      case 0x94: // MEMOIZE
        memo.push(stack[stack.length - 1]);
        break;
      case 0x68: // BINGET 'h'
        stack.push(memo[buf[pos++]]);
        break;
      case 0x6a: // LONG_BINGET 'j'
        stack.push(memo[buf.readUInt32LE(pos)]);
        pos += 4;
        break;
      case 0x71: // BINPUT 'q' (index byte) — no-op with our memo model
        pos += 1;
        memo.push(stack[stack.length - 1]);
        break;
      case 0x8c: {
        // SHORT_BINUNICODE
        const len = buf[pos++];
        stack.push(readUtf8(len));
        break;
      }
      case 0x58: {
        // BINUNICODE 'X' (4-byte LE length)
        const len = buf.readUInt32LE(pos);
        pos += 4;
        stack.push(readUtf8(len));
        break;
      }
      case 0x8d: {
        // BINUNICODE8 (8-byte LE length)
        const len = Number(buf.readBigUInt64LE(pos));
        pos += 8;
        stack.push(readUtf8(len));
        break;
      }
      case 0x4e: // NONE 'N'
        stack.push(null);
        break;
      case 0x88: // NEWTRUE
        stack.push(true);
        break;
      case 0x89: // NEWFALSE
        stack.push(false);
        break;
      case 0x4b: // BININT1 'K'
        stack.push(buf[pos++]);
        break;
      case 0x4d: // BININT2 'M'
        stack.push(buf.readUInt16LE(pos));
        pos += 2;
        break;
      case 0x4a: // BININT 'J' (signed 4-byte LE)
        stack.push(buf.readInt32LE(pos));
        pos += 4;
        break;
      case 0x8a: {
        // LONG1 (1-byte length, little-endian signed)
        const n = buf[pos++];
        let val = 0;
        for (let i = 0; i < n; i++) val += buf[pos + i] * 2 ** (8 * i);
        pos += n;
        stack.push(val);
        break;
      }
      case 0x47: // BINFLOAT 'G' (8-byte big-endian double)
        stack.push(buf.readDoubleBE(pos));
        pos += 8;
        break;
      case 0x29: // EMPTY_TUPLE ')'
        stack.push([]);
        break;
      case 0x7d: // EMPTY_DICT '}'
        stack.push({} as Record<string, unknown>);
        break;
      case 0x5d: // EMPTY_LIST ']'
        stack.push([]);
        break;
      case 0x8f: // EMPTY_SET
        stack.push([]);
        break;
      case 0x85: {
        // TUPLE1
        const a = stack.pop();
        stack.push([a]);
        break;
      }
      case 0x86: {
        // TUPLE2
        const b = stack.pop();
        const a = stack.pop();
        stack.push([a, b]);
        break;
      }
      case 0x87: {
        // TUPLE3
        const c = stack.pop();
        const b = stack.pop();
        const a = stack.pop();
        stack.push([a, b, c]);
        break;
      }
      case 0x74: // TUPLE 't'
        stack.push(popMark());
        break;
      case 0x93: {
        // STACK_GLOBAL
        const name = stack.pop() as string;
        const moduleName = stack.pop() as string;
        stack.push({ __pickleGlobal: `${moduleName}.${name}` } satisfies PyGlobal);
        break;
      }
      case 0x81: {
        // NEWOBJ
        stack.pop(); // args tuple (ignored — pydantic uses __setstate__)
        const cls = stack.pop() as PyGlobal;
        stack.push({ __pickleClass: cls.__pickleGlobal, fields: {} } satisfies PyObject);
        break;
      }
      case 0x52: {
        // REDUCE
        const args = stack.pop() as unknown[];
        const callable = stack.pop() as PyGlobal;
        stack.push({ __pickleReduce: callable.__pickleGlobal, args } satisfies PyReduce);
        break;
      }
      case 0x62: {
        // BUILD (__setstate__)
        const state = stack.pop();
        const obj = stack[stack.length - 1];
        if (isPyObject(obj)) {
          const rec = asRecord(state);
          if (rec) {
            const dict = asRecord(rec.__dict__);
            const source = dict ?? rec;
            for (const [k, v] of Object.entries(source)) {
              if (k.startsWith("__pydantic")) continue;
              obj.fields[k] = v;
            }
          }
        }
        break;
      }
      case 0x73: {
        // SETITEM 's'
        const value = stack.pop();
        const key = stack.pop();
        const dict = stack[stack.length - 1] as Record<string, unknown>;
        dict[String(key)] = value;
        break;
      }
      case 0x75: {
        // SETITEMS 'u'
        const items = popMark();
        const dict = stack[stack.length - 1] as Record<string, unknown>;
        for (let i = 0; i + 1 < items.length; i += 2) {
          dict[String(items[i])] = items[i + 1];
        }
        break;
      }
      case 0x61: {
        // APPEND 'a'
        const value = stack.pop();
        (stack[stack.length - 1] as unknown[]).push(value);
        break;
      }
      case 0x65: {
        // APPENDS 'e'
        const items = popMark();
        (stack[stack.length - 1] as unknown[]).push(...items);
        break;
      }
      case 0x90: {
        // ADDITEMS (set)
        const items = popMark();
        (stack[stack.length - 1] as unknown[]).push(...items);
        break;
      }
      default:
        throw new Error(`pickle: unsupported opcode 0x${op.toString(16)} at ${pos - 1}`);
    }
  }
  throw new Error("pickle: reached end without STOP");
}

/** Decode a stored value into raw pickle bytes, transparently gunzipping. */
function toPickleBytes(rawBase64: string): Buffer | null {
  const trimmed = rawBase64.trim();
  // Real JSON values never need pickle decoding — bail fast.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(trimmed, "base64");
  } catch {
    return null;
  }
  if (buf.length < 2) return null;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = gunzipSync(buf);
    } catch {
      return null;
    }
  }
  return buf;
}

/** True when a stored STRING value is a base64 (optionally gzipped) pickle. */
export function looksLikePickle(rawBase64: string): boolean {
  const buf = toPickleBytes(rawBase64);
  return Boolean(buf && buf.length > 1 && buf[0] === 0x80);
}

/** Parse a base64 pickle into its reconstructed object graph, or null on failure. */
export function decodePickle(rawBase64: string): unknown {
  const buf = toPickleBytes(rawBase64);
  if (!buf) return null;
  try {
    return unpickle(buf);
  } catch {
    return null;
  }
}

/** Unwrap an Enum-like REDUCE (e.g. Role, TaskState) to its string value. */
function reduceScalar(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isPyReduce(value)) {
    const first = value.args[0];
    return typeof first === "string" ? first : undefined;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Join an a2a `parts` list (each a `Part` wrapping a `TextPart`/`DataPart`) to text. */
function pickledPartsToText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    if (!isPyObject(part)) continue;
    const root = isPyObject(part.fields.root) ? (part.fields.root as PyObject) : part;
    const text = asString(root.fields.text);
    if (text) {
      chunks.push(text.trim());
      continue;
    }
    if (root.fields.data !== undefined && root.fields.data !== null) {
      try {
        chunks.push(JSON.stringify(root.fields.data));
      } catch {
        // ignore non-serializable data parts
      }
    }
  }
  return chunks.join("\n").trim();
}

function pickledMessageToStory(message: unknown): TaskStoryMessage | null {
  if (!isPyObject(message)) return null;
  const text = pickledPartsToText(message.fields.parts);
  if (!text) return null;
  const role = reduceScalar(message.fields.role) || "agent";
  return {
    role,
    text,
    messageId: asString(message.fields.message_id),
    kind: asString(message.fields.kind),
  };
}

/** True when a reconstructed object graph is (or contains) an a2a Task. */
function isTaskObject(obj: unknown): obj is PyObject {
  if (!isPyObject(obj)) return false;
  if (obj.__pickleClass.endsWith(".Task")) return true;
  const f = obj.fields;
  return "history" in f || "status" in f || "artifacts" in f;
}

/**
 * Map a pickled `a2a.types.Task` object graph into a {@link TaskStory}. Returns
 * null when the value isn't a pickled task.
 */
export function parsePickledA2ATask(rawBase64: string): TaskStory | null {
  const root = decodePickle(rawBase64);
  if (!isTaskObject(root)) return null;
  const f = root.fields;

  const history: TaskStoryMessage[] = [];
  if (Array.isArray(f.history)) {
    for (const message of f.history) {
      const story = pickledMessageToStory(message);
      if (story) history.push(story);
    }
  }

  const artifacts: TaskStoryArtifact[] = [];
  if (Array.isArray(f.artifacts)) {
    for (const artifact of f.artifacts) {
      if (!isPyObject(artifact)) continue;
      const text = pickledPartsToText(artifact.fields.parts);
      if (!text) continue;
      artifacts.push({
        name: asString(artifact.fields.name),
        description: asString(artifact.fields.description),
        text,
      });
    }
  }

  let statusState: string | undefined;
  let statusText: string | undefined;
  let statusTimestamp: string | undefined;
  if (isPyObject(f.status)) {
    statusState = reduceScalar(f.status.fields.state);
    statusTimestamp = asString(f.status.fields.timestamp);
    statusText = pickledMessageToStory(f.status.fields.message)?.text;
  }

  return {
    taskId: asString(f.id),
    contextId: asString(f.context_id),
    statusState,
    statusText,
    statusTimestamp,
    history,
    artifacts,
    stateEntries: [],
  };
}

/**
 * Flat readable strings from a pickled task, for the legacy reasoning/message
 * views (history text, artifacts, final status message).
 */
export function extractStringsFromPickledTask(rawBase64: string): string[] {
  const story = parsePickledA2ATask(rawBase64);
  if (!story) return [];
  const out: string[] = [];
  for (const message of story.history) out.push(message.text);
  for (const artifact of story.artifacts) out.push(artifact.text);
  if (story.statusText) out.push(story.statusText);
  return [...new Set(out.filter((s) => s.trim().length > 0))];
}

/**
 * Recursively flatten the pickled object graph into plain JSON values: unwrap
 * pydantic `PyObject` envelopes to their `fields`, collapse `PyReduce` enums to
 * their scalar value, and drop dunder bookkeeping keys (`__pydantic_*`). This lets
 * downstream JSON walkers treat a pickled model like ordinary JSON.
 */
function normalizePickled(value: unknown, depth = 0): unknown {
  if (depth > 16 || value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (isPyReduce(value)) {
    const scalar = reduceScalar(value);
    return scalar ?? value.args.map((a) => normalizePickled(a, depth + 1));
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizePickled(item, depth + 1));
  }
  if (isPyObject(value)) {
    return normalizeRecord(value.fields, depth);
  }
  const record = asRecord(value);
  if (record) return normalizeRecord(record, depth);
  return null;
}

function normalizeRecord(record: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    if (key.startsWith("__")) continue;
    out[key] = normalizePickled(nested, depth + 1);
  }
  return out;
}

function digRecord(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Extract keyed state entries from a pickled `module_graph_runtime …
 * StateContainer` (the v2 graph-state-store value). The broker persists the run's
 * per-node outputs and reasoning under `execution.runtime.state_variables` /
 * `system_variables`; the large static `session_unified_spec` (the network
 * definition/schemas) is intentionally skipped so only run-specific reasoning
 * surfaces. Returns [] when the value isn't a pickled StateContainer.
 */
export function parsePickledGraphState(rawBase64: string): TaskStoryStateEntry[] {
  const root = decodePickle(rawBase64);
  if (!isPyObject(root)) return [];
  const normalized = normalizePickled(root);

  const runtime = digRecord(normalized, ["execution", "runtime"]);
  const scoped: Record<string, unknown> = {};
  const stateVariables = digRecord(runtime, ["state_variables"]);
  const systemVariables = digRecord(runtime, ["system_variables"]);
  const currentNode = digRecord(runtime, ["current_node"]);
  if (stateVariables !== undefined) scoped.state_variables = stateVariables;
  if (systemVariables !== undefined) scoped.system_variables = systemVariables;
  if (typeof currentNode === "string") scoped.current_node = currentNode;

  // Fall back to the whole (normalized) graph when the expected shape is absent,
  // so unfamiliar StateContainer layouts still yield something useful.
  const target = Object.keys(scoped).length > 0 ? scoped : normalized;
  let entries: TaskStoryStateEntry[];
  try {
    entries = parseGraphStateEntries(JSON.stringify(target));
  } catch {
    return [];
  }

  // Drop identifier noise (message/trace ids) so only human-meaningful reasoning,
  // tool inputs, and agent responses remain.
  const uuidOnly = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return entries.filter(
    (entry) => !/message_?id$|(?:^|\.)id$/i.test(entry.key) && !uuidOnly.test(entry.text.trim())
  );
}
