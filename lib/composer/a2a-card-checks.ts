/**
 * Live-validation helper for the A2A card editor. Splits results into schema
 * errors (from the a2a_v1 Agent Card schema), recommendation warnings, and a
 * checklist of satisfied recommendations — mirroring the summary shown by
 * public Agent Card generators (N errors, N warnings, N passed).
 */

import type { BrokerCard } from "@/lib/composer/model";
import { serializeBrokerCard } from "@/lib/composer/a2a-card";
import { validateBrokerCardDoc } from "@/lib/composer/schema/a2a-card-schema";

export interface A2aCardEvaluation {
  errors: string[];
  warnings: string[];
  passed: string[];
}

interface RecommendationCheck {
  label: string;
  ok: boolean;
}

/** Evaluate an A2A card into schema errors + a recommendation checklist. */
export function evaluateA2aCard(card: BrokerCard): A2aCardEvaluation {
  const doc = serializeBrokerCard(card);
  const errors = validateBrokerCardDoc(doc).map((s) => `${s.path}: ${s.message}`);

  const interfaces = card.supportedInterfaces ?? [];
  const primary = interfaces[0];
  const provider = card.provider ?? {};
  const skills = card.skills ?? [];
  const primarySkill = skills[0];
  const endpointUrl = primary?.url?.trim() ?? "";

  const checks: RecommendationCheck[] = [
    { label: "Description is set", ok: Boolean(card.description?.trim()) },
    { label: "A2A endpoint URL is set", ok: endpointUrl.length > 0 },
    { label: "Endpoint uses HTTPS", ok: endpointUrl.startsWith("https://") },
    { label: "Protocol binding is declared", ok: Boolean(primary?.protocolBinding) },
    { label: "Protocol version is declared", ok: Boolean(primary?.protocolVersion?.trim()) },
    { label: "Provider organization is set", ok: Boolean(provider.organization?.trim()) },
    { label: "Provider URL is set", ok: Boolean(provider.url?.trim()) },
    { label: "Default input modes are set", ok: (card.defaultInputModes?.length ?? 0) > 0 },
    { label: "Default output modes are set", ok: (card.defaultOutputModes?.length ?? 0) > 0 },
    { label: "At least one skill is defined", ok: skills.length > 0 },
    { label: "Primary skill has tags", ok: (primarySkill?.tags?.length ?? 0) > 0 },
  ];

  return {
    errors,
    warnings: checks.filter((c) => !c.ok).map((c) => c.label),
    passed: checks.filter((c) => c.ok).map((c) => c.label),
  };
}
