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
  /** Broker API instance ID (from selected broker); in no-entitlement mode used to fetch details from same deployment that listed tasks */
  apiInstanceId?: string | null;
  /** When true, task-callstack API will not fetch trace spans (e.g. no-entitlement mode) */
  skipTraces?: boolean;
}

interface TaskData {
  jobCard: JobCard;
  entries: LogEntry[];
  traceSpans?: TraceSpan[];
  /** Present when task details were loaded in no-entitlement mode (runtime logs) */
  mode?: "entitlement" | "no-entitlement";
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
  const [detailTab, setDetailTab] = useState<DetailTab>("apiStatus");
  const { openDebugViewer } = useDebugViewer();

  // Use React 19's use() hook - this will suspend if the promise is pending
  const data = use(taskResource);

  const { jobCard, entries, traceSpans = [], mode } = data;
  const isNoEntitlement = mode === "no-entitlement";

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

  // When selectedItem changes to a non-task item, or when there are no traces (e.g. no-entitlement mode), switch away from traces tab
  useEffect(() => {
    if (detailTab === "traces" && (selectedItem == null || selectedItem.type !== "task" || traceSpans.length === 0)) {
      setDetailTab(selectedItem?.type === "task" ? "apiStatus" : "message");
    }
  }, [selectedItem, detailTab, traceSpans.length]);

  // API status tab is only for task; when viewing iteration/step switch to message
  useEffect(() => {
    if (detailTab === "apiStatus" && selectedItem != null && selectedItem.type !== "task") {
      setDetailTab("message");
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

    // Assign "Resuming from iteration N" (iteration 0) entries to that iteration so they appear in the right place
    const fromIterMatch = (entry: LogEntry): string | null => {
      const msg = (entry.raw?.message as string) || "";
      const m = msg.match(/from iteration\s+(\d+)/i);
      return m ? m[1]! : null;
    };
    const remainingNoIter: LogEntry[] = [];
    for (const e of noIterEntries) {
      const targetIter = fromIterMatch(e);
      if (targetIter) {
        if (!groups[targetIter]) groups[targetIter] = [];
        groups[targetIter].push(e);
      } else {
        remainingNoIter.push(e);
      }
    }

    // Fill missing iterations 1..jobCard.iterations so every iteration has a slot (e.g. iteration 2 with no tool logs)
    const maxIter = Math.max(jobCard.iterations || 0, ...Object.keys(groups).map((k) => parseInt(k, 10)));
    for (let i = 1; i <= maxIter; i++) {
      const key = String(i);
      if (!groups[key]) groups[key] = [];
    }

    const toMs = (ts: string | number | undefined): number =>
      ts == null ? 0 : typeof ts === "number" ? ts : new Date(ts).getTime();

    // Extract request path from an entry (GATEWAY raw.message JSON or DOWNSTREAM_REQUEST message text)
    const getPathFromEntry = (entry: LogEntry): string | null => {
      const raw = entry.raw;
      const msg = raw?.message;
      if (typeof msg === "string") {
        try {
          const parsed = JSON.parse(msg) as { requestPath?: string; requestUri?: string; headers?: { ":path"?: string; path?: string } };
          const path = parsed?.requestPath ?? parsed?.requestUri ?? parsed?.headers?.[":path"] ?? parsed?.headers?.path;
          return typeof path === "string" ? path : null;
        } catch {
          // Not JSON; may be HTTP message - look for path-like pattern
          const m = msg.match(/(?:GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s]+)/);
          return m ? m[1]! : null;
        }
      }
      return null;
    };

    // From a path like "/orgId/aws-oms-agent/aws-oms-agent-connection/..." return agent segment e.g. "aws-oms-agent"
    const getAgentSegment = (path: string): string | null => {
      const segments = path.split("/").filter(Boolean);
      const agentSegment = segments.find((s) => s.includes("agent") || s.includes("oms")) ?? segments[1] ?? segments[0];
      return agentSegment?.toLowerCase() ?? null;
    };

    // Compute each iteration's time range and agent path signatures from DOWNSTREAM_REQUEST entries
    const iterKeys = Object.keys(groups).sort((a, b) => parseInt(a) - parseInt(b));
    const iterRanges: { key: string; startMs: number; endMs: number }[] = [];
    const iterAgentSegments: Record<string, Set<string>> = {};

    for (const key of iterKeys) {
      const list = groups[key];
      iterAgentSegments[key] = new Set();
      if (list.length === 0) {
        iterRanges.push({ key, startMs: 0, endMs: 0 });
        continue;
      }
      let startMs = Infinity;
      let endMs = -Infinity;
      for (const e of list) {
        const ms = toMs(e.timestamp);
        if (ms > 0) {
          startMs = Math.min(startMs, ms);
          endMs = Math.max(endMs, ms);
        }
        if (e.type === "DOWNSTREAM_REQUEST") {
          const path = getPathFromEntry(e);
          if (path) {
            const seg = getAgentSegment(path);
            if (seg) iterAgentSegments[key].add(seg);
          }
        }
      }
      iterRanges.push({ key, startMs: startMs === Infinity ? 0 : startMs, endMs: endMs === -Infinity ? 0 : endMs });
    }

    const firstStart = iterRanges[0]?.startMs ?? 0;
    const lastEnd = iterRanges.length > 0 ? iterRanges[iterRanges.length - 1]!.endMs : 0;

    // Prefer agent/path match for GATEWAY entries, then fall back to time
    const getIterationByAgent = (entry: LogEntry): string | null => {
      const path = getPathFromEntry(entry);
      if (!path) return null;
      const seg = getAgentSegment(path);
      if (!seg) return null;
      for (const key of iterKeys) {
        if (iterAgentSegments[key]?.has(seg)) return key;
      }
      return null;
    };

    // Inject remaining no-iteration entries (e.g. GATEWAY) by agent/path when possible, else by time
    const preEntries: LogEntry[] = [];
    const postEntries: LogEntry[] = [];

    for (const e of remainingNoIter) {
      const t = toMs(e.timestamp);

      // GATEWAY (and similar) entries: try to assign by agent/path first
      if (e.type === "GATEWAY") {
        const agentIter = getIterationByAgent(e);
        if (agentIter) {
          groups[agentIter].push(e);
          continue;
        }
      }

      if (t <= 0) {
        postEntries.push(e);
        continue;
      }
      if (firstStart > 0 && t < firstStart) {
        preEntries.push(e);
        continue;
      }
      if (lastEnd > 0 && t > lastEnd) {
        postEntries.push(e);
        continue;
      }
      let assigned = false;
      for (const { key, startMs, endMs } of iterRanges) {
        if (startMs <= t && t <= endMs) {
          groups[key].push(e);
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        for (const { key, startMs } of iterRanges) {
          if (startMs >= t) {
            groups[key].push(e);
            assigned = true;
            break;
          }
        }
        if (!assigned) postEntries.push(e);
      }
    }

    // Sort each iteration's entries by timestamp so order is chronological (incl. injected gateway logs)
    for (const key of iterKeys) {
      groups[key].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
    }

    // Build iterations with steps (include empty iterations so e.g. iteration 2 is shown)
    const iterations = Object.keys(groups)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map((it) => {
        const iterEntries = groups[it];
        const firstEntry = iterEntries[0];
        const lastEntry = iterEntries[iterEntries.length - 1];
        const startTime = firstEntry
          ? (typeof firstEntry.timestamp === "number" ? firstEntry.timestamp : new Date(firstEntry.timestamp).getTime())
          : 0;
        const endTime = lastEntry
          ? (typeof lastEntry.timestamp === "number" ? lastEntry.timestamp : new Date(lastEntry.timestamp).getTime())
          : 0;
        const duration = iterEntries.length > 0 ? ((endTime - startTime) / 1000).toFixed(1) : "0";

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
          startTime: firstEntry?.timestamp ?? "",
          endTime: lastEntry?.timestamp ?? "",
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
    const ms =
      typeof ts === "number"
        ? ts
        : /^\d+$/.test(String(ts))
          ? parseInt(String(ts), 10)
          : new Date(ts).getTime();
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "Invalid date";
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
    const ms =
      typeof ts === "number"
        ? ts
        : /^\d+$/.test(String(ts))
          ? parseInt(String(ts), 10)
          : new Date(ts).getTime();
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "Invalid date";
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
                isNoEntitlement={isNoEntitlement}
                onLogEntrySelect={(entry) => {
                  // Find the entry index and select it
                  const entryIndex = entries.findIndex((e: LogEntry) => e._id === entry._id);
                  if (entryIndex >= 0) {
                    setSelectedItem({ type: "step", id: `entry-${entryIndex}`, data: entry });
                    // Switch to message tab when selecting a child entry (traces are task-level only)
                    setDetailTab("message");
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
function TaskDetailsError({ error }: { error: Error; orgId: string; taskId: string | null; envId?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 max-w-md">
        <p className="text-sm font-semibold text-red-900 mb-2">Error</p>
        <p className="text-sm text-red-800">{error.message}</p>
      </div>
    </div>
  );
}

/**
 * Main component with Suspense boundary and error handling
 */
export default function TaskDetails({ orgId, taskId, envId, apiInstanceId, skipTraces }: TaskDetailsProps) {
  // Create promise resource (memoized) - React 19 pattern
  const taskResource = useMemo(() => {
    if (!orgId || !taskId) {
      return null;
    }
    
    const url = `/api/task-callstack?orgId=${encodeURIComponent(orgId)}&taskId=${encodeURIComponent(taskId)}${envId ? `&envId=${encodeURIComponent(envId)}` : ""}${apiInstanceId ? `&apiInstanceId=${encodeURIComponent(apiInstanceId)}` : ""}${skipTraces ? "&skipTraces=true" : ""}`;
    
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
  }, [orgId, taskId, envId, apiInstanceId, skipTraces]);

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

