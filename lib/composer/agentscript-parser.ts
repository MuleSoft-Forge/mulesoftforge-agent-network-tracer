import { getParser, init } from "@sf-agentscript/agentforce/browser";

let parserReady = false;
let parserInit: Promise<void> | null = null;

/** Ensure the tree-sitter parser is initialized (idempotent, shared). */
export async function ensureAgentFabricParser(): Promise<void> {
  if (parserReady) return;
  if (!parserInit) {
    parserInit = init()
      .then(() => {
        parserReady = true;
      })
      .catch((error: unknown) => {
        parserInit = null;
        throw error;
      });
  }
  await parserInit;
}

/** Parse AgentFabric source into a tree-sitter CST (parser must be ready). */
export async function parseAgentFabricSource(source: string) {
  await ensureAgentFabricParser();
  return getParser().parse(source);
}
