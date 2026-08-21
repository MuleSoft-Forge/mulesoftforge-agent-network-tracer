/** Persist the on-disk Agent Network project folder across Builder and Lifecycle. */

const STORAGE_KEY = "agent-network:last-project-dir";

export function getLastProjectDir(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value?.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function setLastProjectDir(projectDir: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (projectDir?.trim()) {
      window.localStorage.setItem(STORAGE_KEY, projectDir.trim());
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
}
