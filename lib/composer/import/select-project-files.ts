/**
 * Map the raw entries of an extracted agent-network project zip
 * (as returned by GET /api/exchange/extract-zip) to the three source files the
 * composer parser understands. Pure so it can be unit-tested without network.
 */

import type { ParseFilesInput } from "@/lib/composer/parse";

export interface ProjectZipEntry {
  filename: string;
  content: string;
}

function basename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/** Pick exchange.json, agent-network.yaml, and the (single, MVP) broker .agent. */
export function selectProjectSourceFiles(entries: ProjectZipEntry[]): ParseFilesInput {
  const valid = entries.filter((e) => typeof e.content === "string");

  const exchange = valid.find((e) => basename(e.filename).toLowerCase() === "exchange.json");

  const yamls = valid.filter((e) => /\.ya?ml$/i.test(e.filename));
  const agentYaml =
    yamls.find((e) => /agent-network\.ya?ml$/i.test(basename(e.filename))) ?? yamls[0];

  // Prefer an agent under brokers/, otherwise the first .agent file.
  const agents = valid.filter((e) => /\.agent$/i.test(e.filename));
  const brokerAgent =
    agents.find((e) => /(^|\/)brokers\//i.test(e.filename.replace(/\\/g, "/"))) ?? agents[0];

  return {
    ...(exchange ? { exchangeJson: exchange.content } : {}),
    ...(agentYaml ? { agentYaml: agentYaml.content } : {}),
    ...(brokerAgent ? { brokerAgent: brokerAgent.content } : {}),
  };
}
