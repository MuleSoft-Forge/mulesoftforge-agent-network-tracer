import { parseAndLint } from "@sf-agentscript/language";
import { agentfabricDialect, getGraph, type Graph } from "@sf-agentscript/agentfabric-dialect";
import { parseAgentFabricSource } from "@/lib/composer/agentscript-parser";

export interface AgentFabricGraphResult {
  graph: Graph | null;
  parseErrors: string[];
}

/** Extract the official AgentFabric protocol graph from `.agent` source text. */
export async function extractAgentFabricGraph(source: string): Promise<AgentFabricGraphResult> {
  if (!source.trim()) {
    return { graph: { nodes: [], edges: [] }, parseErrors: [] };
  }

  try {
    const tree = await parseAgentFabricSource(source);
    const result = parseAndLint(tree.rootNode, agentfabricDialect);
    const errors = result.diagnostics
      .filter((d) => d.severity === 1)
      .map((d) => d.message);
    if (errors.length > 0 && result.ast == null) {
      return { graph: null, parseErrors: errors };
    }
    return { graph: getGraph(result.ast), parseErrors: errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { graph: null, parseErrors: [message] };
  }
}
