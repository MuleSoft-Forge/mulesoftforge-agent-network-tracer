const ALLOWED_PREFIXES = ["/agent-network", "/builder", "/lifecycle"] as const;

/** Same-origin app paths only — blocks open redirects. */
export function isSafeRedirectPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  return ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}/`)
  );
}

export function safeRedirectPath(path: string | null | undefined, fallback = "/agent-network"): string {
  if (path && isSafeRedirectPath(path)) return path;
  return fallback;
}
