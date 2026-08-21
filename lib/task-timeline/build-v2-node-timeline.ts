import type { LogEntry, TaskStory } from "@/components/task-details/types";

/**
 * v2 (node-graph) task presentation.
 *
 * v1 brokers ran a ReAct-style loop, so the tracer models tasks as
 * iterations→steps. v2 brokers run an AgentScript **node graph**
 * (`module_graph_runtime`): "Current node", "Transitioning to next node",
 * node-scoped tool calls, and per-node LLM reasoning. Forcing those into the v1
 * iteration model produces a procedural list of component names with no detail.
 *
 * This builder reconstructs the graph execution as an ordered list of **node
 * visits**, each carrying the *what* (reasoning, tool input/output, produced
 * transition, and per-node state) instead of just the node's name. It is a pure
 * function over the already-parsed log entries (+ optional Object Store story for
 * per-node state) and never touches the v1 path.
 */

/** A single tool invocation within a node visit. */
export interface NodeToolCall {
  tool: string;
  inputJson?: unknown;
  outputJson?: unknown;
  timestamp?: string | number;
}

/** One visit to a graph node: the reasoning, tools, and transition it produced. */
export interface NodeVisit {
  id: string;
  index: number;
  nodeName: string;
  startTime: string | number;
  endTime: string | number;
  durationMs: number;
  /** LLM reasoning text emitted while this node executed. */
  reasoning: string[];
  /** Tool calls made by this node, with input/output payloads when logged. */
  toolCalls: NodeToolCall[];
  /** The node this visit handed off to, if a transition was logged. */
  transitionTo?: string;
  /** Per-node graph state slices (from the Object Store graph-state store). */
  stateEntries: Array<{ key: string; text: string }>;
  /** All log entries attributed to this visit, in order. */
  entries: LogEntry[];
  /** Short one-line preview for the timeline row. */
  summary: string;
}

/** Ordered node-graph view of a v2 task. */
export interface V2NodeTimeline {
  /** Inbound + discovery entries before the graph started executing. */
  preEntries: LogEntry[];
  visits: NodeVisit[];
  /** True when no graph-node logs were found (e.g. INSECURE-LOGGING disabled). */
  degraded: boolean;
  /**
   * Nodes the Object Store proves executed, whether or not logs described them.
   * This is a second, independent source of evidence: the broker persists an
   * `execution.runtime.node_executions` record per node it ran, so a task can be
   * known to have reached a node even with no graph-node logs at all. It carries
   * no order or timing — see {@link nodeExecutionsFromState}.
   */
  reachedFromState: string[];
}

/**
 * Node names the broker recorded as executed, read from persisted graph state.
 *
 * `execution.runtime.node_executions` is a dict keyed by node name whose values
 * are `NodeExecution` records. Every record carries a `node_execution_id` UUID,
 * which is long enough to survive state flattening, so a node that ran is
 * recoverable from the key path even when its other fields are dropped.
 *
 * Deliberately returns names only. The runtime's `NodeExecution` has no
 * timestamp, no duration and no sequence number, and the dict is merged across
 * turns by a reducer, so neither timing nor ordering can be honestly derived
 * from it — inferring a path from key order risks drawing a hop that execution
 * never took.
 */
export function nodeExecutionsFromState(story: TaskStory | undefined): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of story?.stateEntries ?? []) {
    const match = entry.key.match(/(?:^|\.)node_executions\.([^.[\]]+)/);
    const name = match?.[1]?.trim();
    if (name == null || name === "") continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

const NODE_START_TYPES = new Set(["GRAPH_NODE", "GRAPH_EXECUTION_START"]);
const TOOL_START_TYPES = new Set(["LLM_TOOL_SELECTION", "TOOL_EXECUTED"]);

function entryMessage(entry: LogEntry): string {
  return (entry.raw?.message as string) ?? entry.summary ?? "";
}

function toMs(ts: string | number | undefined): number {
  if (ts == null) return 0;
  if (typeof ts === "number") return ts;
  if (/^\d+$/.test(ts)) return parseInt(ts, 10);
  const parsed = new Date(ts).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Resolve the node name for a visit-starting entry. */
function nodeNameFor(entry: LogEntry): string | undefined {
  const fromField = entry.fields.graphNode?.trim();
  if (fromField) return fromField;
  const message = entryMessage(entry);
  const m =
    message.match(/Current node:\s*(\S+)/) ||
    message.match(/Starting vanilla node\s*(\S+)/) ||
    message.match(/Execution started \(turn_id[^)]*\)\s*(?:for node\s*(\S+))?/);
  return m?.[1]?.trim() || undefined;
}

function transitionTargetFor(entry: LogEntry): string | undefined {
  const message = entryMessage(entry);
  const m =
    message.match(/Transitioning to next (?:node|component):\s*(\S+)/) ||
    message.match(/Handoff to\s*(\S+)\s*enabled/) ||
    message.match(/after_reasoning: Handoff to\s*(\S+)/);
  return m?.[1]?.trim() || undefined;
}

function buildSummary(visit: NodeVisit): string {
  if (visit.reasoning.length > 0) {
    const first = visit.reasoning[0].replace(/\s+/g, " ").trim();
    return first.length > 120 ? `${first.slice(0, 120)}…` : first;
  }
  if (visit.toolCalls.length > 0) {
    return `Called ${visit.toolCalls.map((c) => c.tool).join(", ")}`;
  }
  if (visit.transitionTo) return `→ ${visit.transitionTo}`;
  return visit.entries[0]?.summary ?? visit.nodeName;
}

function attachStateEntries(visit: NodeVisit, story: TaskStory | undefined): void {
  if (!story?.stateEntries?.length) return;
  const needle = visit.nodeName.toLowerCase();
  for (const entry of story.stateEntries) {
    if (entry.key.toLowerCase().includes(needle)) {
      visit.stateEntries.push(entry);
    }
  }
}

/** Fold a log entry's reasoning / tool payloads into the current visit. */
function absorbEntry(visit: NodeVisit, entry: LogEntry): void {
  visit.entries.push(entry);

  const reasoning = entry.fields.llmReasoning?.trim();
  if (reasoning) {
    if (!visit.reasoning.includes(reasoning)) visit.reasoning.push(reasoning);
  } else if (entry.type === "LLM_REASONING") {
    const text = entryMessage(entry).replace(/^LLM Reasoning was:\s*/, "").split(" : trace_id")[0].trim();
    if (text && !visit.reasoning.includes(text)) visit.reasoning.push(text);
  } else if (entry.type === "LLM_RESPONSE") {
    // Some brokers emit the model's thinking as an LLM response rather than a
    // dedicated reasoning line — capture it so node detail isn't left empty.
    const text = entryMessage(entry).replace(/^Response output from OpenAI:\s*/, "").split(" : trace_id")[0].trim();
    if (text && !visit.reasoning.includes(text)) visit.reasoning.push(text);
  }

  const tool = entry.fields.tool?.trim();
  if (tool && TOOL_START_TYPES.has(entry.type)) {
    visit.toolCalls.push({ tool, timestamp: entry.timestamp });
  }
  if (entry.fields.toolInputJson !== undefined) {
    const call = visit.toolCalls[visit.toolCalls.length - 1];
    if (call && call.inputJson === undefined) call.inputJson = entry.fields.toolInputJson;
    else visit.toolCalls.push({ tool: tool || call?.tool || "tool", inputJson: entry.fields.toolInputJson, timestamp: entry.timestamp });
  }
  if (entry.fields.toolOutputJson !== undefined) {
    const call = visit.toolCalls[visit.toolCalls.length - 1];
    if (call && call.outputJson === undefined) call.outputJson = entry.fields.toolOutputJson;
    else visit.toolCalls.push({ tool: tool || call?.tool || "tool", outputJson: entry.fields.toolOutputJson, timestamp: entry.timestamp });
  }

  const target = transitionTargetFor(entry);
  if (target) visit.transitionTo = target;
}

function finalizeVisit(visit: NodeVisit, story: TaskStory | undefined): NodeVisit {
  const times = visit.entries.map((e) => toMs(e.timestamp)).filter((n) => n > 0);
  if (times.length > 0) {
    const start = Math.min(...times);
    const end = Math.max(...times);
    visit.startTime = visit.entries[0]?.timestamp ?? start;
    visit.endTime = visit.entries[visit.entries.length - 1]?.timestamp ?? end;
    visit.durationMs = Math.max(0, end - start);
  }
  attachStateEntries(visit, story);
  visit.summary = buildSummary(visit);
  return visit;
}

/**
 * Reconstruct the v2 node-graph execution timeline from parsed log entries.
 * `taskStory` (Object Store) is optional and only enriches per-node state.
 */
export function buildV2NodeTimeline(entries: LogEntry[], taskStory?: TaskStory): V2NodeTimeline {
  const preEntries: LogEntry[] = [];
  const visits: NodeVisit[] = [];
  let current: NodeVisit | null = null;

  const beginVisit = (entry: LogEntry, name: string): NodeVisit => {
    if (current) finalizeVisit(current, taskStory);
    const visit: NodeVisit = {
      id: `node-${visits.length}`,
      index: visits.length,
      nodeName: name,
      startTime: entry.timestamp,
      endTime: entry.timestamp,
      durationMs: 0,
      reasoning: [],
      toolCalls: [],
      stateEntries: [],
      entries: [],
      summary: "",
    };
    visits.push(visit);
    return visit;
  };

  for (const entry of entries) {
    const isNodeStart = NODE_START_TYPES.has(entry.type);
    const nodeName = nodeNameFor(entry);
    const changedNode =
      Boolean(nodeName) && current != null && nodeName !== current.nodeName && entry.fields.graphNode != null;

    if (isNodeStart || changedNode) {
      current = beginVisit(entry, nodeName || current?.transitionTo || `node ${visits.length + 1}`);
      absorbEntry(current, entry);
      continue;
    }

    if (!current) {
      preEntries.push(entry);
      continue;
    }
    absorbEntry(current, entry);
  }

  if (current) finalizeVisit(current, taskStory);

  return {
    preEntries,
    visits,
    degraded: visits.length === 0,
    reachedFromState: nodeExecutionsFromState(taskStory),
  };
}
