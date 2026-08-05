/**
 * Produces A2A card issues from a single place: schema validation (with the
 * policy-derived security applied, matching deploy) and deploy requirements.
 * Every issue carries the card field anchor so the strip, tab badge, right rail,
 * and field ring all agree.
 */

import type { Broker, ComposerProject } from "@/lib/composer/model";
import { serializeBrokerCard } from "@/lib/composer/a2a-card";
import { deriveA2aCardSecurityFromInterfacePolicies } from "@/lib/composer/a2a-card-security-from-policies";
import { validateBrokerCardDoc } from "@/lib/composer/schema/a2a-card-schema";
import { validateBrokerCardDeployRequirements } from "@/lib/composer/a2a-card-deploy-requirements";
import { buildA2aCardCompleteness } from "@/lib/composer/a2a-card-completeness";
import type { A2aCardCompletenessItem } from "@/lib/composer/a2a-card-completeness";
import type { ValidationIssue } from "@/lib/composer/validation/issue";

/** Match a schema/deploy path to the field anchor whose jsonPath it belongs to. */
function anchorForCardPath(path: string, items: A2aCardCompletenessItem[]): string | undefined {
  if (path === "(root)") return undefined;
  // Longest jsonPath match wins so e.g. "supportedInterfaces[0].url" beats "supportedInterfaces".
  let best: { anchor: string; len: number } | undefined;
  for (const item of items) {
    const jp = item.jsonPath;
    if (path === jp || path.startsWith(`${jp}.`) || path.startsWith(`${jp}[`) || jp.startsWith(`${path}.`)) {
      if (!best || jp.length > best.len) best = { anchor: item.anchor, len: jp.length };
    }
  }
  return best?.anchor;
}

/**
 * Emits the card's hard errors (schema + deploy) with field anchors. Tier-based
 * recommended/optional completeness stays right-rail guidance rather than
 * flooding the counted stream, matching the pre-unification export semantics.
 */
export function a2aCardIssues(broker: Broker, project: ComposerProject): ValidationIssue[] {
  const card = broker.card;
  const issues: ValidationIssue[] = [];
  const anchorsWithHardErrors = new Set<string>();

  const items = buildA2aCardCompleteness(card).groups.flatMap((g) => g.items);

  // Schema is validated with the policy-derived security applied, exactly as at
  // deploy time — this is what catches apiKeySecurityScheme shape errors.
  const derivedSecurity = deriveA2aCardSecurityFromInterfacePolicies(broker, project) ?? null;
  for (const s of validateBrokerCardDoc(serializeBrokerCard(card, derivedSecurity))) {
    const anchor = anchorForCardPath(s.path, items);
    if (anchor) anchorsWithHardErrors.add(anchor);
    issues.push({
      code: "a2a-card.schema",
      severity: "error",
      message: `Schema (A2A card) at ${s.path}: ${s.message}`,
      location: { tab: "a2a-card", fieldAnchor: anchor },
      origin: "schema",
    });
  }

  for (const s of validateBrokerCardDeployRequirements(card)) {
    const anchor = anchorForCardPath(s.path, items);
    if (anchor) anchorsWithHardErrors.add(anchor);
    issues.push({
      code: "a2a-card.deploy",
      severity: "error",
      message: `Deploy (A2A card) at ${s.path}: ${s.message}`,
      location: { tab: "a2a-card", fieldAnchor: anchor },
      origin: "schema",
    });
  }

  // Keep counts and right-rail status aligned: required missing card fields are
  // first-class validation errors, unless already represented by schema/deploy.
  for (const item of items) {
    if (item.tier !== "required") continue;
    if (item.status === "set") continue;
    if (anchorsWithHardErrors.has(item.anchor)) continue;
    issues.push({
      code: `a2a-card.required.${item.id}`,
      severity: "error",
      message: `A2A card required field "${item.label}" is not set.`,
      location: { tab: "a2a-card", fieldAnchor: item.anchor },
      tier: "required",
      origin: "completeness",
    });
  }

  return issues;
}
