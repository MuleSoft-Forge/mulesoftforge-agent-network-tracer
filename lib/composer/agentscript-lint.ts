import { parseAndLint, type Diagnostic } from "@sf-agentscript/language";
import { agentfabricDialect } from "@sf-agentscript/agentfabric-dialect";
import { parseAgentFabricSource } from "@/lib/composer/agentscript-parser";

/** Parse and lint AgentFabric `.agent` source (AgentFabric dialect). */
export async function lintAgentFabricSource(source: string): Promise<Diagnostic[]> {
  const tree = await parseAgentFabricSource(source);
  const result = parseAndLint(tree.rootNode, agentfabricDialect);
  return result.diagnostics;
}
