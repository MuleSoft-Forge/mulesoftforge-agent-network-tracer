"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, ExternalLink } from "lucide-react";

const INSECURE_LOGGING_DOCS_URL =
  "https://docs.mulesoft.com/agent-network/latest/af-troubleshoot-agent-networks#enable-logging-to-debug-agent-brokers";

export interface LoggingDetailNoticeProps {
  /** True when at least one node is drawn from Object Store proof alone, with no logged order or timing. */
  hasUndetailedNodes: boolean;
  /** Per-task INSECURE-LOGGING status from Runtime Manager, when known. */
  insecureLoggingEnabled?: boolean;
}

/**
 * This diagram's node/edge *structure* always matches the published AgentScript
 * source, but which hops draw as traversed depends on what the broker's runtime
 * actually logged. Node kinds like `echo` only emit "Current node:" /
 * "Transitioning to..." lines when the deployment has INSECURE-LOGGING enabled —
 * without it, the Object Store still proves the node ran but with no order or
 * timing, which is why it renders dimmed/dashed instead of as a solid path. This
 * is expected platform behavior, not a Tracer bug, so it gets an explicit,
 * always-visible explanation instead of leaving people to file it as one.
 */
export default function LoggingDetailNotice({
  hasUndetailedNodes,
  insecureLoggingEnabled,
}: LoggingDetailNoticeProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current != null && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [open]);

  const statusLine =
    insecureLoggingEnabled === false
      ? "This deployment has INSECURE-LOGGING off, so this is expected here."
      : insecureLoggingEnabled === true
        ? "This deployment has INSECURE-LOGGING on — a gap here means the run predates that setting, or the broker's runtime doesn't log that node kind at all."
        : "INSECURE-LOGGING status for this deployment is unknown — check the API status tab.";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Why does some node detail say 'no logged detail'?"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold shadow-sm ring-1 transition-colors ${
          hasUndetailedNodes
            ? "bg-amber-100 text-amber-900 ring-amber-300 hover:bg-amber-200"
            : "bg-white text-gray-600 ring-gray-300 hover:bg-gray-50 hover:text-gray-800"
        }`}
      >
        <CircleAlert className="h-3.5 w-3.5" aria-hidden />
        Why is detail missing?
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-700 shadow-xl">
          <p className="mb-1.5 font-semibold text-gray-900">This diagram draws only what the broker logged</p>
          <p className="mb-1.5">
            The node/edge structure always matches the published AgentScript definition. Which hops draw
            as traversed depends on what the broker&apos;s runtime actually logged for this task — the
            Tracer cannot show detail the broker never logged.
          </p>
          <p className="mb-1.5">
            Some node kinds (e.g. <code className="font-mono">echo</code>) only emit their &quot;Current
            node:&quot; / &quot;Transitioning to...&quot; log lines when the deployment&apos;s{" "}
            <code className="font-mono">INSECURE-LOGGING</code> monitoring category is enabled. Without
            it, the only proof such a node ran comes from the Object Store&apos;s persisted state, which
            carries no order or timing — hence the dashed edge and the muted &quot;ran, no logged
            detail&quot; badge instead of a solid traversed path.
          </p>
          <p className="mb-1.5 text-gray-600">{statusLine}</p>
          <a
            href={INSECURE_LOGGING_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline"
          >
            Enable INSECURE-LOGGING (MuleSoft docs)
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
      )}
    </div>
  );
}
