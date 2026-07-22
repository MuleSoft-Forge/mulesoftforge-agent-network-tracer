import { getParser, init } from "@sf-agentscript/agentforce/browser";
import { parseAndLint } from "@sf-agentscript/language";
import { agentfabricDialect, getGraph, type Graph } from "@sf-agentscript/agentfabric-dialect";

let parserReady = false;
let parserInit: Promise<void> | null = null;

async function ensureParser(): Promise<void> {
  if (parserReady) return;
  if (!parserInit) {
    parserInit = init().then(() => {
      parserReady = true;
    });
  }
  await parserInit;
}

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
    await ensureParser();
    const parser = getParser();
    const tree = parser.parse(source);
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
