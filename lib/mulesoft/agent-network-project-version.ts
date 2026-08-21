/** Agent network *project* schema generation (v1 YAML vs v2 YAML), not Exchange REST API version. */
export type AgentNetworkProjectVersion = "v1" | "v2" | "unknown";

export function detectProjectVersionFromZipClassifier(
  classifier: string | null | undefined
): AgentNetworkProjectVersion | null {
  switch (classifier) {
    case "agent-network":
      return "v1";
    case "agentic-network":
      return "v2";
    case "broker-group":
      return "v1";
    default:
      return null;
  }
}

export function detectProjectVersionFromYaml(
  content: string | null | undefined
): AgentNetworkProjectVersion | null {
  if (!content) return null;
  if (/^\s*agentNetwork\s*:\s*2(?:\.0\.0)?/m.test(content)) return "v2";
  if (/^\s*schemaVersion\s*:\s*1(?:\.0\.0)?/m.test(content)) return "v1";
  if (/^\s*registry\s*:/m.test(content) && /^\s*context\s*:/m.test(content)) return "v2";
  if (/^\s*brokers\s*:/m.test(content) && /^\s*connections\s*:/m.test(content)) return "v1";
  return null;
}

export function detectProjectVersion(input: {
  zipClassifier?: string | null;
  yamlContent?: string | null;
}): AgentNetworkProjectVersion {
  const fromZip = detectProjectVersionFromZipClassifier(input.zipClassifier);
  const fromYaml = detectProjectVersionFromYaml(input.yamlContent);
  if (fromZip && fromYaml && fromZip !== fromYaml) {
    return fromYaml;
  }
  return fromYaml ?? fromZip ?? "unknown";
}

export function projectVersionLabel(version: AgentNetworkProjectVersion): string {
  switch (version) {
    case "v1":
      return "Agent network v1";
    case "v2":
      return "Agent network v2";
    case "unknown":
      return "Agent network";
    default: {
      const _exhaustive: never = version;
      return _exhaustive;
    }
  }
}
