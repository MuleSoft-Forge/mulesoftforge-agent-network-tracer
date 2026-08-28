/**
 * Exchange GAV assetId for project identity (exchange.json assetId).
 *
 * MuleSoft's GAV schema types assetId as string without a pattern; published
 * assets commonly use kebab-case or snake_case (e.g. my-agent-network,
 * agent_network_reasoningonly_assetid), and Exchange now also accepts uppercase
 * letters (e.g. MyAgentNetwork), so mixed case is allowed here too.
 */

/** e.g. my-agent-network, MyAgentNetwork, agent_network_reasoningonly_assetid, agent2 */
export const EXCHANGE_ASSET_ID_PATTERN = /^[a-zA-Z]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;

export const EXCHANGE_ASSET_ID_HINT =
  "letters, digits, hyphens, and underscores; start with a letter; end with a letter or digit (e.g. my-agent-network or agent_broker_get_date)";

/** Full Project tab hint — always shown under the Asset id field. */
export const EXCHANGE_ASSET_ID_FIELD_HINT = `Exchange asset slug (GAV assetId). [${EXCHANGE_ASSET_ID_HINT}]`;

export function isValidExchangeAssetId(id: string): boolean {
  return EXCHANGE_ASSET_ID_PATTERN.test(id);
}

/** Restrict keystrokes — [a-zA-Z0-9_-] only. */
export function restrictExchangeAssetIdInput(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function exchangeAssetIdValidationMessage(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return "Asset id is required.";
  if (/^[^a-zA-Z]/.test(trimmed)) {
    return `Asset id "${trimmed}" must start with a letter.`;
  }
  if (/[^a-zA-Z0-9_-]/.test(trimmed)) {
    return `Asset id "${trimmed}" may only contain letters, digits, hyphens, and underscores.`;
  }
  if (/[^a-zA-Z0-9]$/.test(trimmed)) {
    return `Asset id "${trimmed}" must end with a letter or digit.`;
  }
  return `Asset id "${trimmed}" is invalid. ${EXCHANGE_ASSET_ID_HINT}`;
}

/** Convert arbitrary text to a valid Exchange asset slug (blur normalization). */
export function normalizeExchangeAssetId(input: string, fallback = "agent-network"): string {
  const trimmed = input.trim();
  if (trimmed && isValidExchangeAssetId(trimmed)) return trimmed;

  // Mixed case is allowed, so preserve whatever case the user typed — just
  // replace runs of unsupported characters with a single hyphen.
  let slug = input
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug && !/^[a-zA-Z]/.test(slug)) {
    slug = `a-${slug.replace(/^[^a-zA-Z]+/, "")}`;
  }
  slug = slug.replace(/-+$/, "");

  if (slug && isValidExchangeAssetId(slug)) return slug;
  return fallback;
}
