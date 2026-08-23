import { helpHref, type HelpPageId } from "@/lib/help/help-map";

/**
 * Named target for the help centre. Every "?" affordance opens into this one
 * tab: the first click opens it, later clicks reuse it and navigate to the new
 * anchor — so the user never ends up with a pile of help tabs.
 */
export const HELP_WINDOW_NAME = "ans-help";

/**
 * Open (or reuse) the help tab and jump to a section. Call from any product
 * surface — e.g. onClick={() => openHelp("tracer", "entitlement")}.
 *
 * Uses window.open with a fixed target name: if the tab already exists the
 * browser loads the new anchored URL into it and returns the same reference,
 * which we then focus. Because a same-document hash change doesn't always
 * re-scroll, we nudge the hash explicitly when we can reach the tab's location.
 */
export function openHelp(id: HelpPageId, anchor?: string): void {
  if (typeof window === "undefined") return;
  const url = helpHref(id, anchor);
  const win = window.open(url, HELP_WINDOW_NAME);
  if (!win) return; // popup blocked — nothing else we can do
  win.focus();
  if (!anchor) return;
  // Best effort: if the tab is already on this page, force the scroll.
  try {
    if (win.location && win.location.pathname === helpHref(id)) {
      if (win.location.hash === `#${anchor}`) {
        // Same anchor already in the URL — re-assign to re-trigger scroll.
        win.location.hash = "";
      }
      win.location.hash = anchor;
    }
  } catch {
    // Cross-document access can throw mid-navigation; the URL already carries
    // the anchor, so a normal load will land in the right place.
  }
}
