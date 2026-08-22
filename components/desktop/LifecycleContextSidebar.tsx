"use client";

import { useEffect, useRef, useState } from "react";
import BusinessGroupSelector from "@/components/BusinessGroupSelector";
import EnvironmentSelector, { type AnypointEnvironment } from "@/components/EnvironmentSelector";
import {
  readAnypointUiContext,
  UI_CONTEXT_CHANGED_EVENT,
  writeAnypointUiContext,
} from "@/lib/anypoint/ui-context";

const SIDEBAR_EXPANDED_KEY = "agent-network-sidebar-expanded";

function getStoredExpanded(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(SIDEBAR_EXPANDED_KEY);
    return v !== "false";
  } catch {
    return true;
  }
}

export default function LifecycleContextSidebar() {
  const [expanded, setExpanded] = useState(true);
  const [orgId, setOrgId] = useState<string>("");
  const [envId, setEnvId] = useState<string>("");
  // BusinessGroupSelector only reads initialOrgId on mount, so it must be
  // remounted when the org changes from OUTSIDE this component (another tab,
  // the composer). Bumping the key only on external changes — not on a local
  // dropdown pick — avoids a skeleton flash and a redundant profile fetch on
  // every selection, while still reflecting external context updates.
  const [selectorEpoch, setSelectorEpoch] = useState(0);
  const orgIdRef = useRef("");

  useEffect(() => {
    orgIdRef.current = orgId;
  }, [orgId]);

  useEffect(() => {
    setExpanded(getStoredExpanded());
    const syncFromUiContext = () => {
      const current = readAnypointUiContext();
      const nextOrgId = current?.orgId ?? "";
      if (nextOrgId !== orgIdRef.current) {
        orgIdRef.current = nextOrgId;
        setOrgId(nextOrgId);
        setSelectorEpoch((epoch) => epoch + 1);
      }
      setEnvId(current?.envId ?? "");
    };
    syncFromUiContext();
    window.addEventListener("focus", syncFromUiContext);
    window.addEventListener("storage", syncFromUiContext);
    window.addEventListener(UI_CONTEXT_CHANGED_EVENT, syncFromUiContext);
    return () => {
      window.removeEventListener("focus", syncFromUiContext);
      window.removeEventListener("storage", syncFromUiContext);
      window.removeEventListener(UI_CONTEXT_CHANGED_EVENT, syncFromUiContext);
    };
  }, []);

  const handleOrgSelect = (value: string) => {
    const restored = readAnypointUiContext();
    const restoredEnvId = restored?.orgId === value ? (restored.envId ?? "") : "";
    if (value && value === orgId) {
      const nextEnvId = envId || restoredEnvId;
      if (nextEnvId) setEnvId(nextEnvId);
      writeAnypointUiContext(nextEnvId ? { orgId: value, envId: nextEnvId } : { orgId: value });
      return;
    }
    setOrgId(value);
    setEnvId(restoredEnvId);
    writeAnypointUiContext(
      value ? (restoredEnvId ? { orgId: value, envId: restoredEnvId } : { orgId: value }) : null
    );
  };

  const handleEnvironmentSelect = (_envId: string, env: AnypointEnvironment | null) => {
    const nextEnvId = env?.id ?? "";
    setEnvId(nextEnvId);
    // Never write the shared context when no business group is selected. The
    // environment selector fires a mount-time onSelect(ENV_NONE) during the
    // orgId="" transient (before this sidebar restores orgId); without this
    // guard that would writeAnypointUiContext(null) and wipe the org+env the
    // Tracer had persisted, right before our restore effect reads it. Clearing
    // the whole context on business-group deselect is handled by handleOrgSelect.
    if (!orgId) return;
    writeAnypointUiContext(nextEnvId ? { orgId, envId: nextEnvId } : { orgId });
  };

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(next));
    } catch {
      // ignore storage failures
    }
  };

  return (
    <aside
      className={`flex h-full min-h-0 shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] ${
        expanded ? "w-72" : "w-12"
      }`}
    >
      <div className="flex h-10 items-center justify-end border-b border-gray-100 px-2">
        <button
          type="button"
          onClick={handleToggle}
          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {expanded ? (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </button>
      </div>
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
          !expanded ? "w-0 min-w-0 overflow-hidden opacity-0 pointer-events-none" : ""
        }`}
      >
        <div className="overflow-y-auto p-3">
          <div className="space-y-4">
            <BusinessGroupSelector
              key={selectorEpoch}
              initialOrgId={orgId || undefined}
              onSelect={handleOrgSelect}
            />
            <EnvironmentSelector
              orgId={orgId || null}
              value={envId}
              onSelect={handleEnvironmentSelect}
              disabled={!orgId}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}
