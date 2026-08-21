"use client";

import type { ApiStatus, JobCard, LogEntry, DetailTab, SelectedItem, TraceSpan, TaskStory, NodeVisit } from "./types";
import TraceVisualization from "./TraceVisualization";
import LLMReasoningPanel from "./LLMReasoningPanel";
import TaskStoryView from "./TaskStoryView";
import ObjectStoreRetentionTip from "./ObjectStoreRetentionTip";

/** A story is worth showing if it reconstructed any semantic content. */
function taskStoryHasContent(story: TaskStory | undefined): story is TaskStory {
  if (!story) return false;
  return (
    story.history.length > 0 ||
    story.artifacts.length > 0 ||
    story.stateEntries.length > 0 ||
    Boolean(story.statusState || story.statusText)
  );
}

// Helper function to format JSON strings
function formatJsonIfPossible(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // Not valid JSON, return as-is
      return value;
    }
  }
  if (typeof value === "object") {
    // Already an object, format it
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// Helper function to format raw message nicely
function formatRawMessage(rawMessage: string | undefined): string {
  if (!rawMessage) {
    return "";
  }

  // Try to extract and format JSON-RPC payloads
  const jsonRpcMatch = rawMessage.match(/\{"jsonrpc"[\s\S]*\}/);
  if (jsonRpcMatch) {
    try {
      const rpc = JSON.parse(jsonRpcMatch[0]);
      if (rpc.params?.message) {
        // Format the message params nicely
        const formatted = JSON.stringify(rpc, null, 2);
        return formatted;
      }
    } catch {
      // Continue to other formatting attempts
    }
  }

  // Try to extract JSON from HTTP body
  const jsonMatch = rawMessage.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // Continue to HTTP formatting
    }
  }

  // Try to format HTTP request/response
  if (rawMessage.includes("HTTP/1.1") || rawMessage.includes("LISTENER") || rawMessage.includes("REQUESTER")) {
    // Format HTTP messages with better line breaks
    return rawMessage
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line, idx, arr) => {
        // Add spacing between headers and body
        if (idx > 0 && line.trim() === "" && arr[idx - 1]?.trim() !== "") {
          return "\n";
        }
        return line;
      })
      .join("\n");
  }

  // Default: return as-is
  return rawMessage;
}

/** Human-readable label and optional badge color for API status values */
function apiStatusLabel(
  api: keyof ApiStatus,
  value: string
): { label: string; ok: boolean } {
  const labels: Record<string, Record<string, { label: string; ok: boolean }>> = {
    logSearch: {
      ok: { label: "200 OK", ok: true },
      "403_entitlement": { label: "403 Entitlement (Monitoring Center Premium required)", ok: false },
      "403_unauthorized": { label: "403 Unauthorized", ok: false },
      "404_unavailable": {
        label: "404 Not Found (_msearch not available for this account — using runtime logs)",
        ok: false,
      },
      error: { label: "Error", ok: false },
    },
    objectStore: {
      ok: { label: "200 OK", ok: true },
      "403_forbidden": { label: "403 Forbidden", ok: false },
      no_store: { label: "No object store found", ok: false },
      no_keys: { label: "Object store found but no keys", ok: false },
      skipped: { label: "Skipped", ok: true },
      error: { label: "Error", ok: false },
    },
    deploymentApi: {
      ok: { label: "200 OK", ok: true },
      "403_forbidden": { label: "403 Forbidden (e.g. Read Applications scope)", ok: false },
      not_used: { label: "Not used", ok: true },
      error: { label: "Error", ok: false },
    },
    traceSpans: {
      ok: { label: "200 OK", ok: true },
      "403": { label: "403 Forbidden", ok: false },
      skipped: { label: "Skipped", ok: true },
      error: { label: "Error", ok: false },
    },
  };
  return labels[api]?.[value] ?? { label: value, ok: false };
}

/** Object Store outcomes where an expired key is a plausible cause worth a retention hint. */
const RETENTION_SENSITIVE_OBJECT_STORE_STATUSES = new Set<ApiStatus["objectStore"]>([
  "skipped",
  "no_keys",
]);

const API_STATUS_ROW_LABELS: Record<keyof ApiStatus, string> = {
  logSearch: "Log search (msearch)",
  objectStore: "Object Store",
  deploymentApi: "Deployment API (AMC)",
  traceSpans: "Trace spans (Observability)",
  monitoringSuggestions: "Monitoring", // not shown in table; see monitoring block below
};

interface TaskDetailsPanelProps {
  selectedItem: SelectedItem;
  jobCard: JobCard;
  detailTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onSelectTask?: () => void;
  formatDate: (ts: string | number) => string;
  formatTimestamp: (ts: string | number) => string;
  traceSpans?: TraceSpan[];
  logEntries?: LogEntry[];
  /** True when task details are from no-entitlement mode (runtime logs) */
  isNoEntitlement?: boolean;
  onLogEntrySelect?: (entry: LogEntry) => void;
  onNavigateTask?: (taskId: string) => void;
}

export default function TaskDetailsPanel({
  selectedItem,
  jobCard,
  detailTab,
  onTabChange,
  onSelectTask,
  formatDate,
  formatTimestamp,
  traceSpans = [],
  logEntries = [],
  isNoEntitlement = false,
  onLogEntrySelect,
  onNavigateTask,
}: TaskDetailsPanelProps) {
  const handleTaskScopedTabChange = (tab: DetailTab) => {
    if (selectedItem.type !== "task") {
      onSelectTask?.();
    }
    onTabChange(tab);
  };

  const renderContent = () => {
    if (selectedItem.type === "task") {
      // Use jobCard (current API data) so objectStore / reasoning always reflect latest fetch
      const taskData = jobCard;
      // Find the INBOUND_REQUEST entry to get the raw message
      const inboundEntry = logEntries.find((e) => e.type === "INBOUND_REQUEST");
      const rawMessage = inboundEntry?.raw?.message as string | undefined;
      const taskStory = taskData.objectStore?.taskStory;

      return (
        <>
          {detailTab === "story" && (
            <div className="space-y-4">
              {taskStoryHasContent(taskStory) ? (
                <TaskStoryView story={taskStory} />
              ) : (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                  <p>No structured task story available.</p>
                  <p className="mt-2 text-xs text-gray-400">
                    The task story is reconstructed from the v2 broker Object Store (A2A task history,
                    artifacts, and graph state). It is available while the task&apos;s entries remain
                    within the store&apos;s retention window, which is configured per deployment, and
                    only for tasks processed by a v2 agent broker.
                  </p>
                  <div className="mt-2">
                    <ObjectStoreRetentionTip />
                  </div>
                </div>
              )}
            </div>
          )}
          {detailTab === "message" && (
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="font-semibold text-gray-900">Message</h4>
                  <button
                    type="button"
                    className="text-xs text-indigo-600 hover:text-indigo-800"
                    onClick={() => {
                      const message = document.getElementById("task-message");
                      if (message) message.classList.toggle("max-h-96");
                    }}
                  >
                    View all
                  </button>
                </div>
                <div
                  id="task-message"
                  className="max-h-96 overflow-auto scrollbar-thin rounded-lg border border-gray-200 bg-white p-3"
                >
                  {rawMessage ? (
                    <pre className="whitespace-pre-wrap break-words text-xs font-mono">
                      {formatRawMessage(rawMessage)}
                    </pre>
                  ) : (
                    <pre className="text-xs">
                      {taskData.userMessage ? formatJsonIfPossible(taskData.userMessage) : "No message available"}
                    </pre>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-gray-500">
                    <span className="rounded bg-blue-50 px-1.5 py-0.5">From Logs</span>
                    {inboundEntry && (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5">INBOUND_REQUEST</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          {detailTab === "apiStatus" && (
            <div className="space-y-3">
              <h4 className="font-semibold text-gray-900">Backend API status</h4>
              <p className="text-xs text-gray-500">
                What worked and what did not for this task. Use this when diagnosing &quot;app not working&quot; (often permissions).
              </p>
              {taskData.apiStatus ? (
                <>
                  <table className="w-full border-collapse rounded-lg border border-gray-200 text-left text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="border-b border-gray-200 px-3 py-2 font-medium text-gray-700">API</th>
                        <th className="border-b border-gray-200 px-3 py-2 font-medium text-gray-700">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(taskData.apiStatus) as (keyof ApiStatus)[])
                        .filter((key) => key !== "monitoringSuggestions")
                        .map((key) => {
                          const value = taskData.apiStatus![key];
                          const { label, ok } = apiStatusLabel(key, value);
                          return (
                            <tr key={key} className="border-b border-gray-100 last:border-0">
                              <td className="px-3 py-2 text-gray-700">{API_STATUS_ROW_LABELS[key]}</td>
                              <td className="px-3 py-2">
                                <span
                                  className={
                                    ok
                                      ? "rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-800"
                                      : "rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800"
                                  }
                                >
                                  {label}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  {RETENTION_SENSITIVE_OBJECT_STORE_STATUSES.has(taskData.apiStatus.objectStore) && (
                    <ObjectStoreRetentionTip />
                  )}
                  {taskData.apiStatus.monitoringSuggestions && (
                    <div className="space-y-3">
                      <table className="w-full border-collapse rounded-lg border border-gray-200 text-left text-sm">
                        <thead>
                          <tr className="bg-gray-50">
                            <th className="border-b border-gray-200 px-3 py-2 font-medium text-gray-700">
                              Monitoring (Runtime Manager)
                            </th>
                            <th className="border-b border-gray-200 px-3 py-2 font-medium text-gray-700 w-24">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-gray-100 last:border-0">
                            <td className="px-3 py-2 font-mono text-xs text-gray-700">
                              INSECURE-LOGGING
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={
                                  taskData.apiStatus.monitoringSuggestions.insecureLogging
                                    ? "rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-800"
                                    : "rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800"
                                }
                              >
                                {taskData.apiStatus.monitoringSuggestions.insecureLogging ? "Set" : "Not set"}
                              </span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-500">
                  No API status for this task. Status is shown after loading task details.
                </p>
              )}
            </div>
          )}
          {detailTab === "metadata" && (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                  Task ID
                  <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-700">Logs</span>
                </dt>
                <dd className="font-mono text-gray-900">{taskData.taskId}</dd>
              </div>
              <div>
                <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                  Context ID
                  <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-700">Logs</span>
                </dt>
                <dd className="font-mono text-gray-900">{taskData.contextId}</dd>
              </div>
              {taskData.traceId != null && taskData.traceId !== "" && (
                <div>
                  <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                    Trace ID
                    <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-700">Logs</span>
                  </dt>
                  <dd className="font-mono text-gray-900">{taskData.traceId}</dd>
                </div>
              )}
              <div>
                <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                  Broker / Agent
                  <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-700">Logs</span>
                </dt>
                <dd className="text-gray-900">{taskData.broker.replace(/_/g, " ")}</dd>
              </div>
              <div>
                <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                  API Instance
                  <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-700">Logs</span>
                </dt>
                <dd className="font-mono text-gray-900">{taskData.apiInstanceId}</dd>
              </div>
              {taskData.apiName != null && taskData.apiName !== "" && (
                <div>
                  <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                    API Name
                    <span className="rounded bg-green-50 px-1 text-[10px] text-green-700">API Metadata</span>
                  </dt>
                  <dd className="text-gray-900">{taskData.apiName}</dd>
                </div>
              )}
              {taskData.assetId != null && taskData.assetId !== "" && (
                <div>
                  <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                    Asset ID
                    <span className="rounded bg-green-50 px-1 text-[10px] text-green-700">API Metadata</span>
                  </dt>
                  <dd className="font-mono text-gray-900">{taskData.assetId}</dd>
                </div>
              )}
              {taskData.assetVersion != null && taskData.assetVersion !== "" && (
                <div>
                  <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                    Asset Version
                    <span className="rounded bg-green-50 px-1 text-[10px] text-green-700">API Metadata</span>
                  </dt>
                  <dd className="text-gray-900">{taskData.assetVersion}</dd>
                </div>
              )}
              {taskData.endpointUri != null && taskData.endpointUri !== "" && (
                <div>
                  <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                    Endpoint URI
                    <span className="rounded bg-green-50 px-1 text-[10px] text-green-700">API Metadata</span>
                  </dt>
                  <dd className="font-mono text-gray-900 break-all">{taskData.endpointUri}</dd>
                </div>
              )}
              {taskData.environmentName != null && taskData.environmentName !== "" && (
                <div>
                  <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                    Environment
                    <span className="rounded bg-green-50 px-1 text-[10px] text-green-700">API Metadata</span>
                  </dt>
                  <dd className="text-gray-900">{taskData.environmentName}</dd>
                </div>
              )}
              {taskData.productVersion != null && taskData.productVersion !== "" && (
                <div>
                  <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                    Product Version
                    <span className="rounded bg-green-50 px-1 text-[10px] text-green-700">API Metadata</span>
                  </dt>
                  <dd className="text-gray-900">{taskData.productVersion}</dd>
                </div>
              )}
              {taskData.technology != null && taskData.technology !== "" && (
                <div>
                  <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                    Technology
                    <span className="rounded bg-green-50 px-1 text-[10px] text-green-700">API Metadata</span>
                  </dt>
                  <dd className="text-gray-900">{taskData.technology}</dd>
                </div>
              )}
              <div>
                <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                  Broker app
                  <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-700">Resolved</span>
                </dt>
                <dd className="text-gray-900">{taskData.appId || "—"}</dd>
              </div>
              <div>
                <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                  Start Time
                  <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-700">Logs</span>
                </dt>
                <dd className="text-gray-900">{formatDate(taskData.startTime)}</dd>
              </div>
              <div>
                <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                  End Time
                  <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-700">Logs</span>
                </dt>
                <dd className="text-gray-900">{formatDate(taskData.endTime)}</dd>
              </div>
              <div>
                <dt className="mb-1 flex items-center gap-2 font-semibold text-gray-600">
                  Total Entries
                  <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-700">Logs</span>
                </dt>
                <dd className="text-gray-900">{taskData.totalEntries}</dd>
              </div>
              {taskData.resultTaskId != null && taskData.resultTaskId !== "" && taskData.resultTaskId !== taskData.taskId && (
                <>
                  <div className="my-4 border-t border-gray-200"></div>
                  <div>
                    <dt className="mb-2 flex items-center gap-2 font-semibold text-gray-600">
                      Downstream Agent Task
                      <span className="rounded bg-orange-50 px-1 text-[10px] text-orange-700">A2A Response</span>
                    </dt>
                    <dd className="space-y-2">
                      <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                        <div className="mb-2 text-xs text-gray-600">
                          {taskData.downstreamAgent ? (
                            <>Called agent: <span className="font-semibold">{taskData.downstreamAgent.replace(/_/g, " ")}</span></>
                          ) : (
                            "Downstream agent task"
                          )}
                        </div>
                        <div className="mb-2">
                          <div className="text-xs font-semibold text-gray-600">Task ID</div>
                          <div className="font-mono text-sm text-gray-900">{taskData.resultTaskId}</div>
                        </div>
                        {taskData.resultContextId && taskData.resultContextId !== taskData.contextId && (
                          <div className="mb-2">
                            <div className="text-xs font-semibold text-gray-600">Context ID</div>
                            <div className="font-mono text-sm text-gray-900">{taskData.resultContextId}</div>
                          </div>
                        )}
                        {onNavigateTask && (
                          <button
                            type="button"
                            onClick={() => onNavigateTask(taskData.resultTaskId!)}
                            className="mt-2 w-full rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
                          >
                            View Downstream Task →
                          </button>
                        )}
                      </div>
                    </dd>
                  </div>
                </>
              )}
              {traceSpans.length > 0 && (
                <>
                  <div className="my-4 border-t border-gray-200"></div>
                  <div>
                    <dt className="mb-2 flex items-center gap-2 font-semibold text-gray-600">
                      Trace Spans
                      <span className="rounded bg-purple-50 px-1 text-[10px] text-purple-700">Traces</span>
                      <span className="ml-auto text-xs font-normal text-gray-500">
                        {traceSpans.length} span{traceSpans.length !== 1 ? "s" : ""}
                      </span>
                    </dt>
                    <dd>
                      <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
                        {traceSpans.map((span: TraceSpan, idx: number) => {
                          const durationMs = (span.duration / 1000000).toFixed(2); // Convert nanoseconds to milliseconds
                          const isError = span.statusCode === "STATUS_CODE_ERROR" || (span.httpStatusCode && parseInt(span.httpStatusCode) >= 400);
                          return (
                            <div
                              key={`${span.traceId}-${span.spanId}-${idx}`}
                              className={`rounded-lg border p-3 text-xs ${
                                isError ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"
                              }`}
                            >
                              <div className="mb-1 flex items-start justify-between gap-2">
                                <div className="flex-1">
                                  <div className="font-semibold text-gray-900">{span.name}</div>
                                  {span.entityName && (
                                    <div className="mt-0.5 text-gray-600">
                                      {span.entityType === "API" ? "API" : span.entityType === "APP" ? "App" : span.entityType || "Entity"}: {span.entityName}
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                  {isError && (
                                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                                      Error
                                    </span>
                                  )}
                                  <span className="text-gray-500">{durationMs}ms</span>
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-gray-500">
                                <span>
                                  <span className="font-semibold">Kind:</span> {span.kind.replace("SPAN_KIND_", "")}
                                </span>
                                {span.httpStatusCode && (
                                  <span>
                                    <span className="font-semibold">HTTP:</span> {span.httpStatusCode}
                                  </span>
                                )}
                                {span.envName && (
                                  <span>
                                    <span className="font-semibold">Env:</span> {span.envName}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 font-mono text-[10px] text-gray-400">
                                Span: {span.spanId.slice(0, 16)}...
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </dd>
                  </div>
                </>
              )}
            </dl>
          )}
          {detailTab === "traces" && (
            <div>
              {traceSpans.length > 0 ? (
                <TraceVisualization
                  traceSpans={traceSpans}
                  logEntries={logEntries}
                  onSpanClick={(span) => {
                    // When span is clicked in hierarchy view, just highlight it
                    // Don't navigate away from traces tab
                    // User can click the "log" button if they want to see log entries
                  }}
                  onLogEntryClick={(entry) => {
                    // When log entry button is clicked, select it but keep traces tab active
                    if (onLogEntrySelect) {
                      onLogEntrySelect(entry);
                      // Don't change detailTab - keep user on traces tab
                    }
                  }}
                />
              ) : (
                <div className="p-4 text-sm text-gray-500">
                  {taskData.apiStatus?.traceSpans === "403"
                    ? "Trace spans are unavailable because Observability returned 403 Forbidden."
                    : taskData.apiStatus?.traceSpans === "error"
                      ? "Trace spans could not be loaded because the Observability request failed."
                      : taskData.apiStatus?.traceSpans === "skipped"
                        ? "Trace span lookup was skipped because required task or environment context was unavailable."
                        : "No trace spans matched this task."}
                </div>
              )}
            </div>
          )}
          {detailTab === "reasoning" && (
            <div className="space-y-6">
              {taskData.objectStore?.debug && (
                <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs">
                  <h4 className="font-semibold text-amber-800 mb-2">Partition debug</h4>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-amber-900">
                    {taskData.objectStore.debug.tasks.brokerFormat && (
                      <>
                        <dt className="font-medium">Broker format:</dt>
                        <dd className="text-amber-700">{taskData.objectStore.debug.tasks.brokerFormat}</dd>
                      </>
                    )}
                    <dt className="font-medium">Tasks partition:</dt>
                    <dd className="min-w-0">
                      <span className="text-amber-700">{taskData.objectStore.debug.tasks.partition ?? "—"}</span>
                      {" · "}
                      {!taskData.objectStore.debug.tasks.keyFound ? (
                        <span className="font-medium">Key not found</span>
                      ) : taskData.objectStore.debug.tasks.valueEmpty ? (
                        <span className="font-medium">Key found, value empty (0 strings)</span>
                      ) : (
                        <span>Key found, {taskData.objectStore.debug.tasks.stringCount} strings</span>
                      )}
                      {taskData.objectStore.debug.tasks.keyUsed && (
                        <span className="block truncate mt-0.5 text-amber-600" title={taskData.objectStore.debug.tasks.keyUsed}>
                          key: {taskData.objectStore.debug.tasks.keyUsed}
                        </span>
                      )}
                    </dd>
                  </dl>
                </section>
              )}
              {taskData.objectStore?.available ? (
                <>
                  {taskData.objectStore.fromTasks &&
                   (taskData.objectStore.fromTasks.steps?.length || taskData.objectStore.fromTasks.rawReasoning?.length) ? (
                    <LLMReasoningPanel
                      reasoning={taskData.objectStore.fromTasks}
                      source="objectStore"
                    />
                  ) : taskData.objectStore.llmReasoning &&
                    (taskData.objectStore.llmReasoning.steps?.length || taskData.objectStore.llmReasoning.rawReasoning?.length) ? (
                    <LLMReasoningPanel
                      reasoning={taskData.objectStore.llmReasoning}
                      source="objectStore"
                    />
                  ) : (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
                      No structured content parsed from Object Store. Check Raw Log for payload.
                    </div>
                  )}
                </>
              ) : taskData.objectStore?.available === false && taskData.objectStore?.errors?.length ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <span>Object Store not available.</span>
                  </div>
                  <ul className="mt-2 list-inside list-disc text-xs text-gray-400">
                    {taskData.objectStore.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                  <div className="mt-2">
                    <ObjectStoreRetentionTip />
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <span>No LLM reasoning available from Object Store.</span>
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    LLM reasoning is provided via Object Store and is available for tasks processed by the Agent Broker (entitlement and non-entitlement modes).
                  </div>
                </div>
              )}
            </div>
          )}
          {detailTab === "raw" && (
            <pre className="max-h-[600px] overflow-auto scrollbar-thin rounded-lg border border-gray-200 bg-white p-3 text-xs">
              {formatJsonIfPossible(taskData)}
            </pre>
          )}
        </>
      );
    }

    if (selectedItem.type === "iteration") {
      const iterData = selectedItem.data as {
        iteration: string;
        toolName: string;
        duration: string;
        startTime: string | number;
        endTime: string | number;
        entries: LogEntry[];
      };
      // Find the first entry with a raw message (prefer TOOL_INPUT or A2A_MESSAGE_SENT)
      const messageEntry = iterData.entries.find(
        (e) => e.type === "TOOL_INPUT" || e.type === "A2A_MESSAGE_SENT" || e.type === "LLM_TOOL_SELECTION"
      ) || iterData.entries[0];
      const rawMessage = messageEntry?.raw?.message as string | undefined;
      
      return (
        <>
          {detailTab === "message" && (
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="font-semibold text-gray-900">Message</h4>
                  <button
                    type="button"
                    className="text-xs text-indigo-600 hover:text-indigo-800"
                    onClick={() => {
                      const message = document.getElementById("iteration-message");
                      if (message) message.classList.toggle("max-h-96");
                    }}
                  >
                    View all
                  </button>
                </div>
                <div
                  id="iteration-message"
                  className="max-h-96 overflow-auto scrollbar-thin rounded-lg border border-gray-200 bg-white p-3"
                >
                  {rawMessage ? (
                    <pre className="whitespace-pre-wrap break-words text-xs font-mono">
                      {formatRawMessage(rawMessage)}
                    </pre>
                  ) : (
                    <pre className="text-xs">
                      {JSON.stringify(
                        { iteration: iterData.iteration, tool: iterData.toolName },
                        null,
                        2
                      )}
                    </pre>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-gray-500">
                    {messageEntry && (
                      <>
                        <span className="rounded bg-blue-50 px-1.5 py-0.5">From Logs</span>
                        <span className="rounded bg-blue-50 px-1.5 py-0.5">{messageEntry.type}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          {detailTab === "metadata" && (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-semibold text-gray-600">Iteration</dt>
                <dd className="text-gray-900">{iterData.iteration}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-600">Tool</dt>
                <dd className="text-gray-900">{iterData.toolName}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-600">Duration</dt>
                <dd className="text-gray-900">{iterData.duration}s</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-600">Start Time</dt>
                <dd className="text-gray-900">{formatTimestamp(iterData.startTime)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-600">End Time</dt>
                <dd className="text-gray-900">{formatTimestamp(iterData.endTime)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-600">Entries</dt>
                <dd className="text-gray-900">{iterData.entries.length}</dd>
              </div>
            </dl>
          )}
          {detailTab === "raw" && (
            <pre className="max-h-[600px] overflow-auto scrollbar-thin rounded-lg border border-gray-200 bg-white p-3 text-xs">
              {JSON.stringify(iterData, null, 2)}
            </pre>
          )}
        </>
      );
    }

    if (selectedItem.type === "step") {
      const stepData = selectedItem.data as LogEntry | { stepType?: string; entries?: LogEntry[] };

      if ("index" in stepData) {
        const entry = stepData as LogEntry;
        
        // Extract response body for FINAL_RESPONSE entries
        let finalResponseBody: unknown = null;
        if (entry.type === "FINAL_RESPONSE") {
          const rawMessage = entry.raw?.message as string | undefined;
          if (rawMessage) {
            // Try to extract JSON-RPC result from the message
            const jsonRpcMatch = rawMessage.match(/\{"jsonrpc"[\s\S]*\}/);
            if (jsonRpcMatch) {
              try {
                const rpc = JSON.parse(jsonRpcMatch[0]);
                if (rpc.result) {
                  const content = rpc.result.content || rpc.result.message || rpc.result;
                  if (typeof content === "string") {
                    try {
                      finalResponseBody = JSON.parse(content);
                    } catch {
                      finalResponseBody = content;
                    }
                  } else {
                    finalResponseBody = content;
                  }
                }
              } catch {
                // If JSON-RPC parsing fails, try to extract JSON from HTTP response body
                const jsonMatch = rawMessage.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  try {
                    finalResponseBody = JSON.parse(jsonMatch[0]);
                  } catch {
                    finalResponseBody = rawMessage;
                  }
                } else {
                  finalResponseBody = rawMessage;
                }
              }
            } else {
              // No JSON-RPC, try to extract JSON from HTTP response body
              const jsonMatch = rawMessage.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                try {
                  finalResponseBody = JSON.parse(jsonMatch[0]);
                } catch {
                  finalResponseBody = rawMessage;
                }
              } else {
                finalResponseBody = rawMessage;
              }
            }
          }
        }
        
        const rawMessage = entry.raw?.message as string | undefined;
        
        return (
          <>
            {detailTab === "message" && (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="font-semibold text-gray-900">Message</h4>
                    <button
                      type="button"
                      className="text-xs text-indigo-600 hover:text-indigo-800"
                      onClick={() => {
                        const message = document.getElementById("step-message");
                        if (message) message.classList.toggle("max-h-96");
                      }}
                    >
                      View all
                    </button>
                  </div>
                  <div
                    id="step-message"
                    className="max-h-96 overflow-auto scrollbar-thin rounded-lg border border-gray-200 bg-white p-3"
                  >
                    {rawMessage ? (
                      <pre className="whitespace-pre-wrap break-words text-xs font-mono">
                        {formatRawMessage(rawMessage)}
                      </pre>
                    ) : (
                      <div className="text-sm text-gray-500">
                        {entry.fields.userMessage ? (
                          <pre className="text-xs">{formatJsonIfPossible(entry.fields.userMessage)}</pre>
                        ) : (
                          "No message available"
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-gray-500">
                    <span className="rounded bg-blue-50 px-1.5 py-0.5">From Logs</span>
                    <span className="rounded bg-blue-50 px-1.5 py-0.5">{entry.type}</span>
                  </div>
                </div>
              </div>
            )}
            {detailTab === "metadata" && (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="font-semibold text-gray-600">Type</dt>
                  <dd className="text-gray-900">{entry.type}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-gray-600">Summary</dt>
                  <dd className="text-gray-900">{entry.summary}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-gray-600">Timestamp</dt>
                  <dd className="text-gray-900">{formatTimestamp(entry.timestamp)}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-gray-600">Logger</dt>
                  <dd className="text-gray-900">{entry.logger}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-gray-600">Level</dt>
                  <dd className="text-gray-900">{entry.level}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-gray-600">Log source app</dt>
                  <dd className="text-gray-900">{entry.appId || "—"}</dd>
                </div>
                {jobCard.appId && jobCard.appId !== entry.appId && (
                  <div>
                    <dt className="font-semibold text-gray-600">Task broker app</dt>
                    <dd className="text-gray-900">{jobCard.appId}</dd>
                  </div>
                )}
                {entry.fields.iteration != null && entry.fields.iteration !== "" && (
                  <div>
                    <dt className="font-semibold text-gray-600">Iteration</dt>
                    <dd className="text-gray-900">{entry.fields.iteration}</dd>
                  </div>
                )}
                {entry.fields.tool != null && entry.fields.tool !== "" && (
                  <div>
                    <dt className="font-semibold text-gray-600">Tool</dt>
                    <dd className="text-gray-900">{entry.fields.tool}</dd>
                  </div>
                )}
                {entry.fields.graphNode ? (
                  <div>
                    <dt className="font-semibold text-gray-600">Graph node</dt>
                    <dd className="font-mono text-xs text-gray-900">{entry.fields.graphNode}</dd>
                  </div>
                ) : null}
                {entry.fields.agent ? (
                  <div>
                    <dt className="font-semibold text-gray-600">Agent</dt>
                    <dd className="font-mono text-xs text-gray-900">{entry.fields.agent}</dd>
                  </div>
                ) : null}
                {entry.fields.traceId ? (
                  <div>
                    <dt className="font-semibold text-gray-600">Trace ID</dt>
                    <dd className="break-all font-mono text-xs text-gray-900">{entry.fields.traceId}</dd>
                  </div>
                ) : null}
                {entry.fields.spanId ? (
                  <div>
                    <dt className="font-semibold text-gray-600">Span ID</dt>
                    <dd className="break-all font-mono text-xs text-gray-900">{entry.fields.spanId}</dd>
                  </div>
                ) : null}
                {entry.fields.correlationId ? (
                  <div>
                    <dt className="font-semibold text-gray-600">Correlation ID</dt>
                    <dd className="break-all font-mono text-xs text-gray-900">{entry.fields.correlationId}</dd>
                  </div>
                ) : null}
              </dl>
            )}
            {detailTab === "raw" && (
              <pre className="max-h-[600px] overflow-auto scrollbar-thin rounded-lg border border-gray-200 bg-white p-3 text-xs">
                {JSON.stringify(entry, null, 2)}
              </pre>
            )}
          </>
        );
      }

      const group = stepData as { stepType?: string; entries?: LogEntry[] };
      const groupEntries = group.entries ?? [];
      const uniqueValues = (field: keyof LogEntry["fields"]): string[] =>
        Array.from(
          new Set(
            groupEntries
              .map((entry) => entry.fields[field])
              .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          )
        );
      const nodes = uniqueValues("graphNode");
      const tools = uniqueValues("tool");
      const agents = uniqueValues("agent");
      const traceIds = uniqueValues("traceId");
      const spanIds = uniqueValues("spanId");
      const correlationIds = uniqueValues("correlationId");
      const loggers = Array.from(new Set(groupEntries.map((entry) => entry.logger).filter(Boolean)));
      const firstTimestamp = groupEntries[0]?.timestamp;
      const lastTimestamp = groupEntries[groupEntries.length - 1]?.timestamp;
      const toMs = (value: string | number | undefined): number => {
        if (value === undefined) return 0;
        if (typeof value === "number") return value;
        if (/^\d+$/.test(value)) return parseInt(value, 10);
        return new Date(value).getTime();
      };
      const durationMs =
        firstTimestamp !== undefined && lastTimestamp !== undefined
          ? Math.max(0, toMs(lastTimestamp) - toMs(firstTimestamp))
          : 0;

      return (
        <>
          {detailTab === "message" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                    {(group.stepType ?? "Step").replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-gray-500">
                    {groupEntries.length} event{groupEntries.length === 1 ? "" : "s"}
                  </span>
                  {durationMs > 0 ? (
                    <span className="text-xs text-gray-500">{(durationMs / 1000).toFixed(1)}s window</span>
                  ) : null}
                </div>
                {nodes.length > 0 || tools.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {nodes.map((node) => (
                      <span key={`node-${node}`} className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] text-blue-700">
                        Node: {node}
                      </span>
                    ))}
                    {tools.map((tool) => (
                      <span key={`tool-${tool}`} className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700">
                        Tool: {tool}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                {groupEntries.map((entry) => {
                  const message = entry.raw?.message as string | undefined;
                  return (
                    <div key={`${entry.index}-${entry._id}`} className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="flex items-start gap-3">
                        <span className="shrink-0 font-mono text-[10px] text-gray-400">
                          {formatTimestamp(entry.timestamp)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-800">{entry.summary || entry.type.replace(/_/g, " ")}</p>
                          <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                            {entry.fields.graphNode ? (
                              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                                Node: {entry.fields.graphNode}
                              </span>
                            ) : null}
                            {entry.fields.tool ? (
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                                Tool: {entry.fields.tool}
                              </span>
                            ) : null}
                            {entry.fields.agent ? (
                              <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-700">
                                Agent: {entry.fields.agent}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      {message ? (
                        <details className="mt-2 border-t border-gray-100 pt-2">
                          <summary className="cursor-pointer text-xs font-medium text-indigo-600">
                            Raw event message
                          </summary>
                          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-700">
                            {formatRawMessage(message)}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {detailTab === "metadata" && (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-semibold text-gray-600">Event type</dt>
                <dd className="text-gray-900">{(group.stepType ?? "Step").replace(/_/g, " ")}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-600">Events</dt>
                <dd className="text-gray-900">{groupEntries.length}</dd>
              </div>
              {nodes.length > 0 ? (
                <div>
                  <dt className="font-semibold text-gray-600">Nodes</dt>
                  <dd className="font-mono text-xs text-gray-900">{nodes.join(", ")}</dd>
                </div>
              ) : null}
              {tools.length > 0 ? (
                <div>
                  <dt className="font-semibold text-gray-600">Tools</dt>
                  <dd className="font-mono text-xs text-gray-900">{tools.join(", ")}</dd>
                </div>
              ) : null}
              {agents.length > 0 ? (
                <div>
                  <dt className="font-semibold text-gray-600">Agents</dt>
                  <dd className="font-mono text-xs text-gray-900">{agents.join(", ")}</dd>
                </div>
              ) : null}
              {loggers.length > 0 ? (
                <div>
                  <dt className="font-semibold text-gray-600">Loggers</dt>
                  <dd className="font-mono text-xs text-gray-900">{loggers.join(", ")}</dd>
                </div>
              ) : null}
              {traceIds.length > 0 ? (
                <div>
                  <dt className="font-semibold text-gray-600">Trace IDs</dt>
                  <dd className="break-all font-mono text-xs text-gray-900">{traceIds.join(", ")}</dd>
                </div>
              ) : null}
              {spanIds.length > 0 ? (
                <div>
                  <dt className="font-semibold text-gray-600">Span IDs</dt>
                  <dd className="break-all font-mono text-xs text-gray-900">{spanIds.join(", ")}</dd>
                </div>
              ) : null}
              {correlationIds.length > 0 ? (
                <div>
                  <dt className="font-semibold text-gray-600">Correlation IDs</dt>
                  <dd className="break-all font-mono text-xs text-gray-900">{correlationIds.join(", ")}</dd>
                </div>
              ) : null}
            </dl>
          )}
          {detailTab === "raw" && (
            <pre className="max-h-[600px] overflow-auto scrollbar-thin rounded-lg border border-gray-200 bg-white p-3 text-xs">
              {JSON.stringify(group, null, 2)}
            </pre>
          )}
        </>
      );
    }

    if (selectedItem.type === "node") {
      const visit = selectedItem.data as NodeVisit;
      const durationLabel =
        visit.durationMs < 1000 ? `${visit.durationMs}ms` : `${(visit.durationMs / 1000).toFixed(1)}s`;

      return (
        <>
          {detailTab === "message" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                    {visit.nodeName}
                  </span>
                  <span className="text-xs text-gray-500">{durationLabel}</span>
                  {visit.transitionTo ? (
                    <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      → {visit.transitionTo}
                    </span>
                  ) : null}
                </div>
              </div>

              {visit.reasoning.length > 0 && (
                <div>
                  <h4 className="mb-2 font-semibold text-gray-900">Reasoning</h4>
                  <div className="space-y-2">
                    {visit.reasoning.map((text, i) => (
                      <div
                        key={`reasoning-${i}`}
                        className="rounded-lg border border-purple-100 bg-purple-50 p-3 text-xs whitespace-pre-wrap break-words text-purple-900"
                      >
                        {text}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {visit.toolCalls.length > 0 && (
                <div>
                  <h4 className="mb-2 font-semibold text-gray-900">Tool calls</h4>
                  <div className="space-y-3">
                    {visit.toolCalls.map((call, i) => (
                      <div key={`tool-${i}`} className="rounded-lg border border-teal-100 bg-white p-3">
                        <div className="mb-2 text-xs font-semibold text-teal-700">{call.tool}</div>
                        {call.inputJson !== undefined && (
                          <div className="mb-2">
                            <div className="mb-1 text-[10px] font-semibold uppercase text-gray-500">Input</div>
                            <pre className="max-h-64 overflow-auto scrollbar-thin rounded border border-gray-200 bg-gray-50 p-2 text-[11px] font-mono">
                              {formatJsonIfPossible(call.inputJson)}
                            </pre>
                          </div>
                        )}
                        {call.outputJson !== undefined && (
                          <div>
                            <div className="mb-1 text-[10px] font-semibold uppercase text-gray-500">Output</div>
                            <pre className="max-h-64 overflow-auto scrollbar-thin rounded border border-gray-200 bg-gray-50 p-2 text-[11px] font-mono">
                              {formatJsonIfPossible(call.outputJson)}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {visit.stateEntries.length > 0 && (
                <div>
                  <h4 className="mb-2 font-semibold text-gray-900">Node state</h4>
                  <div className="space-y-2">
                    {visit.stateEntries.map((state, i) => (
                      <div key={`state-${i}`} className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="mb-1 font-mono text-[10px] text-gray-500">{state.key}</div>
                        <pre className="max-h-64 overflow-auto scrollbar-thin text-[11px] font-mono whitespace-pre-wrap break-words">
                          {state.text}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {visit.reasoning.length === 0 &&
                visit.toolCalls.length === 0 &&
                visit.stateEntries.length === 0 && (
                  <div className="text-sm text-gray-500">
                    This node produced no reasoning, tool calls, or state changes in the logs.
                  </div>
                )}

              <details className="rounded-lg border border-gray-200 bg-white">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-gray-600">
                  Raw events ({visit.entries.length})
                </summary>
                <div className="space-y-0.5 px-3 pb-3">
                  {visit.entries.map((entry) => (
                    <div key={entry.index} className="border-t border-gray-100 pt-1 text-[11px]">
                      <span className="mr-2 font-mono text-[10px] text-gray-400">
                        {formatTimestamp(entry.timestamp)}
                      </span>
                      <span className="text-gray-700">{entry.summary}</span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}

          {detailTab === "metadata" && (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-semibold text-gray-600">Node</dt>
                <dd className="font-mono text-xs text-gray-900">{visit.nodeName}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-600">Duration</dt>
                <dd className="text-gray-900">{durationLabel}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-600">Events</dt>
                <dd className="text-gray-900">{visit.entries.length}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-600">Tool calls</dt>
                <dd className="text-gray-900">{visit.toolCalls.length}</dd>
              </div>
              {visit.transitionTo ? (
                <div>
                  <dt className="font-semibold text-gray-600">Transitions to</dt>
                  <dd className="font-mono text-xs text-gray-900">{visit.transitionTo}</dd>
                </div>
              ) : null}
            </dl>
          )}

          {detailTab === "raw" && (
            <pre className="max-h-[600px] overflow-auto scrollbar-thin rounded-lg border border-gray-200 bg-white p-3 text-xs">
              {JSON.stringify(visit, null, 2)}
            </pre>
          )}
        </>
      );
    }

    return <div className="text-sm text-gray-500">No details available</div>;
  };

  return (
    <div className="flex h-full flex-col">
      {isNoEntitlement && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span className="font-medium">Log Search unavailable</span>
          {" — "}
          Showing task details from runtime logs. Trace spans and some API
          metadata require Anypoint Monitoring Log Search.
        </div>
      )}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">
          {selectedItem.type === "task" && `Task ${(selectedItem.data as JobCard).taskId}`}
          {selectedItem.type === "iteration" &&
            `Iteration ${(selectedItem.data as { iteration: string }).iteration}`}
          {selectedItem.type === "step" && "Step Details"}
          {selectedItem.type === "node" && `Node · ${(selectedItem.data as NodeVisit).nodeName}`}
        </h3>
        {selectedItem.type === "task" && (
          <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
            <span>{formatDate((selectedItem.data as JobCard).startTime)}</span>
            <span>•</span>
            <span>{(selectedItem.data as JobCard).duration || "?"}s</span>
            <span>•</span>
            <span>{(selectedItem.data as JobCard).iterations} iter</span>
          </div>
        )}
      </div>

      <div className="flex border-b border-gray-200 bg-white">
        <button
          type="button"
          onClick={() => handleTaskScopedTabChange("apiStatus")}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            detailTab === "apiStatus"
              ? "border-b-2 border-indigo-500 text-indigo-700"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          API status
        </button>
        <button
          type="button"
          onClick={() => onTabChange("message")}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            detailTab === "message"
              ? "border-b-2 border-indigo-500 text-indigo-700"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Message
        </button>
        <button
          type="button"
          onClick={() => onTabChange("metadata")}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            detailTab === "metadata"
              ? "border-b-2 border-indigo-500 text-indigo-700"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Metadata
        </button>
        <button
          type="button"
          onClick={() => handleTaskScopedTabChange("story")}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            detailTab === "story"
              ? "border-b-2 border-indigo-500 text-indigo-700"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Task story
          {taskStoryHasContent(jobCard.objectStore?.taskStory) ? (
            <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">
              Available
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => handleTaskScopedTabChange("traces")}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            detailTab === "traces"
              ? "border-b-2 border-indigo-500 text-indigo-700"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Traces
          {traceSpans.length > 0 ? (
            <span className="ml-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700">
              {traceSpans.length}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => handleTaskScopedTabChange("reasoning")}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            detailTab === "reasoning"
              ? "border-b-2 border-indigo-500 text-indigo-700"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          LLM Reasoning
          {jobCard.objectStore?.available && jobCard.objectStore?.llmReasoning && (
            <span className="ml-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700">
              Available
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onTabChange("raw")}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            detailTab === "raw"
              ? "border-b-2 border-indigo-500 text-indigo-700"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Raw Log
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">{renderContent()}</div>
    </div>
  );
}
