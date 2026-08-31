/**
 * Broker map keys in agent-network.yaml (brokers.{key}) and config.agent_name.
 */

import {
  ANF_ID_HINT,
  ANF_ID_PATTERN,
  anfIdValidationMessage,
  coerceAnfId,
  isValidAnfId,
  normalizeAnfId,
} from "@/lib/composer/anf-id";

export const BROKER_KEY_PATTERN = ANF_ID_PATTERN;
export const BROKER_KEY_HINT = ANF_ID_HINT;

export function isValidBrokerKey(key: string): boolean {
  return isValidAnfId(key);
}

export function brokerKeyValidationMessage(key: string): string {
  return anfIdValidationMessage(key, "Broker ID");
}

export function normalizeBrokerKey(input: string, fallback = "broker"): string {
  return normalizeAnfId(input, fallback);
}

/** Keep an already-valid broker key verbatim; otherwise canonicalize it. */
export function coerceBrokerKey(input: string, fallback = "broker"): string {
  return coerceAnfId(input, fallback);
}
