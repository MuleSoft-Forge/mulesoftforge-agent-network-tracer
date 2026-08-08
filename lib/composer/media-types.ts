/**
 * Media types offered by the A2A card mode pickers.
 *
 * A2A leaves defaultInputModes/defaultOutputModes and their per-skill overrides
 * as open string arrays, so this is a shortlist for the common case rather than
 * a schema constraint — any valid media type can still be entered by hand. The
 * two entries below are the only ones MuleSoft documents for agent networks.
 * @see https://docs.mulesoft.com/agent-network/latest/af-agent-network-yaml-reference
 */
export const SUGGESTED_MEDIA_TYPES = ["application/json", "text/plain"] as const;

/** type/subtype, optionally followed by `; key=value` parameters (RFC 6838). */
const MEDIA_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(\s*;\s*[a-z0-9!#$&^_.+-]+=[^;]+)*$/;

export function normalizeMediaType(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isMediaType(value: string): boolean {
  return MEDIA_TYPE_PATTERN.test(value);
}
