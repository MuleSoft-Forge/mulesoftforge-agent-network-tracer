/**
 * Map the raw entries of an extracted agent-network project zip
 * (as returned by GET /api/exchange/extract-zip) to the three source files the
 * composer parser understands. Pure so it can be unit-tested without network.
 */

import type { ParseFilesInput } from "@/lib/composer/parse";
import { parseAgentNetworkYaml } from "@/lib/composer/parse/agent-network-yaml";

export interface ProjectZipEntry {
  filename: string;
  content: string;
}

function basename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function normalizePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        throw new Error(`Project path escapes its archive root: ${JSON.stringify(path)}`);
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

/** Pick exchange.json, agent-network.yaml, and its explicitly selected broker implementation. */
export function selectProjectSourceFiles(entries: ProjectZipEntry[]): ParseFilesInput {
  const valid = entries.filter((e) => typeof e.content === "string");

  const exchange = valid.find((e) => basename(e.filename).toLowerCase() === "exchange.json");

  const yamls = valid.filter((e) => /\.ya?ml$/i.test(e.filename));
  const agentYaml =
    yamls.find((e) => /agent-network\.ya?ml$/i.test(basename(e.filename))) ?? yamls[0];

  const agents = valid.filter((e) => /\.agent$/i.test(e.filename));
  let brokerAgent: ProjectZipEntry | undefined;
  if (agentYaml) {
    const implementation = parseAgentNetworkYaml(agentYaml.content).broker?.implementation;
    if (implementation) {
      const implementationPath = normalizePath(
        [dirname(agentYaml.filename), implementation].filter(Boolean).join("/")
      );
      brokerAgent = agents.find((entry) => normalizePath(entry.filename) === implementationPath);
      if (!brokerAgent) {
        throw new Error(
          `Broker implementation ${JSON.stringify(implementation)} does not match any .agent file in the project.`
        );
      }
    }
  }
  if (!brokerAgent && agents.length === 1) {
    brokerAgent = agents[0];
  }
  if (!brokerAgent && agents.length > 1) {
    throw new Error(
      `Project contains ${agents.length} .agent files but agent-network.yaml does not select one unambiguously.`
    );
  }
  if (brokerAgent && agents.length > 1) {
    const discarded = agents
      .filter((entry) => entry !== brokerAgent)
      .map((entry) => entry.filename)
      .join(", ");
    throw new Error(
      `Builder import supports one .agent implementation; refusing to discard: ${discarded}.`
    );
  }

  return {
    ...(exchange ? { exchangeJson: exchange.content } : {}),
    ...(agentYaml ? { agentYaml: agentYaml.content } : {}),
    ...(brokerAgent ? { brokerAgent: brokerAgent.content } : {}),
  };
}
