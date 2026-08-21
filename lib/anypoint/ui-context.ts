export interface AnypointUiContext {
  orgId?: string;
  envId?: string;
}

const UI_CONTEXT_KEY = "ant-ui-context";
export const UI_CONTEXT_CHANGED_EVENT = "ant-ui-context-changed";

/**
 * Read the raw stored context, migrating a legacy per-tab sessionStorage value
 * into localStorage on first access so an in-progress selection survives the
 * switch to cross-tab persistence.
 */
function readRawUiContext(): string | null {
  const fromLocal = localStorage.getItem(UI_CONTEXT_KEY);
  if (fromLocal) return fromLocal;
  const legacy = sessionStorage.getItem(UI_CONTEXT_KEY);
  if (legacy) {
    localStorage.setItem(UI_CONTEXT_KEY, legacy);
    sessionStorage.removeItem(UI_CONTEXT_KEY);
    return legacy;
  }
  return null;
}

export function readAnypointUiContext(): AnypointUiContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = readRawUiContext();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AnypointUiContext>;
    const orgId = (parsed.orgId ?? "").trim();
    const envId = (parsed.envId ?? "").trim();
    if (!orgId && !envId) return null;
    return {
      ...(orgId ? { orgId } : {}),
      ...(envId ? { envId } : {}),
    };
  } catch {
    return null;
  }
}

export function writeAnypointUiContext(context: AnypointUiContext | null): void {
  if (typeof window === "undefined") return;
  try {
    const orgId = context?.orgId?.trim() ?? "";
    const envId = context?.envId?.trim() ?? "";
    if (!orgId && !envId) {
      localStorage.removeItem(UI_CONTEXT_KEY);
      window.dispatchEvent(new CustomEvent(UI_CONTEXT_CHANGED_EVENT));
      return;
    }
    localStorage.setItem(UI_CONTEXT_KEY, JSON.stringify({ orgId, envId }));
    window.dispatchEvent(new CustomEvent(UI_CONTEXT_CHANGED_EVENT));
  } catch {
    // no-op (private mode / storage disabled)
  }
}
