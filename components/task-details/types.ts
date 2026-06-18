export interface LogEntry {
  index: number;
  type: string;
  summary: string;
  timestamp: string | number;
  logger: string;
  level: string;
  appId: string;
  workerId: string;
  fields: {
    taskId?: string;
    contextId?: string;
    apiInstanceId?: string;
    iteration?: string;
    agent?: string;
    traceId?: string;
    spanId?: string;
    correlationId?: string;
    tool?: string;
    toolInputJson?: unknown;
    toolOutputJson?: unknown;
    userMessage?: string;
    messageId?: string;
    resultStatus?: string;
    resultTaskId?: string;
    resultContextId?: string;
  };
  raw: Record<string, unknown>;
  _id: string;
  _index: string;
}

export interface JobCard {
  taskId: string;
  contextId: string;
  traceId: string;
  broker: string;
  apiInstanceId: string;
  userMessage: string;
  messageId: string;
  outcome: string;
  startTime: string;
  endTime: string;
  duration: string | null;
  iterations: number;
  toolsUsed: string[];
  totalEntries: number;
  appId: string;
  // API metadata (enriched from Monitoring API)
  apiName?: string;
  assetId?: string;
  assetVersion?: string;
  endpointUri?: string;
  environmentName?: string;
  productVersion?: string;
  technology?: string;
  // Downstream agent task IDs (from A2A responses)
  resultTaskId?: string;
  resultContextId?: string;
  downstreamAgent?: string; // Agent name that returned this taskId
  // Final response body (extracted from FINAL_RESPONSE log entry)
  finalResponseBody?: unknown;
    // Object Store data (broker brain state; from _tasks partition)
    objectStore?: {
      available: boolean;
      /** Parsed content from _tasks partition */
      fromTasks?: { steps: Array<{ step: string; content: string[] }>; rawReasoning: string[]; allRawStrings?: string[] };
      llmReasoning?: {
        steps?: Array<{ step: string; content: string[] }>;
        rawReasoning?: string[];
        allRawStrings?: string[];
      };
      toolCallIds?: string[];
      downstreamContextIds?: Array<{ agent: string; contextId: string; taskId: string }>;
      errors?: string[];
      /** Debug: partition lookup result (key found, value empty, string count) */
      debug?: {
        tasks: { partition: string | null; keyFound: boolean; keyUsed: string | null; valueEmpty: boolean; stringCount: number };
      };
    };
  /** Summary of backend API outcomes for this task (for support / "app not working" diagnosis) */
  apiStatus?: ApiStatus;
}

/** Per-API status for task details: what worked and what failed (200 vs 403 entitlement vs 403 unauthorized). */
export interface ApiStatus {
  /** Log search (Monitoring _msearch): 200 ok, 403 entitlement, 404 unavailable, or other error */
  logSearch: "ok" | "403_entitlement" | "403_unauthorized" | "404_unavailable" | "error";
  /** Object Store: ok, 403, no store found, store found but no keys, skipped, or error */
  objectStore: "ok" | "403_forbidden" | "no_store" | "no_keys" | "skipped" | "error";
  /** Deployment API (AMC): ok, 403 (e.g. Read Applications scope), not_used, or error */
  deploymentApi: "ok" | "403_forbidden" | "not_used" | "error";
  /** Trace spans (Observability spans:search): ok, 403, skipped (no traceId/envId), or error */
  traceSpans: "ok" | "403" | "skipped" | "error";
  /** From deployment detail we already fetch: whether Monitoring log categories are set (no extra call). */
  monitoringSuggestions?: { brokerLogger: boolean; insecureLogging: boolean };
}

export type ViewMode = "tree" | "list";
export type DetailTab = "apiStatus" | "message" | "metadata" | "traces" | "reasoning" | "raw";

export interface SelectedItem {
  type: "task" | "iteration" | "step" | "tool";
  id: string;
  data: unknown;
}

export interface TreeStructureIteration {
  id: string;
  iteration: string;
  toolName: string;
  duration: string;
  startTime: string | number;
  endTime: string | number;
  entries: LogEntry[];
  steps: Record<string, LogEntry[]>;
}

export interface TreeStructure {
  preEntries: LogEntry[];
  iterations: TreeStructureIteration[];
  postEntries: LogEntry[];
}

export interface ListViewGroupedEntries {
  preEntries: LogEntry[];
  iterations: Array<{
    id: string;
    iteration: string;
    toolName: string;
    entries: LogEntry[];
  }>;
  postEntries: LogEntry[];
}

export interface TraceSpan {
  traceId: string;
  spanId: string;
  name: string;
  kind: string;
  statusCode: string;
  httpStatusCode?: string;
  duration: number; // nanoseconds
  endTime: number; // nanoseconds
  entityId?: string;
  entityName?: string;
  entityType?: string;
  envId?: string;
  orgId?: string;
  orgName?: string;
  envName?: string;
  startTime?: number; // nanoseconds (calculated from endTime - duration)
  parentSpanId?: string; // inferred from hierarchy
  children?: TraceSpan[]; // for tree structure
  logEntries?: LogEntry[]; // linked log entries
}
