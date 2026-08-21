import type { CanonicalGraph, CanonicalNode, CanonicalEdge } from "@/lib/agent-network-types";
import type { AgentCard, AgentSkill } from "./types";

export function brokerNameFromUrl(url: string): string {
  try {
    const { pathname, hostname } = new URL(url);
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length > 0) {
      return segments[segments.length - 1]
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
    return hostname.split(".")[0]
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  } catch {
    return "Broker";
  }
}

export function skillToAgentLabel(skillName: string): string {
  return skillName
    .replace(/\bskill\b/gi, "")
    .trim()
    .replace(/\s{2,}/g, " ");
}

export function isSearchSkill(name: string): boolean {
  return /search|google|web|mcp|lookup|browse/i.test(name);
}

export const INVOKE_BROKER_ID = "invoke-broker";

export function skillNodeId(skill: AgentSkill, idx: number): string {
  return `invoke-skill-${skill.id ?? idx}`;
}

/**
 * Build a synthetic CanonicalGraph from an agent card when no platform-derived
 * graph is available. Matches the broker app's User → Broker → Skill layout but
 * in CanonicalGraph format so the existing SVG canvas renders it without changes.
 */
export function buildInvokeGraph(
  agentCard: AgentCard | null,
  brokerUrl: string
): CanonicalGraph {
  const brokerName = agentCard?.name ?? brokerNameFromUrl(brokerUrl);
  const skills: AgentSkill[] = agentCard?.skills ?? [];

  const brokerNode: CanonicalNode = {
    id: INVOKE_BROKER_ID,
    label: brokerName,
    type: "BROKER",
    version: agentCard?.version ?? "1.0",
    organizationId: "",
    position: { x: 0, y: 0 },
  };

  const skillNodes: CanonicalNode[] = skills.map((skill, i) => ({
    id: skillNodeId(skill, i),
    label: skillToAgentLabel(skill.name),
    type: isSearchSkill(skill.name) ? "MCP" : "AGENT",
    version: "1.0",
    organizationId: "",
    position: { x: 0, y: 0 },
    exchangeAssetId: skill.description,
  }));

  const edges: CanonicalEdge[] = skillNodes.map((n) => ({
    id: `invoke-edge-${INVOKE_BROKER_ID}-${n.id}`,
    source: INVOKE_BROKER_ID,
    target: n.id,
  }));

  return {
    nodes: [brokerNode, ...skillNodes],
    edges,
    mode: "design",
  };
}

/** Return the first BROKER node ID in graph, or undefined. */
export function findBrokerNodeId(graph: CanonicalGraph): string | undefined {
  return graph.nodes.find((n) => n.type === "BROKER")?.id;
}
