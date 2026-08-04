/**
 * Exchange GAV assetId for project identity (exchange.json assetId).
 *
 * MuleSoft's GAV schema types assetId as string without a pattern; published
 * assets commonly use kebab-case or snake_case (e.g. my-agent-network,
 * agent_network_reasoningonly_assetid).
 */

/** e.g. my-agent-network, agent_network_reasoningonly_assetid, agent2 */
export const EXCHANGE_ASSET_ID_PATTERN = /^[a-z]([a-z0-9_-]*[a-z0-9])?$/;

export const EXCHANGE_ASSET_ID_HINT =
  "lowercase letters, digits, hyphens, and underscores; start with a letter; end with a letter or digit (e.g. my-agent-network or agent_broker_get_date)";

/** Full Project tab hint — always shown under the Asset id field. */
export const EXCHANGE_ASSET_ID_FIELD_HINT = `Exchange asset slug (GAV assetId). [${EXCHANGE_ASSET_ID_HINT}]`;

export function isValidExchangeAssetId(id: string): boolean {
  return EXCHANGE_ASSET_ID_PATTERN.test(id);
}

/** Restrict keystrokes — lowercase [a-z0-9_-] only. */
export function restrictExchangeAssetIdInput(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

export function exchangeAssetIdValidationMessage(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return "Asset id is required.";
  if (/[A-Z]/.test(trimmed)) {
    return `Asset id "${trimmed}" must use lowercase letters only (e.g. my-agent-network, not myAgentNetwork).`;
  }
  if (/^[^a-z]/.test(trimmed)) {
    return `Asset id "${trimmed}" must start with a lowercase letter.`;
  }
  if (/[^a-z0-9_-]/.test(trimmed)) {
    return `Asset id "${trimmed}" may only contain lowercase letters, digits, hyphens, and underscores.`;
  }
  if (/[^a-z0-9]$/.test(trimmed)) {
    return `Asset id "${trimmed}" must end with a lowercase letter or digit.`;
  }
  return `Asset id "${trimmed}" is invalid. ${EXCHANGE_ASSET_ID_HINT}`;
}

/** Convert arbitrary text to a valid Exchange asset slug (blur normalization). */
export function normalizeExchangeAssetId(input: string, fallback = "agent-network"): string {
  const trimmed = input.trim();
  if (trimmed && isValidExchangeAssetId(trimmed)) return trimmed;

  let slug = input
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug && !/^[a-z]/.test(slug)) {
    slug = `a-${slug.replace(/^[^a-z]+/, "")}`;
  }
  slug = slug.replace(/-+$/, "");

  if (slug && isValidExchangeAssetId(slug)) return slug;
  return fallback;
}
