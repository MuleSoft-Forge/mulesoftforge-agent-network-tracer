/**
 * Optional runtime system limit variables for exchange.json metadata.variables.
 * @see https://docs.mulesoft.com/agent-network/latest/af-agent-network-yaml-reference#runtime-system-limit-variables
 */

export const RUNTIME_SYSTEM_LIMITS_DOCS_URL =
  "https://docs.mulesoft.com/agent-network/latest/af-agent-network-yaml-reference#runtime-system-limit-variables";

/** exchange.json variable that sets how long a deployed network's Object Store keys live. */
export const OBJECT_STORE_TTL_VARIABLE = "OBJECT_STORE_DEFAULT_TTL_MS";

/** Ceiling MuleSoft accepts for OBJECT_STORE_TTL_VARIABLE: 30 days. */
export const OBJECT_STORE_TTL_MAX_MS = 2_592_000_000;

export interface RuntimeSystemLimitVariable {
  /** Full exchange.json metadata.variables key (flat, not nested). */
  key: string;
  description: string;
  /**
   * Value prefilled into exchange.json when the variable is added. For
   * OBJECT_STORE_DEFAULT_TTL_MS this is the maximum, not the runtime default
   * that applies when the variable is absent.
   */
  defaultValue: string;
}

/** Catalog of optional graph execution limits (all non-secret string values). */
export const RUNTIME_SYSTEM_LIMIT_VARIABLES: readonly RuntimeSystemLimitVariable[] = [
  {
    key: "MODULE_GRAPH_ERROR_SETTINGS_MAX_HANDOFF_ITERATIONS",
    description:
      "Maximum node-to-node transitions allowed per turn. Controls how many times execution can move between nodes during a single conversation turn.",
    defaultValue: "30",
  },
  {
    key: "MODULE_GRAPH_ERROR_SETTINGS_MAX_REASONING_ITERATIONS",
    description:
      "Maximum LLM reasoning loops allowed within a single node. Limits how many times the LLM can iterate on its reasoning before producing a result.",
    defaultValue: "20",
  },
  {
    key: "MODULE_GRAPH_ERROR_SETTINGS_MAX_SUBGRAPH_DEPTH",
    description:
      "Maximum nesting depth for subgraphs. Controls how deeply agent networks can be nested within other agent networks.",
    defaultValue: "10",
  },
  {
    key: "MODULE_GRAPH_ERROR_SETTINGS_MAX_NODE_TOOL_CALL_ITERATIONS",
    description:
      "Maximum tool executor runs allowed per node. Limits how many times a node can invoke tool execution during its processing.",
    defaultValue: "20",
  },
  {
    key: "MODULE_GRAPH_ERROR_SETTINGS_MAX_TURN_TOOL_CALL_COUNTS",
    description:
      "Total tool invocations allowed across all nodes per turn. Provides a global limit on tool usage during a single conversation turn.",
    defaultValue: "50",
  },
  {
    key: "MODULE_GRAPH_ERROR_SETTINGS_MAX_STATE_SIZE_BYTES",
    description:
      "Maximum accumulated state size in bytes during graph execution. Default is 10 MB (10485760 bytes).",
    defaultValue: "10485760",
  },
  {
    key: OBJECT_STORE_TTL_VARIABLE,
    description:
      "How long conversational memory for a contextId persists, in milliseconds. Documented default without this variable is 24 hours (86400000 ms), though a deployment's store can report different retention; 30 days (2592000000 ms) is the maximum.",
    defaultValue: String(OBJECT_STORE_TTL_MAX_MS),
  },
] as const;

export function isRuntimeSystemLimitKey(key: string): boolean {
  return RUNTIME_SYSTEM_LIMIT_VARIABLES.some((v) => v.key === key);
}

export function runtimeSystemLimitByKey(key: string): RuntimeSystemLimitVariable | undefined {
  return RUNTIME_SYSTEM_LIMIT_VARIABLES.find((v) => v.key === key);
}
