/**
 * Real classifier vocabulary and connection-metadata file shapes for assets
 * published by agent-network projects, confirmed against MuleSoft's own
 * JSON-schema test fixtures in `agent-fabric-specification/agent-fabric-schema`
 * (agent_metadata/, mcp_metadata/, llm_metadata/, agent_network_metadata/ —
 * each with a valid `exchange.json` + `asset.json` pair) and published
 * exchange.json examples from real agent-network deployments.
 *
 * When an agent-network project is published, the broker/agent/mcp/llm assets
 * it registers each carry one of these classifiers as a `files.<classifier>.json`
 * entry on the Exchange asset (or as the `main` file of a small standalone
 * dependency asset) — this is the `connections` graph the Exchange tab should
 * surface, instead of a raw JSON dump.
 */

/** Every real classifier observed for agent-network-related Exchange assets/files. */
export const EXCHANGE_AGENT_NETWORK_CLASSIFIERS = [
  "agent-network", // V1 top-level published network asset (schemaVersion 1.0.0)
  "agentic-network", // V2 top-level published network asset (agentNetwork 2.0.0)
  "agent-network-metadata", // network topology: brokers[] + registry[]
  "agent-metadata", // one agent/broker's connections (A2A/MCP/LLM)
  "fat-agent-metadata", // self-contained variant of agent-metadata
  "mcp-metadata", // one MCP server's tools/resources/prompts + connections
  "fat-mcp-metadata",
  "llm-metadata", // one LLM's platform + transcoding policy ref
  "mcp", // standalone MCP server asset (main: mcp.json)
  "broker-group", // grouped-broker network asset
  "a2a-card", // A2A agent card
  "a2a-v1-card",
  "fat-a2a-card",
  "other-card",
] as const;

export type ExchangeAgentNetworkClassifier = (typeof EXCHANGE_AGENT_NETWORK_CLASSIFIERS)[number];

/** Strips the `fat-` self-contained-bundle prefix so callers can match on the base classifier. */
function normalizeClassifier(classifier: string): string {
  return classifier.startsWith("fat-") ? classifier.slice(4) : classifier;
}

export interface ExchangeAssetRef {
  groupId: string;
  assetId: string;
  version: string;
}

export interface ExchangeConnection {
  kind: string;
  name?: string;
  ref: ExchangeAssetRef;
  /** Present on `kind: "mcp"` connections — the subset of tools this caller may invoke. */
  allowed?: string[];
}

export interface AgentMetadata {
  fileKind: "agent-metadata";
  protocol?: string;
  platform?: string;
  kind?: string;
  connections: ExchangeConnection[];
  provenance?: { id?: string; url?: string; createdAt?: string; updatedAt?: string };
}

export interface McpToolInputSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface McpMetadata {
  fileKind: "mcp-metadata";
  protocolVersion?: string;
  capabilities?: Record<string, boolean>;
  transport?: { kind?: string };
  tools: Array<{ name: string; description?: string; inputSchema?: McpToolInputSchema }>;
  resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
  prompts: Array<{ name: string; description?: string }>;
  connections: ExchangeConnection[];
}

export interface LlmMetadata {
  fileKind: "llm-metadata";
  platform?: string;
  policyRef?: ExchangeAssetRef;
}

export interface AgentNetworkMetadata {
  fileKind: "agent-network-metadata";
  brokers: Array<{
    protocol?: string;
    platform?: string;
    kind?: string;
    ref: ExchangeAssetRef;
    connections: ExchangeConnection[];
  }>;
  registry: Array<{ ref: ExchangeAssetRef }>;
}

export type ParsedExchangeMetadata = AgentMetadata | McpMetadata | LlmMetadata | AgentNetworkMetadata;

/**
 * Parses a downloaded Exchange file's JSON content into a typed connections
 * summary when the classifier is one of the known metadata shapes. Returns
 * `null` for any other classifier, or if the content isn't valid JSON — the
 * caller should fall back to rendering the raw content in that case.
 */
export function parseExchangeMetadataFile(
  classifier: string,
  content: string | null
): ParsedExchangeMetadata | null {
  if (!content) return null;
  const base = normalizeClassifier(classifier);
  if (
    base !== "agent-metadata" &&
    base !== "mcp-metadata" &&
    base !== "mcp" &&
    base !== "llm-metadata" &&
    base !== "agent-network-metadata"
  ) {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;

  switch (base) {
    case "agent-metadata":
      return {
        fileKind: "agent-metadata",
        protocol: asString(o.protocol),
        platform: asString(o.platform),
        kind: asString(o.kind),
        connections: asConnections(o.connections),
        provenance: asProvenance(o.provenance),
      };
    case "mcp-metadata":
    case "mcp":
      return {
        fileKind: "mcp-metadata",
        protocolVersion: asString(o.protocolVersion),
        capabilities: asBooleanRecord(o.capabilities),
        transport: o.transport && typeof o.transport === "object"
          ? { kind: asString((o.transport as Record<string, unknown>).kind) }
          : undefined,
        tools: asToolList(o.tools),
        resources: asResourceList(o.resources),
        prompts: asNamedList(o.prompts),
        connections: asConnections(o.connections),
      };
    case "llm-metadata":
      return {
        fileKind: "llm-metadata",
        platform: asString(o.platform),
        policyRef: asRef(o.policyRef),
      };
    case "agent-network-metadata":
      return {
        fileKind: "agent-network-metadata",
        brokers: asBrokerList(o.brokers),
        registry: asRegistryList(o.registry),
      };
    default:
      return null;
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asRef(v: unknown): ExchangeAssetRef | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.groupId !== "string" || typeof o.assetId !== "string") return undefined;
  return { groupId: o.groupId, assetId: o.assetId, version: asString(o.version) ?? "" };
}

function asConnections(v: unknown): ExchangeConnection[] {
  if (!Array.isArray(v)) return [];
  const out: ExchangeConnection[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const ref = asRef(o.ref);
    if (!ref || typeof o.kind !== "string") continue;
    out.push({
      kind: o.kind,
      name: asString(o.name),
      ref,
      allowed: Array.isArray(o.allowed) ? o.allowed.filter((a): a is string => typeof a === "string") : undefined,
    });
  }
  return out;
}

function asProvenance(v: unknown): AgentMetadata["provenance"] {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  return { id: asString(o.id), url: asString(o.url), createdAt: asString(o.createdAt), updatedAt: asString(o.updatedAt) };
}

function asBooleanRecord(v: unknown): Record<string, boolean> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(o)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

function asToolList(v: unknown): McpMetadata["tools"] {
  if (!Array.isArray(v)) return [];
  const out: McpMetadata["tools"] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.name !== "string") continue;
    const entry: McpMetadata["tools"][number] = {
      name: o.name,
      ...(asString(o.description) ? { description: asString(o.description) } : {}),
    };
    if (o.inputSchema && typeof o.inputSchema === "object") {
      entry.inputSchema = o.inputSchema as McpMetadata["tools"][number]["inputSchema"];
    }
    out.push(entry);
  }
  return out;
}

function asNamedList(v: unknown): Array<{ name: string; description?: string }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ name: string; description?: string }> = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.name !== "string") continue;
    out.push({ name: o.name, description: asString(o.description) });
  }
  return out;
}

function asResourceList(v: unknown): McpMetadata["resources"] {
  if (!Array.isArray(v)) return [];
  const out: McpMetadata["resources"] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.uri !== "string") continue;
    out.push({ uri: o.uri, name: asString(o.name), description: asString(o.description), mimeType: asString(o.mimeType) });
  }
  return out;
}

function asBrokerList(v: unknown): AgentNetworkMetadata["brokers"] {
  if (!Array.isArray(v)) return [];
  const out: AgentNetworkMetadata["brokers"] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const ref = asRef(o.ref);
    if (!ref) continue;
    out.push({
      protocol: asString(o.protocol),
      platform: asString(o.platform),
      kind: asString(o.kind),
      ref,
      connections: asConnections(o.connections),
    });
  }
  return out;
}

function asRegistryList(v: unknown): AgentNetworkMetadata["registry"] {
  if (!Array.isArray(v)) return [];
  const out: AgentNetworkMetadata["registry"] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const ref = asRef((item as Record<string, unknown>).ref);
    if (ref) out.push({ ref });
  }
  return out;
}
