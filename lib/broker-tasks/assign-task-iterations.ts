/**
 * v1 broker logs tag `iteration=N` on Loop / INSECURE-LOGGING lines.
 * v2 AgentScript graph runtime logs do not — they use turn_id and tool execution
 * events instead. This module synthesizes iteration numbers for the task UI.
 */

export interface IterationAssignableEntry {
  type?: string;
  logger?: string;
  fields?: Record<string, unknown>;
  raw?: { message?: string; [key: string]: unknown };
  summary?: string;
}

const BOUNDARY_TYPES = new Set(["LLM_TOOL_SELECTION", "TOOL_EXECUTED"]);

function entryMessage(entry: IterationAssignableEntry): string {
  return ((entry.raw?.message as string) ?? entry.summary ?? "") as string;
}

function hasTaggedV1Iterations(entries: IterationAssignableEntry[]): boolean {
  return entries.some((entry) => {
    const raw = entry.fields?.iteration;
    if (raw == null || raw === "" || raw === "0") return false;
    const n = parseInt(String(raw), 10);
    return Number.isFinite(n) && n > 0;
  });
}

function isBrokerScopedEntry(entry: IterationAssignableEntry): boolean {
  const type = entry.type ?? "";
  if (type === "GATEWAY") return false;
  if (
    type === "INBOUND_REQUEST" ||
    type === "FINAL_RESPONSE" ||
    type === "LLM_TOOL_SELECTION" ||
    type === "LLM_NO_TOOL" ||
    type === "LLM_REASONING" ||
    type === "LLM_REQUEST" ||
    type === "LLM_RESPONSE" ||
    type === "TOOL_EXECUTED" ||
    type === "TOOL_INPUT" ||
    type === "TOOL_OUTPUT" ||
    type === "A2A_MESSAGE_SENT" ||
    type === "DOWNSTREAM_REQUEST" ||
    type === "DOWNSTREAM_RESPONSE" ||
    type === "AGENT_DISCOVERY" ||
    type.startsWith("GRAPH_")
  ) {
    return true;
  }
  const logger = entry.logger ?? "";
  if (
    logger === "Loop" ||
    logger === "INSECURE-LOGGING" ||
    logger === "http-listener-config" ||
    logger.includes("a2a-http-client") ||
    logger.includes("module_graph_runtime")
  ) {
    return true;
  }
  return /\[agent_[^\]]+\]|Graph execution|module_graph_runtime|executing tool=/i.test(entryMessage(entry));
}

function setIteration(entry: IterationAssignableEntry, iteration: string): void {
  entry.fields = { ...(entry.fields ?? {}), iteration };
}

/**
 * Assign `fields.iteration` on v2 graph entries when v1-style tags are absent.
 * Idempotent for entries that already carry iteration=N.
 */
export function assignTaskIterations(entries: IterationAssignableEntry[]): void {
  if (entries.length === 0 || hasTaggedV1Iterations(entries)) return;

  const boundaryIndices: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (BOUNDARY_TYPES.has(entries[i].type ?? "")) {
      boundaryIndices.push(i);
    }
  }

  if (boundaryIndices.length === 0) {
    const brokerEntries = entries.filter(isBrokerScopedEntry);
    if (brokerEntries.length === 0) return;
    for (const entry of brokerEntries) {
      if (!entry.fields?.iteration) setIteration(entry, "1");
    }
    return;
  }

  for (let b = 0; b < boundaryIndices.length; b++) {
    const iteration = String(b + 1);
    const start = b === 0 ? 0 : boundaryIndices[b - 1]! + 1;
    const end = boundaryIndices[b]!;
    for (let i = start; i <= end; i++) {
      if (!entries[i].fields?.iteration) {
        setIteration(entries[i], iteration);
      }
    }
  }

  const lastIteration = String(boundaryIndices.length);
  const tailStart = boundaryIndices[boundaryIndices.length - 1]! + 1;
  for (let i = tailStart; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.fields?.iteration && isBrokerScopedEntry(entry)) {
      setIteration(entry, lastIteration);
    }
  }
}

export function deriveMaxIteration(entries: IterationAssignableEntry[]): number {
  const fromFields = entries
    .map((entry) => {
      const iterStr = entry.fields?.iteration;
      return iterStr ? parseInt(String(iterStr), 10) : 0;
    })
    .filter((n) => Number.isFinite(n) && n > 0);

  const fromBoundaries = entries.filter((entry) => BOUNDARY_TYPES.has(entry.type ?? "")).length;

  return Math.max(1, ...fromFields, fromBoundaries);
}

export function collectToolNames(entries: IterationAssignableEntry[]): string[] {
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "LLM_TOOL_SELECTION" && entry.type !== "TOOL_EXECUTED") continue;
    const tool = entry.fields?.tool;
    if (typeof tool === "string" && tool.length > 0) {
      names.add(tool.replace(/^[a-zA-Z0-9]+_/, ""));
    }
  }
  return Array.from(names);
}
