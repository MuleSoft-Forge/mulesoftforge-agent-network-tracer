/**
 * Parsers for Agent Network v2 broker Object Store payloads.
 *
 * v2 brokers persist JSON StorageEntry envelopes (STRING values) in partitions
 * named `{agent_graph_id}-task-store` and `{agent_graph_id}-graph-state-store`.
 * v1 brokers use Java-serialized BINARY values in `_agentBrokerModule_*_tasks`.
 */

export interface StorageEntry {
  task_id?: string | null;
  context_id?: string | null;
  user_id?: string | null;
  timestamp?: string | null;
  payload_json?: string | null;
}

export type ObjectStoreBrokerFormat = "v1" | "v2";

export function isV1TasksPartition(partition: string): boolean {
  return partition.includes("_tasks");
}

export function isV2TaskStorePartition(partition: string): boolean {
  return partition.endsWith("-task-store");
}

export function isV2GraphStatePartition(partition: string): boolean {
  return partition.endsWith("-graph-state-store");
}

/** Normalize broker / agent-graph id for partition name matching. */
export function normalizeBrokerToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Rank task-store partition candidates for a broker name.
 * Exact `{broker}-task-store` matches rank highest; then substring matches.
 */
export function rankV2TaskPartitions(partitions: string[], brokerName: string): string[] {
  const taskPartitions = partitions.filter(isV2TaskStorePartition);
  if (taskPartitions.length === 0) return [];

  const normalizedBroker = normalizeBrokerToken(brokerName);
  if (!normalizedBroker) return taskPartitions;

  const scored = taskPartitions.map((partition) => {
    const prefix = partition.slice(0, -"-task-store".length);
    const normalizedPrefix = normalizeBrokerToken(prefix);
    let score = 0;
    if (normalizedPrefix === normalizedBroker) score = 100;
    else if (normalizedPrefix.includes(normalizedBroker) || normalizedBroker.includes(normalizedPrefix)) score = 50;
    else if (partition.toLowerCase().includes(normalizedBroker)) score = 25;
    return { partition, score };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.partition.localeCompare(b.partition))
    .map((item) => item.partition);
}

export function rankV2GraphStatePartitions(partitions: string[], brokerName: string): string[] {
  const graphPartitions = partitions.filter(isV2GraphStatePartition);
  if (graphPartitions.length === 0) return [];

  const normalizedBroker = normalizeBrokerToken(brokerName);
  if (!normalizedBroker) return graphPartitions;

  const scored = graphPartitions.map((partition) => {
    const prefix = partition.slice(0, -"-graph-state-store".length);
    const normalizedPrefix = normalizeBrokerToken(prefix);
    let score = 0;
    if (normalizedPrefix === normalizedBroker) score = 100;
    else if (normalizedPrefix.includes(normalizedBroker) || normalizedBroker.includes(normalizedPrefix)) score = 50;
    else if (partition.toLowerCase().includes(normalizedBroker)) score = 25;
    return { partition, score };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.partition.localeCompare(b.partition))
    .map((item) => item.partition);
}

export function parseStorageEntry(raw: string): StorageEntry | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as StorageEntry;
  } catch {
    return null;
  }
}

/** A single turn in the A2A task history (or the final status message). */
export interface TaskStoryMessage {
  role: string;
  text: string;
  messageId?: string;
  kind?: string;
}

/** A named output produced by the agent network. */
export interface TaskStoryArtifact {
  name?: string;
  description?: string;
  text: string;
}

/** A keyed slice of graph state (per-node reasoning/output the broker persisted). */
export interface TaskStoryStateEntry {
  key: string;
  text: string;
}

/**
 * Structured view of a v2 A2A task, reconstructed from the persisted Object Store
 * payload. Unlike the flat string extraction, this preserves who said what, in
 * what order, the terminal state, and the produced artifacts.
 */
export interface TaskStory {
  taskId?: string;
  contextId?: string;
  statusState?: string;
  statusText?: string;
  statusTimestamp?: string;
  history: TaskStoryMessage[];
  artifacts: TaskStoryArtifact[];
  stateEntries: TaskStoryStateEntry[];
}

/** Join the text of an A2A message/artifact `parts` array into a single string. */
function partsToText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (typeof record.text === "string" && record.text.trim().length > 0) {
      chunks.push(record.text.trim());
      continue;
    }
    // Data parts carry structured tool payloads — render them as compact JSON.
    if (record.data !== undefined) {
      try {
        chunks.push(JSON.stringify(record.data));
      } catch {
        // ignore non-serializable data parts
      }
    }
  }
  return chunks.join("\n").trim();
}

function toStoryMessage(message: unknown): TaskStoryMessage | null {
  if (!message || typeof message !== "object") return null;
  const record = message as Record<string, unknown>;
  const text = partsToText(record.parts);
  if (!text) return null;
  const role = typeof record.role === "string" && record.role.trim() ? record.role.trim() : "agent";
  return {
    role,
    text,
    messageId: typeof record.messageId === "string" ? record.messageId : undefined,
    kind: typeof record.kind === "string" ? record.kind : undefined,
  };
}

/** Parse an A2A Task JSON payload into an ordered, role-tagged story. */
export function parseA2ATaskStory(payloadJson: string): TaskStory | null {
  let task: Record<string, unknown>;
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    task = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  // An A2A Task is identifiable by a status object and/or a history array.
  const hasHistory = Array.isArray(task.history);
  const hasStatus = Boolean(task.status && typeof task.status === "object");
  const hasArtifacts = Array.isArray(task.artifacts);
  if (!hasHistory && !hasStatus && !hasArtifacts) return null;

  const history: TaskStoryMessage[] = [];
  if (Array.isArray(task.history)) {
    for (const message of task.history) {
      const story = toStoryMessage(message);
      if (story) history.push(story);
    }
  }

  const artifacts: TaskStoryArtifact[] = [];
  if (Array.isArray(task.artifacts)) {
    for (const artifact of task.artifacts) {
      if (!artifact || typeof artifact !== "object") continue;
      const record = artifact as Record<string, unknown>;
      const text = partsToText(record.parts);
      if (!text) continue;
      artifacts.push({
        name: typeof record.name === "string" ? record.name : undefined,
        description: typeof record.description === "string" ? record.description : undefined,
        text,
      });
    }
  }

  let statusState: string | undefined;
  let statusText: string | undefined;
  let statusTimestamp: string | undefined;
  if (task.status && typeof task.status === "object") {
    const status = task.status as Record<string, unknown>;
    if (typeof status.state === "string") statusState = status.state;
    if (typeof status.timestamp === "string") statusTimestamp = status.timestamp;
    const statusMessage = toStoryMessage(status.message);
    if (statusMessage) statusText = statusMessage.text;
  }

  return {
    taskId: typeof task.id === "string" ? task.id : undefined,
    contextId: typeof task.contextId === "string" ? task.contextId : undefined,
    statusState,
    statusText,
    statusTimestamp,
    history,
    artifacts,
    stateEntries: [],
  };
}

/**
 * Parse a graph StateContainer payload into keyed state entries. Preserves the
 * top-level state key so the UI can show what each slice represents instead of a
 * flat string bag.
 */
export function parseGraphStateEntries(payloadJson: string): TaskStoryStateEntry[] {
  let root: unknown;
  try {
    root = JSON.parse(payloadJson);
  } catch {
    return [];
  }

  const entries: TaskStoryStateEntry[] = [];
  const seen = new Set<string>();

  const visit = (value: unknown, keyPath: string, depth: number): void => {
    if (depth > 12 || value == null) return;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length >= 20 && !seen.has(trimmed)) {
        seen.add(trimmed);
        entries.push({ key: keyPath || "state", text: trimmed });
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${keyPath}[${index}]`, depth + 1));
      return;
    }

    if (typeof value === "object") {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        const nextPath = keyPath ? `${keyPath}.${key}` : key;
        visit(nested, nextPath, depth + 1);
      }
    }
  };

  visit(root, "", 0);
  return entries;
}

/**
 * Build a structured task story from a v2 StorageEntry envelope. Task-store
 * envelopes yield an A2A story; graph-state-store envelopes yield keyed state.
 */
export function buildTaskStoryFromStorageEntry(raw: string): {
  story: TaskStory | null;
  stateEntries: TaskStoryStateEntry[];
} {
  const payloadJson = resolveV2PayloadJson(raw);
  if (!payloadJson) return { story: null, stateEntries: [] };

  const story = parseA2ATaskStory(payloadJson);
  if (story) {
    return { story, stateEntries: [] };
  }
  return { story: null, stateEntries: parseGraphStateEntries(payloadJson) };
}

function collectTextParts(container: unknown, out: string[]): void {
  if (!container || typeof container !== "object") return;
  const record = container as Record<string, unknown>;

  if (Array.isArray(record.parts)) {
    for (const part of record.parts) {
      if (part && typeof part === "object") {
        const text = (part as Record<string, unknown>).text;
        if (typeof text === "string" && text.trim().length > 0) {
          out.push(text.trim());
        }
      }
    }
  }

  if (typeof record.text === "string" && record.text.trim().length > 0) {
    out.push(record.text.trim());
  }
}

/** Extract human-readable strings from an A2A Task JSON payload (v2 task-store). */
export function extractStringsFromV2TaskPayload(payloadJson: string): string[] {
  const strings: string[] = [];
  try {
    const task = JSON.parse(payloadJson) as Record<string, unknown>;

    const history = task.history;
    if (Array.isArray(history)) {
      for (const message of history) {
        collectTextParts(message, strings);
      }
    }

    const artifacts = task.artifacts;
    if (Array.isArray(artifacts)) {
      for (const artifact of artifacts) {
        collectTextParts(artifact, strings);
      }
    }

    const status = task.status;
    if (status && typeof status === "object") {
      collectTextParts((status as Record<string, unknown>).message, strings);
    }
  } catch {
    // Fall through — caller may treat as empty
  }
  return strings;
}

/** Walk graph StateContainer JSON and collect string leaf values (v2 graph-state-store). */
export function extractStringsFromV2GraphStatePayload(payloadJson: string): string[] {
  const strings: string[] = [];
  const seen = new Set<string>();

  const visit = (value: unknown, depth: number): void => {
    if (depth > 12 || value == null) return;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length >= 20 && !seen.has(trimmed)) {
        seen.add(trimmed);
        strings.push(trimmed);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }

    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      // Prefer known reasoning-bearing fields first
      for (const key of ["text", "content", "output", "reasoning", "message", "summary", "result"]) {
        if (key in record) visit(record[key], depth + 1);
      }
      for (const nested of Object.values(record)) {
        visit(nested, depth + 1);
      }
    }
  };

  try {
    visit(JSON.parse(payloadJson), 0);
  } catch {
    // ignore
  }

  return strings;
}

/**
 * Resolve the inner payload JSON string from a stored value. Handles both the
 * StorageEntry envelope (`{ payload_json: "..." }`) and brokers that persist the
 * A2A task / graph state JSON directly as the value.
 */
function resolveV2PayloadJson(raw: string): string | null {
  const entry = parseStorageEntry(raw);
  if (entry?.payload_json) return entry.payload_json;
  // Some brokers store the payload object directly (no envelope). If the raw
  // string itself parses to an object, treat it as the payload.
  if (entry && typeof entry === "object") return raw;
  return null;
}

export function extractStringsFromV2StorageEntry(raw: string): string[] {
  const payloadJson = resolveV2PayloadJson(raw);
  if (!payloadJson) return [];

  const fromTask = extractStringsFromV2TaskPayload(payloadJson);
  if (fromTask.length > 0) return fromTask;

  return extractStringsFromV2GraphStatePayload(payloadJson);
}

/**
 * **Diagnostic only** (no customer content). Describe the *shape* of a stored v2
 * value — top-level key names, whether a `payload_json` envelope is present, and
 * the payload's own top-level keys — so a "value empty (0 strings)" outcome can
 * be explained (e.g. an unexpected envelope shape) straight from the log.
 */
export function describeV2StorageShape(raw: string): {
  parsedAsJson: boolean;
  topLevelKeys: string[];
  hasPayloadJson: boolean;
  payloadJsonLength: number;
  payloadTopLevelKeys: string[];
  looksLikeA2ATask: boolean;
  looksLikeGraphState: boolean;
} {
  const result = {
    parsedAsJson: false,
    topLevelKeys: [] as string[],
    hasPayloadJson: false,
    payloadJsonLength: 0,
    payloadTopLevelKeys: [] as string[],
    looksLikeA2ATask: false,
    looksLikeGraphState: false,
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return result;
  }
  if (!parsed || typeof parsed !== "object") return result;
  result.parsedAsJson = true;
  result.topLevelKeys = Object.keys(parsed as Record<string, unknown>);

  const envelope = parsed as Record<string, unknown>;
  const payloadJson =
    typeof envelope.payload_json === "string" ? envelope.payload_json : null;
  result.hasPayloadJson = Boolean(payloadJson);

  const payloadRaw = payloadJson ?? raw;
  result.payloadJsonLength = payloadRaw.length;
  try {
    const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
    if (payload && typeof payload === "object") {
      result.payloadTopLevelKeys = Object.keys(payload);
      result.looksLikeA2ATask =
        "history" in payload || "artifacts" in payload || "status" in payload;
      result.looksLikeGraphState =
        !result.looksLikeA2ATask && result.payloadTopLevelKeys.length > 0;
    }
  } catch {
    // payload isn't JSON — leave payload keys empty
  }

  return result;
}
