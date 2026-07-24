/**
 * Broker map keys in agent-network.yaml (brokers.{key}) and config.agent_name.
 * Lowercase letters, digits, underscores — no trailing underscore.
 */

/** e.g. customer_service_agent, billing_agent, agent2 */
export const BROKER_KEY_PATTERN = /^[a-z0-9]+(_[a-z0-9]+)*$/;

export const BROKER_KEY_HINT =
  "Lowercase letters, digits, and underscores only. No trailing underscore (e.g. customer_service_agent).";

export function isValidBrokerKey(key: string): boolean {
  return BROKER_KEY_PATTERN.test(key);
}

export function brokerKeyValidationMessage(key: string): string {
  if (!key.trim()) return "Broker key is required.";
  if (/[A-Z]/.test(key)) {
    return `Broker key "${key}" must use lowercase letters only (e.g. customer_service_agent, not customerServiceAgent).`;
  }
  if (/_$/.test(key)) {
    return `Broker key "${key}" must not end with an underscore (e.g. billing_agent, not my_broker_).`;
  }
  if (!isValidBrokerKey(key)) {
    return `Broker key "${key}" is invalid. ${BROKER_KEY_HINT}`;
  }
  return `Broker key "${key}" is invalid. ${BROKER_KEY_HINT}`;
}

/** Convert arbitrary text to a valid broker key (import defaults, blur normalization). */
export function normalizeBrokerKey(input: string, fallback = "broker"): string {
  const snake = input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (snake && isValidBrokerKey(snake)) return snake;
  return fallback;
}
