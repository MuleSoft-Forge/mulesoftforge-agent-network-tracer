"use client";

import { useState, useEffect, useMemo, use, Suspense, Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
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

interface TaskData {
  jobCard: JobCard;
  entries: LogEntry[];
  traceSpans?: TraceSpan[];
}

/**
 * Helper function to handle API errors and format error messages
 */
async function handleApiError(res: Response): Promise<never> {
  const statusCode = res.status;
  
  // Read response text first, then try to parse as JSON
  let responseText = "";
  try {
    responseText = await res.text();
  } catch (textErr) {
    // If we can't read text, fall back to status code
    if (statusCode === 403) {
      throw new Error("Log Search - Advanced package or a Titanium subscription to Anypoint Platform Required - Elasticsearch log search APIs - Enhanced raw storage (up to 128TB based on configuration) - Advanced logs and traces - LLM reasoning logs (for Agent Broker monitoring)");
    }
    throw new Error(`Failed to fetch: ${statusCode}`);
  }
  
  // Try to parse as JSON
  let data: { error?: string; code?: string; message?: string; details?: unknown } = {};
  try {
    if (responseText.trim()) {
      data = JSON.parse(responseText);
    }
  } catch (jsonErr) {
    // If JSON parsing fails, use the text content if available
    if (responseText.trim()) {
      if (statusCode === 400) {
        throw new Error(`Invalid request: ${responseText.slice(0, 200)}`);
      }
      throw new Error(responseText.slice(0, 200));
    }
    // If no text content, fall back to status code based messages
    if (statusCode === 403) {
      throw new Error("Log Search - Advanced package or a Titanium subscription to Anypoint Platform Required - Elasticsearch log search APIs - Enhanced raw storage (up to 128TB based on configuration) - Advanced logs and traces - LLM reasoning logs (for Agent Broker monitoring)");
    }
    if (statusCode === 400) {
      throw new Error("Invalid request - please check your parameters");
    }
    throw new Error(`Failed to fetch: ${statusCode}`);
  }
  
  // Check for Monitoring Center Premium error specifically
  if (statusCode === 403 && (data.code === "MONITORING_CENTER_PREMIUM_REQUIRED" || data.error?.includes("Monitoring Center Premium"))) {
    const errorMessage = data.message || data.error || "Log Search - Advanced package or a Titanium subscription to Anypoint Platform Required - Elasticsearch log search APIs - Enhanced raw storage (up to 128TB based on configuration) - Advanced logs and traces - LLM reasoning logs (for Agent Broker monitoring)";
    throw new Error(errorMessage);
  }
  
  // Handle 400 Bad Request with better error messages
  if (statusCode === 400) {
    const errorMessage = data.error || data.message || "Invalid request";
    
    // Format Zod validation errors into a user-friendly message
    let formattedDetails = "";
    if (data.details && typeof data.details === "object") {
      const details = data.details as Record<string, { _errors?: string[] }>;
      const fieldErrors: string[] = [];
      
      for (const [field, value] of Object.entries(details)) {
        if (value && typeof value === "object" && Array.isArray(value._errors) && value._errors.length > 0) {
          fieldErrors.push(`${field}: ${value._errors.join(", ")}`);
        }
      }
      
      if (fieldErrors.length > 0) {
        formattedDetails = ` - ${fieldErrors.join("; ")}`;
      }
    }
    
    throw new Error(`${errorMessage}${formattedDetails}`);
  }
  
  // For other errors, use the error message from the response
  throw new Error(data.error || data.message || `Failed to fetch: ${statusCode}`);
}

/**
 * Content component that uses React 19's use() hook for data fetching
 */
function TaskDetailsContent({ orgId, taskId, envId, taskResource }: TaskDetailsProps & { taskResource: Promise<TaskData> }) {
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(["task"]));
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set());
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("input-output");
  const { openDebugViewer } = useDebugViewer();

  // Use React 19's use() hook - this will suspend if the promise is pending
  const data = use(taskResource);

  const { jobCard, entries, traceSpans = [] } = data;

  // Auto-select task on load
  useEffect(() => {
    if (jobCard && !selectedItem) {
      setSelectedItem({
        type: "task",
        id: "task",
        data: jobCard,
      });
    }
  }, [jobCard, selectedItem]);

  // When selectedItem changes to a non-task item, switch away from traces tab if needed
  useEffect(() => {
    if (selectedItem != null && selectedItem.type !== "task" && detailTab === "traces") {
      setDetailTab("input-output");
    }
  }, [selectedItem, detailTab]);

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

  if (!treeStructure) {
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

/**
 * Error boundary component for handling API errors
 */
function TaskDetailsError({ error, orgId, taskId, envId }: { error: Error; orgId: string; taskId: string | null; envId?: string }) {
  const isEntitlementError = error.message.includes("Monitoring Center Premium") || error.message.includes("Log Search - Advanced package");
  
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
            {error.message}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Main component with Suspense boundary and error handling
 */
export default function TaskDetails({ orgId, taskId, envId }: TaskDetailsProps) {
  // Create promise resource (memoized) - React 19 pattern
  const taskResource = useMemo(() => {
    if (!orgId || !taskId) {
      return null;
    }
    
    const url = `/api/task-callstack?orgId=${encodeURIComponent(orgId)}&taskId=${encodeURIComponent(taskId)}${envId ? `&envId=${encodeURIComponent(envId)}` : ""}`;
    
    return fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          return handleApiError(res);
        }
        return res.json() as Promise<TaskData>;
      })
      .catch((err) => {
        console.error("Error fetching task call stack:", err);
        // Re-throw to be caught by error boundary
        throw err;
      });
  }, [orgId, taskId, envId]);

  // Handle case when no taskId is selected
  if (!taskId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        Select a task to view its call stack.
      </div>
    );
  }

  // Handle case when resource is null (shouldn't happen if taskId exists, but type-safe)
  if (!taskResource) {
    return null;
  }

  // Wrap content with Suspense and error boundary
  return (
    <ErrorBoundary
      fallback={(error) => <TaskDetailsError error={error} orgId={orgId} taskId={taskId} envId={envId} />}
    >
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            Loading call stack...
          </div>
        }
      >
        <TaskDetailsContent orgId={orgId} taskId={taskId} envId={envId} taskResource={taskResource} />
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * Simple error boundary component for React 19
 * Note: In a production app, you might want to use react-error-boundary library
 */
class ErrorBoundary extends Component<
  { children: ReactNode; fallback: (error: Error) => ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode; fallback: (error: Error) => ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("TaskDetails error:", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error);
    }
    return this.props.children;
  }
}

