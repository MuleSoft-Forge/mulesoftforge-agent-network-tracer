import type { AgentCard, AgentSkill } from "./types";

/**
 * Fetch the agent card for a given broker URL via the server-side proxy
 * (handles CORS, tries 14+ well-known paths, caches the result).
 */
export async function fetchAgentCard(
  brokerUrl: string,
  opts: { bustCache?: boolean } = {}
): Promise<AgentCard | null> {
  const params = new URLSearchParams({ url: brokerUrl });
  if (opts.bustCache) params.set("refresh", "1");
  try {
    const res = await fetch(`/api/invoke/agent-card?${params}`);
    if (!res.ok) return null;
    return (await res.json()) as AgentCard;
  } catch {
    return null;
  }
}

export function getSkills(agentCard: AgentCard | null): AgentSkill[] {
  return agentCard?.skills ?? [];
}

export function skillPromptText(
  skill: AgentSkill
): string {
  if (skill.examples && skill.examples.length > 0) return skill.examples[0];
  return skill.description ?? skill.name;
}
