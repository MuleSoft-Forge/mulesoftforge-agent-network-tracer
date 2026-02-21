"use client";

import type { ApiStatus, JobCard, LogEntry, DetailTab, SelectedItem, TraceSpan } from "./types";
import TraceVisualization from "./TraceVisualization";
import LLMReasoningPanel from "./LLMReasoningPanel";

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

const API_STATUS_ROW_LABELS: Record<keyof ApiStatus, string> = {
  logSearch: "Log search (msearch)",
  objectStore: "Object Store",
  deploymentApi: "Deployment API (AMC)",
  traceSpans: "Trace spans (Observability)",
};

interface TaskDetailsPanelProps {
  selectedItem: SelectedItem;
  jobCard: JobCard;
  detailTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
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
  formatDate,
  formatTimestamp,
  traceSpans = [],
  logEntries = [],
  isNoEntitlement = false,
  onLogEntrySelect,
  onNavigateTask,
}: TaskDetailsPanelProps) {
  const renderContent = () => {
    if (selectedItem.type === "task") {
      const taskData = selectedItem.data as JobCard;
      // Find the INBOUND_REQUEST entry to get the raw message
      const inboundEntry = logEntries.find((e) => e.type === "INBOUND_REQUEST");
      const rawMessage = inboundEntry?.raw?.message as string | undefined;
      
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
                <table className="w-full border-collapse rounded-lg border border-gray-200 text-left text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border-b border-gray-200 px-3 py-2 font-medium text-gray-700">API</th>
                      <th className="border-b border-gray-200 px-3 py-2 font-medium text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Object.keys(taskData.apiStatus) as (keyof ApiStatus)[]).map((key) => {
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
                  App ID
                  <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-700">Logs</span>
                </dt>
                <dd className="text-gray-900">{taskData.appId}</dd>
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
                  No trace spans available. Trace spans require a traceId and envId to be fetched.
                </div>
              )}
            </div>
          )}
          {detailTab === "reasoning" && (
            <div className="space-y-4">
              {taskData.objectStore?.available &&
               taskData.objectStore?.llmReasoning &&
               (taskData.objectStore.llmReasoning.steps?.length || taskData.objectStore.llmReasoning.rawReasoning?.length) ? (
                <LLMReasoningPanel
                  reasoning={taskData.objectStore.llmReasoning}
                  source="objectStore"
                />
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
                  <dt className="font-semibold text-gray-600">App ID</dt>
                  <dd className="text-gray-900">{entry.appId}</dd>
                </div>
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
    }

    return <div className="text-sm text-gray-500">No details available</div>;
  };

  return (
    <div className="flex h-full flex-col">
      {isNoEntitlement && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span className="font-medium">No-entitlement mode</span>
          {" — "}
          Task details from runtime logs. Traces and some API metadata are not shown.
        </div>
      )}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">
          {selectedItem.type === "task" && `Task ${(selectedItem.data as JobCard).taskId}`}
          {selectedItem.type === "iteration" &&
            `Iteration ${(selectedItem.data as { iteration: string }).iteration}`}
          {selectedItem.type === "step" && "Step Details"}
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
        {selectedItem.type === "task" && (
          <button
            type="button"
            onClick={() => onTabChange("apiStatus")}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              detailTab === "apiStatus"
                ? "border-b-2 border-indigo-500 text-indigo-700"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            API status
          </button>
        )}
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
        {selectedItem.type === "task" && (
          <>
            {traceSpans.length > 0 && (
              <button
                type="button"
                onClick={() => onTabChange("traces")}
                className={`px-4 py-2 text-xs font-medium transition-colors ${
                  detailTab === "traces"
                    ? "border-b-2 border-indigo-500 text-indigo-700"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Traces
                <span className="ml-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700">
                  {traceSpans.length}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onTabChange("reasoning")}
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
          </>
        )}
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
