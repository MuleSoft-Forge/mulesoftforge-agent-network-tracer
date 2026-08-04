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

export function extractStringsFromV2StorageEntry(raw: string): string[] {
  const entry = parseStorageEntry(raw);
  if (!entry?.payload_json) return [];

  const fromTask = extractStringsFromV2TaskPayload(entry.payload_json);
  if (fromTask.length > 0) return fromTask;

  return extractStringsFromV2GraphStatePayload(entry.payload_json);
}
