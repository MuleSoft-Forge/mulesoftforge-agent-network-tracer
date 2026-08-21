"use client";

import { useEffect, useState } from "react";
import BusinessGroupSelector from "@/components/BusinessGroupSelector";
import EnvironmentSelector, { type AnypointEnvironment } from "@/components/EnvironmentSelector";
import { readAnypointUiContext, writeAnypointUiContext } from "@/lib/anypoint/ui-context";

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

  useEffect(() => {
    setExpanded(getStoredExpanded());
    const current = readAnypointUiContext();
    if (!current) return;
    setOrgId(current.orgId ?? "");
    setEnvId(current.envId ?? "");
  }, []);

  const handleOrgSelect = (value: string) => {
    if (value && value === orgId) {
      writeAnypointUiContext(envId ? { orgId: value, envId } : { orgId: value });
      return;
    }
    setOrgId(value);
    setEnvId("");
    writeAnypointUiContext(value ? { orgId: value } : null);
  };

  const handleEnvironmentSelect = (_envId: string, env: AnypointEnvironment | null) => {
    const nextEnvId = env?.id ?? "";
    setEnvId(nextEnvId);
    if (orgId && nextEnvId) {
      writeAnypointUiContext({ orgId, envId: nextEnvId });
      return;
    }
    writeAnypointUiContext(null);
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
            <BusinessGroupSelector initialOrgId={orgId || undefined} onSelect={handleOrgSelect} />
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
