"use client";

/**
 * Build / Publish / Deploy wrapper for the web + lifecycle-worker flow.
 */

import { Loader2 } from "lucide-react";
import BuildPublishWebLanding from "@/components/desktop/BuildPublishWebLanding";
import RemoteLifecyclePanel from "@/components/desktop/RemoteLifecyclePanel";
import { useRemoteLifecycleEnabled } from "@/lib/lifecycle/useRemoteLifecycleEnabled";

export default function AgentNetworkLifecyclePanel() {
  const remoteLifecycle = useRemoteLifecycleEnabled();
  if (remoteLifecycle === "checking") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking lifecycle backend…
      </div>
    );
  }
  if (remoteLifecycle === "enabled") {
    return <RemoteLifecyclePanel />;
  }
  return <BuildPublishWebLanding />;
}
