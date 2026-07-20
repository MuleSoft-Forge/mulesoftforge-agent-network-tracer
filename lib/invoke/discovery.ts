import type { AgentCard, AgentSkill } from "./types";

/**
 * Fetch the agent card for a given broker URL via the server-side proxy
 * (handles CORS, tries 14+ well-known paths, caches the result).
 */
export async function fetchAgentCard(
  brokerUrl: string,
  opts: { bustCache?: boolean; a2aVersion?: string } = {}
): Promise<AgentCard | null> {
  const params = new URLSearchParams({ url: brokerUrl });
  if (opts.bustCache) params.set("refresh", "1");
  if (opts.a2aVersion) params.set("a2aVersion", opts.a2aVersion);
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

const PLACEHOLDER_SKILL_DESCRIPTION =
  /^provide a description for this skill\b/i;

export function isPlaceholderSkillDescription(text: string | undefined): boolean {
  return typeof text === "string" && PLACEHOLDER_SKILL_DESCRIPTION.test(text.trim());
}

function promptFromSkillName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Help me with this task.";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function skillPromptText(skill: AgentSkill): string {
  const example = skill.examples
    ?.map((value) => value.trim())
    .find((value) => value.length > 0);
  if (example) return example;

  const description = skill.description?.trim();
  if (description && !isPlaceholderSkillDescription(description)) {
    return description;
  }

  return promptFromSkillName(skill.name);
}
