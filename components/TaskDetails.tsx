"use client";

import { useState, useEffect, useMemo } from "react";
import { ChevronRight, ChevronDown, Clock, CheckCircle2, XCircle, Circle } from "lucide-react";
import { useDebugViewer } from "@/components/debug/useDebugViewer";
import TaskDetailsPanel from "@/components/task-details/TaskDetailsPanel";
import TaskDetailsTreeView from "@/components/task-details/TaskDetailsTreeView";
import TaskDetailsListView from "@/components/task-details/TaskDetailsListView";
import type { JobCard, LogEntry, TreeStructure, ViewMode, DetailTab, SelectedItem, TraceSpan } from "@/components/task-details/types";

interface TaskDetailsProps {
  orgId: string;
  taskId: string | null;
  envId?: string;
}

export default function TaskDetails({ orgId, taskId, envId }: TaskDetailsProps) {
  const [jobCard, setJobCard] = useState<JobCard | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [traceSpans, setTraceSpans] = useState<TraceSpan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(["task"]));
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set());
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("input-output");
  const { openDebugViewer } = useDebugViewer();

  // When selectedItem changes to a non-task item, switch away from traces tab if needed
  useEffect(() => {
    if (selectedItem != null && selectedItem.type !== "task" && detailTab === "traces") {
      setDetailTab("input-output");
    }
  }, [selectedItem, detailTab]);

  // Load task details when taskId changes
  useEffect(() => {
    if (!orgId || !taskId) {
      setJobCard(null);
      setEntries([]);
      setError(null);
      setSelectedItem(null);
      return;
    }

    setLoading(true);
    setError(null);

    const url = `/api/task-callstack?orgId=${encodeURIComponent(orgId)}&taskId=${encodeURIComponent(taskId)}${envId ? `&envId=${encodeURIComponent(envId)}` : ""}`;
    fetch(url)
      .then((res) => {
        // Capture status code BEFORE parsing JSON
        const statusCode = res.status;
        
        if (!res.ok) {
          // Try to parse JSON, but handle errors separately
          return res.json()
            .then((data: { error?: string; code?: string; message?: string }) => {
              // Check for Monitoring Center Premium error specifically
              if (statusCode === 403 && (data.code === "MONITORING_CENTER_PREMIUM_REQUIRED" || data.error?.includes("Monitoring Center Premium"))) {
                const errorMessage = data.message || data.error || "Log Search - Advanced package or a Titanium subscription to Anypoint Platform Required - Elasticsearch log search APIs - Enhanced raw storage (up to 128TB based on configuration) - Advanced logs and traces - LLM reasoning logs (for Agent Broker monitoring)";
                throw new Error(errorMessage);
              }
              throw new Error(data.error || `Failed to fetch: ${statusCode}`);
            })
            .catch((jsonErr) => {
              // If JSON parsing fails, check status code directly
              if (statusCode === 403) {
                throw new Error("Log Search - Advanced package or a Titanium subscription to Anypoint Platform Required - Elasticsearch log search APIs - Enhanced raw storage (up to 128TB based on configuration) - Advanced logs and traces - LLM reasoning logs (for Agent Broker monitoring)");
              }
              throw new Error(`Failed to fetch: ${statusCode}`);
            });
        }
        return res.json();
      })
      .then((data: { jobCard: JobCard; entries: LogEntry[]; traceSpans?: TraceSpan[] }) => {
        setJobCard(data.jobCard);
        setEntries(data.entries ?? []);
        setTraceSpans(data.traceSpans ?? []);
        // Auto-select task on load
        if (data.jobCard) {
          setSelectedItem({
            type: "task",
            id: "task",
            data: data.jobCard,
          });
        }
      })
      .catch((err) => {
        console.error("Error fetching task call stack:", err);
        // Check if it's a Monitoring Center Premium error
        if (err.message && (err.message.includes("Monitoring Center Premium") || err.message.includes("Log Search - Advanced package"))) {
          setError("Log Search - Advanced package or a Titanium subscription to Anypoint Platform Required - Elasticsearch log search APIs - Enhanced raw storage (up to 128TB based on configuration) - Advanced logs and traces - LLM reasoning logs (for Agent Broker monitoring)");
        } else {
          setError(err.message || "Failed to load task details");
        }
      })
      .finally(() => setLoading(false));
  }, [orgId, taskId, envId]);

  // Build hierarchical structure
  const treeStructure = useMemo(() => {
    if (!jobCard || entries.length === 0) return null;

    const groups: Record<string, LogEntry[]> = {};
    const noIterEntries: LogEntry[] = [];

    for (const e of entries) {
      const it = e.fields.iteration;
      if (it && it !== "0") {
        if (!groups[it]) groups[it] = [];
        groups[it].push(e);
      } else {
        noIterEntries.push(e);
      }
    }

    // Split no-iteration entries
    const firstIterTime = Object.values(groups)[0]?.[0]?.timestamp;
    const preEntries: LogEntry[] = [];
    const postEntries: LogEntry[] = [];

    for (const e of noIterEntries) {
      const t = typeof e.timestamp === "number" ? e.timestamp : new Date(e.timestamp).getTime();
      const firstT = firstIterTime
        ? typeof firstIterTime === "number"
          ? firstIterTime
          : new Date(firstIterTime).getTime()
        : Infinity;
      if (t <= firstT) {
        preEntries.push(e);
      } else {
        postEntries.push(e);
      }
    }

    // Build iterations with steps
    const iterations = Object.keys(groups)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map((it) => {
        const iterEntries = groups[it];
        const firstEntry = iterEntries[0];
        const lastEntry = iterEntries[iterEntries.length - 1];
        const startTime = typeof firstEntry.timestamp === "number" ? firstEntry.timestamp : new Date(firstEntry.timestamp).getTime();
        const endTime = typeof lastEntry.timestamp === "number" ? lastEntry.timestamp : new Date(lastEntry.timestamp).getTime();
        const duration = ((endTime - startTime) / 1000).toFixed(1);

        const toolSelection = iterEntries.find((e) => e.type === "LLM_TOOL_SELECTION");
        const toolName = toolSelection
          ? (toolSelection.fields.tool || "").replace(/^[a-zA-Z0-9]+_/, "")
          : "unknown";

        // Group steps by type
        const steps: Record<string, LogEntry[]> = {};
        for (const entry of iterEntries) {
          const stepType = entry.type;
          if (!steps[stepType]) steps[stepType] = [];
          steps[stepType].push(entry);
        }

        return {
          id: `iteration-${it}`,
          iteration: it,
          toolName,
          duration,
          startTime: firstEntry.timestamp,
          endTime: lastEntry.timestamp,
          entries: iterEntries,
          steps,
        };
      });

    return {
      preEntries,
      iterations,
      postEntries,
    };
  }, [jobCard, entries]);

  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const formatDate = (ts: string | number) => {
    const date = typeof ts === "number" ? new Date(ts) : new Date(ts);
    if (isNaN(date.getTime())) return "Invalid date";
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatTimestamp = (ts: string | number) => {
    const date = typeof ts === "number" ? new Date(ts) : new Date(ts);
    if (isNaN(date.getTime())) return "Invalid date";
    return date.toISOString().replace(/^.*T/, "").replace(/Z$/, "").slice(0, 12);
  };

  const getStatusIcon = (outcome: string) => {
    if (outcome === "completed") {
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    }
    if (outcome === "failed" || outcome === "error") {
      return <XCircle className="h-4 w-4 text-red-600" />;
    }
    return <Circle className="h-4 w-4 text-gray-400" />;
  };

  const getBadgeClass = (type: string) => {
    const classes: Record<string, string> = {
      INBOUND_REQUEST: "bg-blue-100 text-blue-700 border-blue-200",
      FINAL_RESPONSE: "bg-green-100 text-green-700 border-green-200",
      LLM_TOOL_SELECTION: "bg-orange-100 text-orange-700 border-orange-200",
      TOOL_INPUT: "bg-pink-100 text-pink-700 border-pink-200",
      TOOL_OUTPUT: "bg-indigo-100 text-indigo-700 border-indigo-200",
      TOOL_EXECUTED: "bg-teal-100 text-teal-700 border-teal-200",
      A2A_MESSAGE_SENT: "bg-purple-100 text-purple-700 border-purple-200",
      DOWNSTREAM_REQUEST: "bg-amber-100 text-amber-700 border-amber-200",
      DOWNSTREAM_RESPONSE: "bg-cyan-100 text-cyan-700 border-cyan-200",
      AGENT_DISCOVERY: "bg-yellow-100 text-yellow-700 border-yellow-200",
      GATEWAY: "bg-gray-100 text-gray-700 border-gray-200",
      HTTP_CHUNK: "bg-gray-50 text-gray-600 border-gray-200",
      LLM_NO_TOOL: "bg-gray-50 text-gray-600 border-gray-200",
      OTHER: "bg-gray-50 text-gray-600 border-gray-200",
    };
    return classes[type] || "bg-gray-50 text-gray-600 border-gray-200";
  };

  const handleViewRaw = () => {
    if (!jobCard || !taskId) return;
    openDebugViewer({
      data: {
        jobCard,
        entries,
        treeStructure,
      },
      apiUrl: `/api/task-callstack?orgId=${encodeURIComponent(orgId)}&taskId=${encodeURIComponent(taskId)}`,
      title: `Task Details - ${taskId}`,
    });
  };

  if (!taskId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        Select a task to view its call stack.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        Loading call stack...
      </div>
    );
  }

  if (error) {
    const isEntitlementError = error.includes("Monitoring Center Premium");
    return (
      <div className="flex h-full flex-col items-center justify-center px-4">
        <div className={`rounded-lg border p-4 max-w-md ${isEntitlementError ? "border-amber-300 bg-amber-50" : "border-red-200 bg-red-50"}`}>
          <p className={`text-sm font-semibold mb-2 ${isEntitlementError ? "text-amber-900" : "text-red-900"}`}>
            {isEntitlementError ? "Log Search - Advanced package or a Titanium subscription to Anypoint Platform Required" : "Error"}
          </p>
          {isEntitlementError && (
            <div className="text-xs text-amber-800 mt-2 space-y-1">
              <ul className="list-disc list-inside space-y-0.5">
                <li>Elasticsearch log search APIs</li>
                <li>Enhanced raw storage (up to 128TB based on configuration)</li>
                <li>Advanced logs and traces</li>
                <li>LLM reasoning logs (for Agent Broker monitoring)</li>
              </ul>
              <p className="mt-2 text-amber-700">
                <a 
                  href="https://docs.mulesoft.com/monitoring/#log-search" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="underline hover:text-amber-900"
                >
                  Learn more about log search requirements
                </a>
              </p>
            </div>
          )}
          {!isEntitlementError && (
            <p className={`text-sm text-red-800`}>
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!jobCard || !treeStructure) {
    return null;
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header with view toggle */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-semibold text-gray-900">
            Task {jobCard.taskId}
          </span>
          <div className="flex items-center gap-2">
            {getStatusIcon(jobCard.outcome)}
            <span className={`text-sm font-medium ${jobCard.outcome === "completed" ? "text-green-700" : jobCard.outcome === "failed" ? "text-red-700" : "text-gray-600"}`}>
              {jobCard.outcome || "in progress"}
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Clock className="h-3 w-3" />
            <span>{formatDate(jobCard.startTime)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">View:</span>
          <button
            type="button"
            onClick={() => setViewMode("tree")}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              viewMode === "tree"
                ? "bg-indigo-100 text-indigo-700"
                : "bg-white text-gray-600 hover:bg-gray-100"
            }`}
          >
            Tree
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              viewMode === "list"
                ? "bg-indigo-100 text-indigo-700"
                : "bg-white text-gray-600 hover:bg-gray-100"
            }`}
          >
            List
          </button>
          <button
            type="button"
            onClick={handleViewRaw}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            View raw
          </button>
        </div>
      </div>

      {/* Two-pane layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Pane: Tree/List View */}
        <div className={`${viewMode === "tree" ? "w-1/2" : "w-full"} overflow-y-auto scrollbar-thin border-r border-gray-200`}>
          {viewMode === "tree" ? (
            <TaskDetailsTreeView
              jobCard={jobCard}
              treeStructure={treeStructure}
              expandedNodes={expandedNodes}
              selectedItem={selectedItem}
              onToggleNode={toggleNode}
              onSelectItem={setSelectedItem}
              getBadgeClass={getBadgeClass}
              formatTimestamp={formatTimestamp}
            />
          ) : (
            <TaskDetailsListView
              jobCard={jobCard}
              groupedEntries={treeStructure}
              selectedItem={selectedItem}
              expandedEntries={expandedEntries}
              setExpandedEntries={setExpandedEntries}
              onSelectItem={setSelectedItem}
              getBadgeClass={getBadgeClass}
              formatTimestamp={formatTimestamp}
            />
          )}
        </div>

        {/* Right Pane: Details (only in tree view) */}
        {viewMode === "tree" && (
          <div className="w-1/2 overflow-y-auto scrollbar-thin bg-gray-50">
            {selectedItem != null ? (
              <TaskDetailsPanel
                selectedItem={selectedItem}
                jobCard={jobCard}
                detailTab={detailTab}
                onTabChange={setDetailTab}
                formatDate={formatDate}
                formatTimestamp={formatTimestamp}
                traceSpans={traceSpans}
                logEntries={entries}
                onLogEntrySelect={(entry) => {
                  // Find the entry index and select it
                  const entryIndex = entries.findIndex((e: LogEntry) => e._id === entry._id);
                  if (entryIndex >= 0) {
                    setSelectedItem({ type: "step", id: `entry-${entryIndex}`, data: entry });
                    // Switch to input-output tab when selecting a child entry (traces are task-level only)
                    setDetailTab("input-output");
                    // Expand the entry in list view
                    setExpandedEntries((prev) => new Set([...prev, entryIndex]));
                  }
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                Select an item to view details
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

