"use client";

/**
 * Checks whether this deployment has the remote (Railway) lifecycle backend
 * configured, so the web UI can show the remote panel instead of the
 * setup guidance panel.
 */

import { useEffect, useState } from "react";

export type RemoteLifecycleState = "checking" | "enabled" | "disabled";

export function useRemoteLifecycleEnabled(): RemoteLifecycleState {
  const [state, setState] = useState<RemoteLifecycleState>("checking");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/lifecycle/config", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { enabled: false }))
      .then((data: { enabled?: boolean }) => {
        if (!cancelled) setState(data.enabled ? "enabled" : "disabled");
      })
      .catch(() => {
        if (!cancelled) setState("disabled");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
