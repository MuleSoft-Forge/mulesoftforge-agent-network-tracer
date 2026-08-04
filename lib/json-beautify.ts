/**
 * Pretty-print JSON for display and line-based diffing.
 * Returns the original string if parsing fails.
 */
export function beautifyJsonString(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}

/** Pretty-print when the artifact is JSON (Maven `exchange.json`, a2a-card, agent-metadata, etc.). */
export function beautifyIfJsonPackaging(
  packaging: string,
  content: string | null
): string | null {
  if (content == null) return null;
  if (packaging.toLowerCase() === "json") {
    return beautifyJsonString(content);
  }
  return content;
}
