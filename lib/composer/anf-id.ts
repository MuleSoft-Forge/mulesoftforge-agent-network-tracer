/**
 * Agent Network v2 broker map keys and connection IDs.
 *
 * Runtime/deploy requires: start with a lowercase letter; only lowercase letters,
 * digits, and underscores; end with a lowercase letter or digit.
 *
 * Note: the JSON schema pattern allows mixed-case IDs (`^[a-zA-Z][a-zA-Z0-9_.-]*[a-zA-Z0-9]$`),
 * but the Composer intentionally enforces the stricter lowercase/underscore rule above because
 * deployed Agent Fabric networks reject uppercase connection keys.
 */

/** e.g. my_broker, llm_openai_connection, agent2 */
export const ANF_ID_PATTERN = /^[a-z]([a-z0-9_]*[a-z0-9])?$/;

export const ANF_ID_HINT =
  "Lowercase letter first, then lowercase letters, digits, and underscores only. Must end with a letter or digit (e.g. my_broker, llm_openai_connection).";

export function isValidAnfId(id: string): boolean {
  return ANF_ID_PATTERN.test(id);
}

/** Restrict keystrokes in id fields — lowercase [a-z0-9_] only. */
export function restrictAnfIdInput(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

export function anfIdValidationMessage(
  id: string,
  label: "Broker ID" | "Connection ID" = "Connection ID"
): string {
  const trimmed = id.trim();
  if (!trimmed) return `${label} is required.`;
  if (/[A-Z]/.test(trimmed)) {
    return `${label} "${trimmed}" must use lowercase letters only (e.g. llm_openai_connection, not llmOpenaiConnection).`;
  }
  if (/^[^a-z]/.test(trimmed)) {
    return `${label} "${trimmed}" must start with a lowercase letter.`;
  }
  if (/[^a-z0-9_]/.test(trimmed)) {
    return `${label} "${trimmed}" may only contain lowercase letters, digits, and underscores.`;
  }
  if (/[^a-z0-9]$/.test(trimmed)) {
    return `${label} "${trimmed}" must end with a lowercase letter or digit.`;
  }
  if (!isValidAnfId(trimmed)) {
    return `${label} "${trimmed}" is invalid. ${ANF_ID_HINT}`;
  }
  return `${label} "${trimmed}" is invalid. ${ANF_ID_HINT}`;
}

/** Convert arbitrary text to a valid id (import defaults, blur normalization). */
export function normalizeAnfId(input: string, fallback = "id"): string {
  const trimmed = input.trim();
  if (trimmed && isValidAnfId(trimmed)) return trimmed;

  let snake = input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (snake && !/^[a-z]/.test(snake)) {
    snake = `a_${snake.replace(/^[^a-z]+/, "")}`;
  }
  snake = snake.replace(/_+$/, "");

  if (snake && isValidAnfId(snake)) return snake;
  return fallback;
}

/** Default yaml connection key for an asset base name. */
export function connectionIdForBaseName(baseName: string, fallback = "asset"): string {
  const base = normalizeAnfId(baseName, fallback);
  return `${base}_connection`;
}
