/**
 * Maps JSON-schema validator paths (agent-network.yaml) to a structured
 * IssueLocation. This is the ONLY place schema paths are parsed — it runs once
 * at issue-emit time inside validateProject, so downstream surfaces never parse
 * message text.
 */

import type { IssueLocation, RegistryYamlFocus } from "@/lib/composer/validation/issue";

/** Parse registry entity key (and optional card field) from agent-network.yaml schema paths. */
export function parseRegistryYamlPath(path: string, message: string): RegistryYamlFocus | null {
  const match = path.match(/^registry\.(agents|mcps|llms)\.([^.]+)/);
  if (!match) return null;

  const kind = match[1] as RegistryYamlFocus["kind"];
  const key = match[2];
  let anchor: string | undefined;

  if (message.includes('"protocolVersion"') || path.includes(".protocolVersion") || path.endsWith(".protocolVersion")) {
    anchor = "registry-agent-card-protocol-version";
  } else if (message.includes('"url"') || path.includes(".card.url") || path.endsWith(".url")) {
    anchor = "registry-agent-card-url";
  } else if (path.includes(".interfaces.")) {
    anchor = "registry-agent-card";
  }

  return { kind, key, anchor };
}

export function yamlPathToLocation(path: string, message: string): IssueLocation {
  const registry = parseRegistryYamlPath(path, message);
  if (registry) {
    return { tab: "registry", registry, fieldAnchor: registry.anchor };
  }

  const normalized = path.replace(/^\//, "").replace(/\//g, ".");
  if (normalized.includes("interfaces.a2a.policies")) return { tab: "access" };
  if (normalized.includes("interfaces.a2a.card")) return { tab: "a2a-card" };
  if (normalized.startsWith("context.connections") || normalized.includes(".connections.")) return { tab: "assets" };
  if (normalized.startsWith("info")) return { tab: "identity" };
  if (normalized.startsWith("brokers")) return { tab: "a2a-card" };
  return { tab: "identity" };
}
