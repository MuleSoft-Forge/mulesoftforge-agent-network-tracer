import type { JobCard, LogEntry } from "@/components/task-details/types";

/**
 * Broker runtime format.
 * - `v1`: legacy Java ReAct loop broker (`com.mulesoft.modules.agent.broker`). EOL
 *   but still deployed; the tracer keeps its iteration/step view frozen.
 * - `v2`: AgentScript node-graph runtime (`module_graph_runtime`). Evolving; gets
 *   the native node-timeline + decoded Task story presentation.
 */
export type BrokerFormat = "v1" | "v2";

const V2_LOGGER_HINTS = ["module_graph_runtime", "graph_runtime", "agentscript"];
const V2_ENTRY_TYPES = new Set([
  "GRAPH_NODE",
  "GRAPH_EXECUTION_START",
  "GRAPH_TRANSITION",
  "GRAPH_EXECUTION_END",
]);

/**
 * Detect the broker format for a task from the data the client already holds.
 *
 * Order of precedence:
 * 1. Object Store probe result (authoritative — the store layout differs by format).
 * 2. Graph-runtime log signals (entry types / logger names).
 * 3. Default to `v1` (safe: the frozen view handles any broker).
 */
export function detectBrokerFormat(jobCard: JobCard | undefined, entries: LogEntry[]): BrokerFormat {
  const probed = jobCard?.objectStore?.debug?.tasks?.brokerFormat;
  if (probed === "v1" || probed === "v2") return probed;

  for (const entry of entries) {
    if (V2_ENTRY_TYPES.has(entry.type)) return "v2";
    const logger = entry.logger?.toLowerCase() ?? "";
    if (V2_LOGGER_HINTS.some((hint) => logger.includes(hint))) return "v2";
  }

  return "v1";
}
