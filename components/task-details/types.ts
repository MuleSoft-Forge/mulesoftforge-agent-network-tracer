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
}

export type ViewMode = "tree" | "list";
export type DetailTab = "input-output" | "metadata" | "traces" | "raw";

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
