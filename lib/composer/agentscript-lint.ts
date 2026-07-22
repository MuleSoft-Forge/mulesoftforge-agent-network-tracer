import { getParser, init } from "@sf-agentscript/agentforce/browser";
import { parseAndLint, type Diagnostic } from "@sf-agentscript/language";
import { agentfabricDialect } from "@sf-agentscript/agentfabric-dialect";

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

/** Parse and lint AgentFabric `.agent` source (AgentFabric dialect). */
export async function lintAgentFabricSource(source: string): Promise<Diagnostic[]> {
  await ensureParser();
  const parser = getParser();
  const tree = parser.parse(source);
  const result = parseAndLint(tree.rootNode, agentfabricDialect);
  return result.diagnostics;
}
