"use client";

import { useState, useEffect, useMemo, use, Suspense, Component, useRef } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { ChevronRight, ChevronDown, Clock, CheckCircle2, XCircle, Circle, RotateCw } from "lucide-react";
import { debugError } from "@/lib/api-logger";
import TaskDetailsPanel from "@/components/task-details/TaskDetailsPanel";
import TaskDetailsTreeView from "@/components/task-details/TaskDetailsTreeView";
import TaskDetailsListView from "@/components/task-details/TaskDetailsListView";
import NodeTimelineView from "@/components/task-details/NodeTimelineView";
import GraphExecutionView from "@/components/task-details/GraphExecutionView";
import type { JobCard, LogEntry, TreeStructure, ViewMode, DetailTab, SelectedItem, TraceSpan, TaskStory, NodeVisit } from "@/components/task-details/types";
import { deriveIterationLabel } from "@/lib/broker-tasks/iteration-label";
import { detectBrokerFormat } from "@/lib/task-timeline/broker-format";
import { buildV2NodeTimeline } from "@/lib/task-timeline/build-v2-node-timeline";
import {
  buildExecutionOverlay,
  createNodeKeyResolver,
  findDriftedNodes,
} from "@/lib/task-timeline/execution-overlay";
import { loadFirstAvailableTaskAgentGraph } from "@/lib/task-timeline/load-task-agent-graph";
import type { TaskAgentGraph } from "@/lib/task-timeline/load-task-agent-graph";
import Spinner from "@/components/Spinner";
import type { TaskQueryHints } from "@/components/TasksList";

interface TaskDetailsProps {
  orgId: string;
  taskId: string | null;
  envId?: string;
  /** Broker API instance ID (from selected broker); in no-entitlement mode used to fetch details from same deployment that listed tasks */
  apiInstanceId?: string | null;
  /** When true, task-callstack API will not fetch trace spans (e.g. no-entitlement mode) */
  skipTraces?: boolean;
  /** What the task list already knows, used to scope the server-side log query. */
  hints?: TaskQueryHints | null;
}

interface TaskData {
  jobCard: JobCard;
  entries: LogEntry[];
  traceSpans?: TraceSpan[];
  /** Present when task details were loaded in no-entitlement mode (runtime logs) */
  mode?: "entitlement" | "no-entitlement";
}

interface TaskUnavailableData {
  unavailable: true;
  code: "MONITORING_CENTER_PREMIUM_REQUIRED";
  message: string;
}

type TaskResourceData = TaskData | TaskUnavailableData;
const GRAPH_LOAD_TIMEOUT_MS = 12_000;

/**
 * Helper function to handle API errors and format error messages
 */
async function handleApiError(res: Response): Promise<TaskUnavailableData> {
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
    return {
      unavailable: true,
      code: "MONITORING_CENTER_PREMIUM_REQUIRED",
      message: errorMessage,
    };
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

/** A story is worth defaulting to if it reconstructed any semantic content. */
function taskStoryHasContent(story: TaskStory | undefined): story is TaskStory {
  if (!story) return false;
  return (
    story.history.length > 0 ||
    story.artifacts.length > 0 ||
    story.stateEntries.length > 0 ||
    Boolean(story.statusState || story.statusText)
  );
}

/**
 * Render resolved task data.
 */
function TaskDetailsContent({ orgId, taskId, envId, data }: TaskDetailsProps & { data: TaskData }) {
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    detectBrokerFormat(data.jobCard, data.entries) === "v2" ? "graph" : "tree"
  );
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(["task"]));
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set());
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  // Default tab is format-aware: v2 brokers lead with the decoded Task story
  // (conversation + artifacts + final status) when it reconstructed content;
  // otherwise fall back to the API status overview (unchanged for v1).
  const [detailTab, setDetailTab] = useState<DetailTab>(() => {
    const fmt = detectBrokerFormat(data.jobCard, data.entries);
    if (fmt === "v2" && taskStoryHasContent(data.jobCard?.objectStore?.taskStory)) {
      return "story";
    }
    return "apiStatus";
  });
  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(50); // Percentage
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { jobCard, entries, traceSpans = [], mode } = data;
  const isNoEntitlement = mode === "no-entitlement";

  // v1 keeps the frozen iteration/step tree. v2 gets a native node-graph spine
  // reconstructed from the graph-runtime logs (+ Object Store state).
  const brokerFormat = useMemo(() => detectBrokerFormat(jobCard, entries), [jobCard, entries]);
  const v2Timeline = useMemo(
    () =>
      brokerFormat === "v2"
        ? buildV2NodeTimeline(entries, jobCard?.objectStore?.taskStory)
        : null,
    [brokerFormat, entries, jobCard]
  );

  // Tree and Graph both pair a left spine with the shared detail pane; List owns
  // the full width.
  const isSplitView = viewMode === "tree" || viewMode === "graph";

  // The published AgentScript definition is the graph's structure. Fetching it
  // means an Exchange round trip and a parse, so it is deferred until the Graph
  // view is actually opened rather than paid for by every task detail.
  const [agentGraph, setAgentGraph] = useState<TaskAgentGraph | null>(null);
  const [agentGraphError, setAgentGraphError] = useState<string | null>(null);

  const graphNodeIds = useMemo(
    () => agentGraph?.graph.nodes.map((node) => node.id) ?? [],
    [agentGraph]
  );
  const graphEdges = useMemo(() => agentGraph?.graph.edges ?? [], [agentGraph]);

  // Resolves names the graph runtime logs onto the drawn graph's nodes, so a
  // runtime alias such as "node 1" lands on the trigger it means.
  const resolveNodeKey = useMemo(() => createNodeKeyResolver(graphNodeIds), [graphNodeIds]);

  // What this invocation did, keyed by node. Derived from the same visits as the
  // timeline, so the two views can never disagree about the path.
  const executionOverlay = useMemo(
    () =>
      v2Timeline
        ? buildExecutionOverlay(v2Timeline.visits, graphNodeIds, v2Timeline.reachedFromState, graphEdges)
        : null,
    [v2Timeline, graphNodeIds, graphEdges]
  );

  // The canvas keys nodes by name while selection is keyed by visit id, so
  // translate to keep the selected card highlighted after a click.
  const selectedGraphNodeKey = useMemo(() => {
    if (selectedItem?.type !== "node") return null;
    const visit = selectedItem.data as NodeVisit | undefined;
    return visit?.nodeName != null ? resolveNodeKey(visit.nodeName) : null;
  }, [selectedItem, resolveNodeKey]);

  // Read as primitives so the effect below re-runs only when an input really
  // changes; jobCard is a fresh object on every fetch and would otherwise restart
  // the load continuously.
  const graphAssetId = jobCard?.assetId?.trim() ?? "";
  const graphSourceAssetId = jobCard?.sourceAssetId?.trim() ?? "";
  const graphAppId = jobCard?.appId?.trim() ?? "";
  const graphBroker = jobCard?.broker?.trim() ?? "";
  const graphApiName = jobCard?.apiName?.trim() ?? "";
  const graphAssetVersion = jobCard?.assetVersion?.trim() ?? "";
  const graphSourceVersion = jobCard?.sourceVersion?.trim() ?? "";
  const graphStartTime = jobCard?.startTime ?? "";

  /**
   * Identifies the definition this view needs. Every value the load depends on is
   * part of it, so a change always produces a new key and never leaves a started
   * request unable to restart. A loaded graph is only ever shown for the key it
   * was fetched for, so switching tasks cannot display the previous one's graph.
   */
  const graphRequestKey = [
    orgId,
    taskId,
    graphAssetId,
    graphSourceAssetId,
    graphAppId,
    graphSourceVersion,
    graphAssetVersion,
    graphBroker,
    graphApiName,
    graphStartTime,
  ].join("|");
  useEffect(() => {
    if (viewMode !== "graph") return;

    setAgentGraph(null);
    setAgentGraphError(null);

    // API Manager metadata.source is the runtime-deployed identity and is more
    // trustworthy than inferred app/log labels.
    const assetIds = [graphSourceAssetId, graphAssetId, graphAppId].filter((id) => id !== "");
    const candidateNames = [graphBroker, graphSourceAssetId, graphAssetId, graphAppId, graphApiName].filter(
      (name) => name !== ""
    );
    // Tasks do not record the asset version, so it is inferred from when the task
    // ran; the view says so, because a later edit would otherwise be drawn as if
    // it were what executed.
    const startedAt = graphStartTime !== "" ? Date.parse(graphStartTime) : NaN;

    let cancelled = false;
    const loadGraphPromise = loadFirstAvailableTaskAgentGraph({
      orgId,
      assetIds,
      ...((graphSourceVersion !== "" ? { pinnedVersion: graphSourceVersion } : graphAssetVersion !== "" ? { pinnedVersion: graphAssetVersion } : {})),
      ...(Number.isFinite(startedAt) ? { taskStartedAtMs: startedAt } : {}),
      candidateNames,
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `Graph load timed out after ${GRAPH_LOAD_TIMEOUT_MS / 1000}s. ` +
              "Please retry or switch to Tree; this does not affect task detail data."
          )
        );
      }, GRAPH_LOAD_TIMEOUT_MS);
      // Avoid dangling timer when load resolves/rejects first.
      void loadGraphPromise.finally(() => clearTimeout(timeoutHandle));
    });

    Promise.race([loadGraphPromise, timeoutPromise])
      .then((loaded) => {
        if (!cancelled) setAgentGraph(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAgentGraphError(
          error instanceof Error ? error.message : "Could not load the network's AgentScript source."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    viewMode,
    graphRequestKey,
    orgId,
    graphAssetId,
    graphSourceAssetId,
    graphAppId,
    graphBroker,
    graphApiName,
    graphSourceVersion,
    graphAssetVersion,
    graphStartTime,
  ]);

  const driftedNodes = useMemo(
    () =>
      executionOverlay != null && agentGraph != null
        ? findDriftedNodes(executionOverlay, graphNodeIds)
        : [],
    [executionOverlay, agentGraph, graphNodeIds]
  );

  // Auto-select task on load; keep task selection in sync with latest jobCard when task data changes
  useEffect(() => {
    if (!jobCard) return;
    if (!selectedItem) {
      setSelectedItem({
        type: "task",
        id: "task",
        data: jobCard,
      });
      return;
    }
    if (selectedItem.type === "task" && selectedItem.data !== jobCard) {
      setSelectedItem({
        type: "task",
        id: "task",
        data: jobCard,
      });
    }
  }, [jobCard, selectedItem]);

  // Trace details apply only to the task itself. Keep the tab available for a
  // selected task even when no spans were returned so its status is visible.
  useEffect(() => {
    if (
      (detailTab === "traces" || detailTab === "story" || detailTab === "reasoning") &&
      selectedItem != null &&
      selectedItem.type !== "task"
    ) {
      setDetailTab("message");
    }
  }, [selectedItem, detailTab]);

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

        const toolName = deriveIterationLabel(iterEntries);

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

  // Handle resizing the split pane
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
      // Constrain between 20% and 80%
      const constrainedWidth = Math.max(20, Math.min(80, newLeftWidth));
      setLeftPaneWidth(constrainedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

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
          {brokerFormat === "v2" && executionOverlay != null && (
            <button
              type="button"
              onClick={() => setViewMode("graph")}
              title="The path this task took through the broker's AgentScript node graph"
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                viewMode === "graph"
                  ? "bg-indigo-100 text-indigo-700"
                  : "bg-white text-gray-600 hover:bg-gray-100"
              }`}
            >
              Graph
            </button>
          )}
        </div>
      </div>

      {/* Two-pane layout */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden relative">
        {/* Left Pane: Tree/Graph/List View */}
        <div
          className={`${isSplitView ? "" : "w-full"} ${
            // The graph is a fixed-size canvas that pans internally; letting the
            // pane scroll instead would collapse its height to nothing.
            viewMode === "graph" ? "overflow-hidden" : "overflow-y-auto scrollbar-thin"
          } ${isSplitView ? "border-r border-gray-200" : ""}`}
          style={isSplitView ? { width: `${leftPaneWidth}%` } : {}}
        >
          {viewMode === "graph" && executionOverlay ? (
            agentGraph != null ? (
              <GraphExecutionView
                graph={agentGraph.graph}
                overlay={executionOverlay}
                source={{
                  agentFileName: agentGraph.agentFileName,
                  version: agentGraph.version,
                  versionPinned: agentGraph.versionPinned,
                  ...(agentGraph.brokerKey != null ? { brokerKey: agentGraph.brokerKey } : {}),
                }}
                driftedNodes={driftedNodes}
                selectedNodeKey={selectedGraphNodeKey}
                onSelectVisit={(visit) =>
                  setSelectedItem({ type: "node", id: visit.id, data: visit })
                }
                insecureLoggingEnabled={jobCard?.apiStatus?.monitoringSuggestions?.insecureLogging}
              />
            ) : agentGraphError != null ? (
              <div className="flex h-full items-center justify-center px-6">
                <div className="max-w-md space-y-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <p className="font-semibold">The network&apos;s graph could not be shown</p>
                  <p>{agentGraphError}</p>
                  <p className="text-amber-700">
                    This view draws the broker&apos;s published AgentScript definition and overlays
                    the path this task took, so it needs that definition from Exchange. The Tree
                    view still shows the same execution as an ordered node timeline.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <Spinner
                  size="m"
                  className="border-t-[#00A2FF] border-l-transparent border-r-transparent border-b-transparent"
                />
              </div>
            )
          ) : viewMode !== "list" ? (
            brokerFormat === "v2" && v2Timeline ? (
              <NodeTimelineView
                jobCard={jobCard}
                timeline={v2Timeline}
                selectedItem={selectedItem}
                onSelectItem={setSelectedItem}
                getBadgeClass={getBadgeClass}
                formatTimestamp={formatTimestamp}
              />
            ) : (
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
            )
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

        {/* Resizable divider (split views only) */}
        {isSplitView && (
          <div
            onMouseDown={handleMouseDown}
            className={`absolute top-0 bottom-0 w-1 cursor-col-resize bg-gray-200 hover:bg-indigo-400 transition-colors z-10 ${
              isResizing ? "bg-indigo-500" : ""
            }`}
            style={{ left: `${leftPaneWidth}%`, transform: "translateX(-50%)" }}
            title="Drag to resize"
          />
        )}

        {/* Right Pane: Details (split views only) */}
        {isSplitView && (
          <div
            className="overflow-y-auto scrollbar-thin bg-gray-50"
            style={{ width: `${100 - leftPaneWidth}%` }}
          >
            {selectedItem != null ? (
              <TaskDetailsPanel
                selectedItem={selectedItem}
                jobCard={jobCard}
                detailTab={detailTab}
                onTabChange={setDetailTab}
                onSelectTask={() => setSelectedItem({ type: "task", id: "task", data: jobCard })}
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

function TaskDetailsResource({
  orgId,
  taskId,
  envId,
  apiInstanceId,
  skipTraces,
  taskResource,
}: TaskDetailsProps & { taskResource: Promise<TaskResourceData> }) {
  const result = use(taskResource);

  if ("unavailable" in result) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4">
        <div className="max-w-lg rounded-lg border border-amber-200 bg-amber-50 p-5">
          <p className="mb-2 text-sm font-semibold text-amber-900">
            Task details unavailable
          </p>
          <p className="text-sm text-amber-800">{result.message}</p>
          <p className="mt-3 text-xs text-amber-700">
            Runtime-log fallback did not find this task. This is an entitlement
            limitation, not an application crash.
          </p>
        </div>
      </div>
    );
  }

  return (
    <TaskDetailsContent
      orgId={orgId}
      taskId={taskId}
      envId={envId}
      apiInstanceId={apiInstanceId}
      skipTraces={skipTraces}
      data={result}
    />
  );
}

/**
 * Only in-flight requests are shared here; completed responses are deliberately
 * not retained. The platform's log pipeline trails a task by roughly 20s, so a
 * detail opened straight after an invocation is legitimately incomplete, and
 * caching that would make the user's natural re-check replay the same gap.
 * Sharing the in-flight promise still collapses concurrent opens of one task
 * (re-render, rapid re-select) into a single request.
 */
const inFlightTaskDetails = new Map<string, Promise<TaskResourceData>>();

/**
 * The API validates these as ISO-8601. Task rows carry whatever the log pipeline
 * produced, so anything unparseable is dropped rather than sent and rejected.
 */
function toIsoOrUndefined(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/**
 * Main component with Suspense boundary and error handling
 */
export default function TaskDetails({ orgId, taskId, envId, apiInstanceId, skipTraces, hints }: TaskDetailsProps) {
  // Bumped by Refresh. The platform's log pipeline trails a task by roughly 20s,
  // so a detail opened immediately after an invocation can be legitimately empty
  // and the only fix is asking again a moment later.
  const [reloadNonce, setReloadNonce] = useState(0);

  // Create promise resource (memoized) - React 19 pattern
  const taskResource = useMemo(() => {
    if (!orgId || !taskId) {
      return null;
    }

    const params = new URLSearchParams({ orgId, taskId });
    if (envId) params.set("envId", envId);
    if (apiInstanceId) params.set("apiInstanceId", apiInstanceId);
    if (skipTraces) params.set("skipTraces", "true");
    // Scoping hints — the route works without them, they just keep it from
    // scanning 30 days of the whole tenant's logs for this one taskId.
    if (hints?.appId) params.set("appId", hints.appId);
    if (hints?.startTime) params.set("startTime", toIsoOrUndefined(hints.startTime) ?? "");
    if (hints?.endTime) params.set("endTime", toIsoOrUndefined(hints.endTime) ?? "");
    for (const key of ["startTime", "endTime"]) {
      if (params.get(key) === "") params.delete(key);
    }
    const url = `/api/task-callstack?${params.toString()}`;

    // Refreshing deliberately changes the key so an explicit re-check starts its
    // own request instead of joining the one whose result the user just rejected.
    const inFlightKey = `${reloadNonce}:${url}`;
    const alreadyRunning = inFlightTaskDetails.get(inFlightKey);
    if (alreadyRunning) {
      return alreadyRunning;
    }

    // Never serve this from the browser HTTP cache either: task diagnostics must
    // reflect live backend state (Object Store, traces) on every open, otherwise a
    // stale response can mask a fresh lookup (e.g. after a server restart).
    const promise = fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          return handleApiError(res);
        }
        return res.json() as Promise<TaskData>;
      })
      .catch((err) => {
        debugError("Error fetching task call stack:", err);
        // Re-throw to be caught by error boundary
        throw err;
      })
      .finally(() => {
        inFlightTaskDetails.delete(inFlightKey);
      });

    inFlightTaskDetails.set(inFlightKey, promise);
    return promise;
  }, [orgId, taskId, envId, apiInstanceId, skipTraces, hints?.appId, hints?.startTime, hints?.endTime, reloadNonce]);

  // Handle case when no taskId is selected
  if (!taskId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        Select a task to view its call stack.
      </div>
    );
  }

  // Synthetic error tasks (err-*) have no real callstack — show error info
  if (taskId.startsWith("err-")) {
    const ts = parseInt(taskId.replace("err-", ""), 10);
    const when = Number.isFinite(ts) ? new Date(ts).toLocaleString() : "Unknown time";
    return (
      <div className="flex h-full flex-col items-center justify-center px-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 max-w-lg">
          <p className="text-sm font-semibold text-red-900 mb-2">Broker Error</p>
          <p className="text-xs text-red-800 mb-3">
            The broker attempted to run at <span className="font-medium">{when}</span> but
            failed before completing a task. No call stack is available for error-only runs.
          </p>
          <p className="text-xs text-gray-600">
            This typically means the broker received a request but timed out or encountered an
            internal error (e.g. <code className="text-[11px] bg-red-100 px-1 rounded">MonoDeferContextual</code> timeout)
            before it could dispatch to an agent or execute any tools.
          </p>
        </div>
      </div>
    );
  }

  // Handle case when resource is null (shouldn't happen if taskId exists, but type-safe)
  if (!taskResource) {
    return null;
  }

  // Wrap content with Suspense and error boundary
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-end border-b border-gray-100 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setReloadNonce((n) => n + 1)}
          title="Re-query logs, Object Store and traces for this task"
          className="flex items-center gap-1.5 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
        >
          <RotateCw className="h-3 w-3" />
          Refresh
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ErrorBoundary
          key={`${taskId}:${reloadNonce}`}
          fallback={(error) => <TaskDetailsError error={error} orgId={orgId} taskId={taskId} envId={envId} />}
        >
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Spinner size="m" className="border-t-[#00A2FF] border-l-transparent border-r-transparent border-b-transparent" />
              </div>
            }
          >
            <TaskDetailsResource
              key={taskId}
              orgId={orgId}
              taskId={taskId}
              envId={envId}
              apiInstanceId={apiInstanceId}
              skipTraces={skipTraces}
              taskResource={taskResource}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
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
    debugError("TaskDetails error:", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error);
    }
    return this.props.children;
  }
}

