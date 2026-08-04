export interface Gav {
  groupId: string;
  assetId: string;
  version: string;
}

/**
 * Parse `urn:gav:` / `urn:gavg:` (and similar) metadata.source values from API Manager.
 * Returns undefined when the URN shape is not recognized.
 */
export function parseGavFromMetadataSource(
  urn: string | null | undefined
): Gav | undefined {
  if (!urn || typeof urn !== "string") return undefined;

  const normalized = urn.trim();
  const match = normalized.match(/^urn:(?:gav|gavg):([^:]+):([^:]+):(.+)$/i);
  if (match) {
    return { groupId: match[1], assetId: match[2], version: match[3] };
  }

  // Legacy: strip a single known prefix then split (kept for odd partial strings).
  const legacy = normalized.replace(/^urn:gav:/i, "");
  if (legacy !== normalized) {
    const parts = legacy.split(":");
    if (parts.length >= 3) {
      return { groupId: parts[0], assetId: parts[1], version: parts[2] };
    }
  }

  return undefined;
}
