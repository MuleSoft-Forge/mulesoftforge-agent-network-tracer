import { isSafeRedirectPath, safeRedirectPath } from "@/lib/safe-redirect";

export const POST_AUTH_REDIRECT_KEY = "post-auth-redirect";

export function storePostAuthRedirect(path: string): void {
  if (typeof window === "undefined") return;
  if (!isSafeRedirectPath(path)) return;
  sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, path);
}

export function consumePostAuthRedirect(fallback = "/agent-network"): string {
  if (typeof window === "undefined") return fallback;
  const stored = sessionStorage.getItem(POST_AUTH_REDIRECT_KEY);
  sessionStorage.removeItem(POST_AUTH_REDIRECT_KEY);
  return safeRedirectPath(stored, fallback);
}
