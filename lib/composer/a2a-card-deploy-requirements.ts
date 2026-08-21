/**
 * Agent Graph deploy-time requirements for brokers.*.interfaces.a2a.card.
 *
 * Build/publish JSON Schema (a2a_v1 Agent Card) treats some fields as optional,
 * but runtime validation (Pydantic `A2ACard` in agent-graph-module) requires them
 * and fails startup when omitted from agent-network.yaml.
 */

import type { BrokerCard } from "@/lib/composer/model";
import type { SchemaIssue } from "@/lib/composer/schema/network-schema";

/** Validate fields required at deploy but optional in the bundled Agent Card schema. */
export function validateBrokerCardDeployRequirements(card: BrokerCard): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (!card.description?.trim()) {
    issues.push({
      path: "description",
      message: 'missing required property "description" (required at deploy)',
    });
  }
  return issues;
}
