/**
 * Human-readable labels for task iteration rows.
 * v1 uses LLM tool selection names; v2 graph runtime reuses generic internal tools
 * (e.g. IdentityAction) on distinct graph nodes — prefer node + phase there.
 */

export interface IterationLabelEntry {
  type?: string;
  fields?: Record<string, unknown>;
  raw?: { message?: string; [key: string]: unknown };
}

/** Internal graph-runtime tool names that are not useful alone as iteration labels. */
const GENERIC_GRAPH_TOOLS = new Set(["identityaction"]);

function stripToolPrefix(tool: string): string {
  return tool.replace(/^[a-zA-Z0-9]+_/, "");
}

function entryMessage(entry: IterationLabelEntry): string {
  return String(entry.raw?.message ?? "");
}

function toolExecutionPhase(entry: IterationLabelEntry): "execute" | "result" | null {
  const message = entryMessage(entry);
  if (/\] on_init: Tool .+ result received/.test(message)) return "result";
  if (/\] on_init: Action enabled, executing tool=/.test(message)) return "execute";
  return null;
}

function formatGraphIterationLabel(graphNode: string, phase: "execute" | "result" | null, tool: string): string {
  if (phase) return `${graphNode} · ${phase}`;
  if (tool && !GENERIC_GRAPH_TOOLS.has(tool.toLowerCase())) return `${graphNode} · ${tool}`;
  return graphNode;
}

/**
 * Derive the badge/heading label for one task iteration from its log entries.
 */
export function deriveIterationLabel(entries: IterationLabelEntry[]): string {
  const toolSelection = entries.find((e) => e.type === "LLM_TOOL_SELECTION");
  if (toolSelection?.fields?.tool) {
    return stripToolPrefix(String(toolSelection.fields.tool));
  }

  const toolExecution = entries.find((e) => e.type === "TOOL_EXECUTED");
  if (toolExecution) {
    const tool = toolExecution.fields?.tool ? stripToolPrefix(String(toolExecution.fields.tool)) : "";
    const graphNode = toolExecution.fields?.graphNode ? String(toolExecution.fields.graphNode) : "";
    const phase = toolExecutionPhase(toolExecution);

    if (graphNode) {
      return formatGraphIterationLabel(graphNode, phase, tool);
    }

    if (tool) return tool;
  }

  const graphTransition = entries.find((e) => e.type === "GRAPH_TRANSITION" && e.fields?.graphNode);
  if (graphTransition?.fields?.graphNode) {
    return String(graphTransition.fields.graphNode);
  }

  const graphNodeEntry = entries.find((e) => e.type === "GRAPH_NODE" && e.fields?.graphNode);
  if (graphNodeEntry?.fields?.graphNode) {
    return String(graphNodeEntry.fields.graphNode);
  }

  return "unknown";
}
