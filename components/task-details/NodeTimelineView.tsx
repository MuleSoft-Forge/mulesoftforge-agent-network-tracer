"use client";

import { Clock, GitBranch, Wrench, Brain, ArrowRight } from "lucide-react";
import type { JobCard, LogEntry, NodeVisit, SelectedItem, V2NodeTimeline } from "./types";
import TaskDetailsStepNode from "./TaskDetailsStepNode";

interface NodeTimelineViewProps {
  jobCard: JobCard;
  timeline: V2NodeTimeline;
  selectedItem: SelectedItem | null;
  onSelectItem: (item: SelectedItem) => void;
  getBadgeClass: (type: string) => string;
  formatTimestamp: (ts: string | number) => string;
}

function durationLabel(ms: number): string {
  if (ms <= 0) return "0s";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** How old the task is, when it reported a usable start time. */
function taskAgeLabel(startTime: string | undefined): string | null {
  if (startTime == null || startTime.trim() === "") return null;
  const started = new Date(startTime).getTime();
  if (!Number.isFinite(started)) return null;
  const hours = (Date.now() - started) / 3_600_000;
  if (hours < 0) return null;
  if (hours < 1) return "under an hour old";
  if (hours < 48) return `about ${Math.round(hours)} hours old`;
  return `about ${Math.round(hours / 24)} days old`;
}

/**
 * Whether the only logs retrieved came from the gateway in front of the broker.
 *
 * This matters for what we may conclude. Gateway logs and the broker's Mule
 * application are different emitters with different identities and retention, so
 * gateway lines arriving is no evidence that the broker's own lines were emitted,
 * or that they are still retrievable.
 */
function isGatewayOnly(entries: LogEntry[]): boolean {
  return entries.length > 0 && entries.every((entry) => entry.type === "GATEWAY");
}

/**
 * v2 node-graph spine. Renders the task root (for story/status/traces tabs) plus
 * an ordered list of node visits, each previewing the reasoning, tools, and
 * transition it produced. Selecting a visit surfaces `type: "node"` details.
 */
export default function NodeTimelineView({
  jobCard,
  timeline,
  selectedItem,
  onSelectItem,
  getBadgeClass,
  formatTimestamp,
}: NodeTimelineViewProps) {
  const isTaskSelected = selectedItem?.type === "task";
  const taskAge = taskAgeLabel(jobCard.startTime);
  const gatewayOnly = isGatewayOnly(timeline.preEntries);

  return (
    <div className="p-4">
      <button
        type="button"
        onClick={() => onSelectItem({ type: "task", id: "task", data: jobCard })}
        className={`mb-3 flex w-full items-center gap-2 rounded-lg border-2 px-3 py-2 text-left transition-colors ${
          isTaskSelected ? "border-indigo-500 bg-indigo-50" : "border-transparent bg-white hover:bg-gray-50"
        }`}
      >
        <span className="font-semibold text-gray-900">Task {jobCard.taskId}</span>
        <span className="text-xs text-gray-500">•</span>
        <span className="text-xs text-gray-600">{jobCard.duration || "?"}s</span>
        <span className="text-xs text-gray-500">•</span>
        <span className="text-xs text-gray-600">{timeline.visits.length} nodes</span>
      </button>

      {timeline.preEntries.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-xs font-semibold text-gray-500">Inbound + Discovery</div>
          {timeline.preEntries.map((entry: LogEntry) => (
            <TaskDetailsStepNode
              key={entry.index}
              entry={entry}
              selectedItem={selectedItem}
              onSelectItem={onSelectItem}
              getBadgeClass={getBadgeClass}
              formatTimestamp={formatTimestamp}
            />
          ))}
        </div>
      )}

      {timeline.degraded ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {timeline.preEntries.length > 0 ? (
            <>
              We retrieved {timeline.preEntries.length} log{" "}
              {timeline.preEntries.length === 1 ? "entry" : "entries"} for this task, but none
              of them are graph-node logs from{" "}
              <code className="font-mono">module_graph_runtime</code>
              {gatewayOnly
                ? ", and what we did retrieve came from the gateway in front of the broker rather than from the broker application itself"
                : ""}
              .{" "}
              {taskAge != null ? (
                <>
                  This task is {taskAge}. Broker log lines are retrieved as a bounded recent
                  tail, so on a busy broker they roll out of reach by volume well before any
                  retention window expires — the usual reason an older task has no node detail
                  while a task you run now does.
                </>
              ) : (
                <>
                  Broker log lines are retrieved as a bounded recent tail, so they can roll out
                  of reach by volume before any retention window expires.
                </>
              )}
            </>
          ) : (
            <>
              No logs at all were found for this task, so we cannot tell whether graph-node
              logs were ever emitted. They may have aged out of the log retention window, or
              the search may not have covered the task&apos;s time range.
            </>
          )}{" "}
          {timeline.reachedFromState.length > 0 ? (
            <>
              The broker&apos;s persisted graph state does record{" "}
              {timeline.reachedFromState.length}{" "}
              {timeline.reachedFromState.length === 1 ? "node" : "nodes"} as having run
              {" — "}
              <span className="font-mono">{timeline.reachedFromState.join(", ")}</span>
              {" — "}
              and the Graph view marks {timeline.reachedFromState.length === 1 ? "it" : "them"}{" "}
              as reached. That record carries no ordering or timing, so the order each node ran
              in, how long it took, and its reasoning are what the graph-node logs would add.
              See the Task story tab for the full decoded state.
            </>
          ) : (
            <>See the Task story tab for the decoded Object Store state.</>
          )}
        </div>
      ) : (
        <div className="relative ml-1 border-l-2 border-gray-200 pl-3">
          {timeline.visits.map((visit: NodeVisit) => {
            const isSelected = selectedItem?.type === "node" && selectedItem.id === visit.id;
            return (
              <div key={visit.id} className="relative mb-2">
                <span className="absolute -left-[19px] top-3 h-2.5 w-2.5 rounded-full border-2 border-white bg-indigo-400" />
                <button
                  type="button"
                  onClick={() => onSelectItem({ type: "node", id: visit.id, data: visit })}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    isSelected ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-3.5 w-3.5 text-indigo-500" />
                    <span className="text-sm font-semibold text-gray-900">{visit.nodeName}</span>
                    <span className="ml-auto flex items-center gap-1 text-xs text-gray-500">
                      <Clock className="h-3 w-3" />
                      {durationLabel(visit.durationMs)}
                    </span>
                  </div>

                  {visit.summary ? (
                    <div className="mt-1 line-clamp-2 text-xs text-gray-600">{visit.summary}</div>
                  ) : null}

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {visit.reasoning.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">
                        <Brain className="h-3 w-3" />
                        {visit.reasoning.length} reasoning
                      </span>
                    )}
                    {visit.toolCalls.map((call, i) => (
                      <span
                        key={`${visit.id}-tool-${i}`}
                        className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-medium text-teal-700"
                      >
                        <Wrench className="h-3 w-3" />
                        {call.tool}
                      </span>
                    ))}
                    {visit.transitionTo && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                        <ArrowRight className="h-3 w-3" />
                        {visit.transitionTo}
                      </span>
                    )}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
