/**
 * Feature detection for the desktop bridge.
 *
 * The same codebase ships to the browser (Vercel) and to Electron. CLI-backed
 * build/publish/deploy only works in Electron, so callers gate on `isDesktop()`
 * and render a disabled/explanatory state on the web.
 */

import type { DesktopApi } from "./types";

/** True only inside the Electron renderer, where preload exposed the bridge. */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.desktop?.isDesktop === true;
}

/** The bridge, or null on the web / during SSR. */
export function getDesktop(): DesktopApi | null {
  if (typeof window === "undefined") return null;
  return window.desktop ?? null;
}

/** Short label for the current platform, for UI copy. */
export function desktopPlatformLabel(): string | null {
  const platform = getDesktop()?.platform;
  if (!platform) return null;
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return platform;
}
