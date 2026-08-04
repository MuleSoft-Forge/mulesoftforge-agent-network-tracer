/**
 * Single source of truth for which official schemas Composer bundles.
 * Used by the sync script (copy + manifest) and runtime catalog (validate + UI).
 */

export interface AnfBundleFileConfig {
  filename: string;
  description: string;
  /** Root schema for agent-network.yaml validation. Exactly one must be marked. */
  isRoot?: boolean;
}

export const ANF_BUNDLE_SOURCE = {
  repository: "agent-fabric-specification",
  remoteUrl: "https://github.com/mulesoft-emu/agent-fabric-specification.git",
  subpath: "agent-fabric-schema/src/main/resources",
} as const;

/** Spec version enforced by the root schema's agentNetwork const. */
export const ANF_SPEC_VERSION = "2.0.0";

export const ANF_BUNDLE_FILE_CONFIG: AnfBundleFileConfig[] = [
  {
    filename: "agent_network_v2.json",
    description: "Root schema for agent-network.yaml (agentNetwork: 2.0.0).",
    isRoot: true,
  },
  {
    filename: "references.json",
    description: "AgentRef, MCPRef, LLMRef, PolicyRef, ConnectionRef.",
  },
  {
    filename: "agent_metadata.json",
    description: "Registry agent definitions and platform metadata.",
  },
  {
    filename: "mcp_metadata.json",
    description: "Registry MCP server definitions.",
  },
  {
    filename: "a2a.json",
    description: "A2A agent card and protocol types.",
  },
  {
    filename: "a2a_v1.json",
    description: "A2A v1 agent card (brokers.interfaces.a2a.card).",
  },
  {
    filename: "other_card.json",
    description: "Non-A2A interface card shape.",
  },
  {
    filename: "metadata_provenance.json",
    description: "Provenance information for resources.",
  },
];

export const ANF_BUNDLE_FILENAMES = ANF_BUNDLE_FILE_CONFIG.map((f) => f.filename);
