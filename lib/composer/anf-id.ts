/**
 * Agent Network v2 broker map keys and connection IDs.
 *
 * Rules (mirror the official schema patternProperties for Brokers/Connections/etc.):
 * start with a letter; then letters, digits, underscores, dashes, and periods;
 * end with a letter or digit. Mixed case is allowed.
 *
 * Agent Network 2.0 originally restricted these IDs to lowercase letters, digits,
 * and non-trailing underscores, so the Composer used to enforce that stricter rule.
 * That runtime restriction was lifted (uppercase letters, dashes, and periods are now
 * accepted), so we mirror the schema pattern `^[a-zA-Z][a-zA-Z0-9_.-]*[a-zA-Z0-9]$` directly.
 */

/** e.g. my_broker, MyBroker, llm-openai.v2, agent2 */
export const ANF_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]*[a-zA-Z0-9]$/;

export const ANF_ID_HINT =
  "Start with a letter, then letters, digits, underscores, dashes, and periods. Must end with a letter or digit (e.g. my_broker, MyBroker, llm-openai.v2).";

export function isValidAnfId(id: string): boolean {
  return ANF_ID_PATTERN.test(id);
}

/** Restrict keystrokes in id fields — [a-zA-Z0-9_.-] only. */
export function restrictAnfIdInput(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "");
}

export function anfIdValidationMessage(
  id: string,
  label: "Broker ID" | "Connection ID" = "Connection ID"
): string {
  const trimmed = id.trim();
  if (!trimmed) return `${label} is required.`;
  if (/^[^a-zA-Z]/.test(trimmed)) {
    return `${label} "${trimmed}" must start with a letter.`;
  }
  if (/[^a-zA-Z0-9_.-]/.test(trimmed)) {
    return `${label} "${trimmed}" may only contain letters, digits, underscores, dashes, and periods.`;
  }
  if (/[^a-zA-Z0-9]$/.test(trimmed)) {
    return `${label} "${trimmed}" must end with a letter or digit.`;
  }
  if (trimmed.length < 2) {
    return `${label} "${trimmed}" must be at least 2 characters.`;
  }
  return `${label} "${trimmed}" is invalid. ${ANF_ID_HINT}`;
}

/**
 * Canonicalize arbitrary text into a clean lowercase snake_case id.
 *
 * Used for generated defaults and slugs (default connection ids, base-name stems,
 * network names, variable groups): always canonicalizes — even already-valid
 * mixed-case input — so generated ids stay predictable and uniform. To keep a valid
 * id the user or an import already chose, use {@link coerceAnfId} instead.
 */
export function normalizeAnfId(input: string, fallback = "id"): string {
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

/**
 * Field-blur / import normalization for ids the user controls: keep an already-valid
 * id verbatim (mixed case, dashes, and periods are all allowed now), otherwise
 * canonicalize it to a clean snake_case id via {@link normalizeAnfId}.
 */
export function coerceAnfId(input: string, fallback = "id"): string {
  const trimmed = input.trim();
  if (trimmed && isValidAnfId(trimmed)) return trimmed;
  return normalizeAnfId(input, fallback);
}

/** Default yaml connection key for an asset base name. */
export function connectionIdForBaseName(baseName: string, fallback = "asset"): string {
  const base = normalizeAnfId(baseName, fallback);
  return `${base}_connection`;
}
