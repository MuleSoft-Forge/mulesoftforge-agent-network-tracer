import type { AgentCard, AgentSkill, InvokeAuthConfig } from "./types";
import { normalizeStringArray } from "@/lib/composer/a2a-card";

/**
 * Fetch the agent card for a given broker URL via the server-side proxy
 * (handles CORS, tries 14+ well-known paths, caches the result).
 */
export async function fetchAgentCard(
  brokerUrl: string,
  opts: { bustCache?: boolean; a2aVersion?: string; auth?: InvokeAuthConfig } = {}
): Promise<AgentCard | null> {
  const auth = opts.auth;
  const shouldUsePost = auth && auth.type !== "none";
  try {
    const res = shouldUsePost
      ? await fetch("/api/invoke/agent-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: brokerUrl,
            refresh: Boolean(opts.bustCache),
            a2aVersion: opts.a2aVersion,
            auth,
          }),
        })
      : await fetch(
          `/api/invoke/agent-card?${new URLSearchParams({
            url: brokerUrl,
            ...(opts.bustCache ? { refresh: "1" } : {}),
            ...(opts.a2aVersion ? { a2aVersion: opts.a2aVersion } : {}),
          }).toString()}`
        );
    if (!res.ok) return null;
    return (await res.json()) as AgentCard;
  } catch {
    return null;
  }
}

export function getSkills(agentCard: AgentCard | null): AgentSkill[] {
  const raw = agentCard?.skills ?? [];
  return raw
    .map((skill): AgentSkill | null => {
      if (!skill || typeof skill !== "object") return null;
      const s = skill as AgentSkill;
      if (typeof s.id !== "string" || typeof s.name !== "string") return null;
      const examples = normalizeSkillExamples(s.examples, s.id, s.name);
      const tags = normalizeStringArray(s.tags);
      return {
        id: s.id,
        name: s.name,
        ...(typeof s.description === "string" ? { description: s.description } : {}),
        ...(tags ? { tags } : {}),
        ...(examples ? { examples } : {}),
      };
    })
    .filter((skill): skill is AgentSkill => skill !== null);
}

function normalizeSkillExamples(
  value: unknown,
  _skillId: string,
  _skillName: string
): string[] | undefined {
  const normalized = normalizeStringArray(value);
  if (normalized && normalized.length > 0) return normalized;

  // Some cards provide examples as structured objects instead of string[].
  if (Array.isArray(value)) {
    const extracted = value.flatMap(extractExampleTexts).filter((v): v is string => Boolean(v));
    if (extracted.length > 0) return [...new Set(extracted)];
  }
  return undefined;
}

function extractExampleTexts(entry: unknown): string[] {
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!entry || typeof entry !== "object") return [];

  const obj = entry as Record<string, unknown>;
  const directKeys = [
    "text",
    "example",
    "examples",
    "prompt",
    "query",
    "input",
    "message",
    "content",
    "value",
  ];

  for (const key of directKeys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) return [val.trim()];
    const normalized = normalizeStringArray(val);
    if (normalized?.length) return normalized;
  }

  const parts = obj.parts;
  if (Array.isArray(parts)) {
    const fromParts = parts.flatMap((part) => extractExampleTexts(part));
    if (fromParts.length > 0) return fromParts;
  }

  // Last resort: shallow object walk for fields that look like prompt/example text.
  const results: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (!/(example|prompt|query|input|text|message)/i.test(key)) continue;
    if (typeof val === "string" && val.trim()) results.push(val.trim());
    else if (Array.isArray(val)) results.push(...val.flatMap((item) => extractExampleTexts(item)));
    else if (val && typeof val === "object") results.push(...extractExampleTexts(val));
  }
  return results;
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
