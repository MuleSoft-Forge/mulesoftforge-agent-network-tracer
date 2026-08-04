/** Clear renderer-side preferences when the user resets desktop local settings. */

import { clearComposerSession } from "@/lib/composer/session-persistence";
import { setLastProjectDir } from "@/lib/desktop/last-project-path";

const PROFILE_CACHE_KEY = "agent-network-profile";

export function clearLocalDesktopSettings(): void {
  if (typeof window === "undefined") return;

  setLastProjectDir(null);
  clearComposerSession();

  try {
    sessionStorage.removeItem(PROFILE_CACHE_KEY);
    sessionStorage.removeItem("llm-proxy-ctx");
  } catch {
    /* ignore quota / private mode */
  }
}
