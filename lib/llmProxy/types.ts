/**
 * Types for the LLM Proxy playground.
 *
 * Backed by the Anypoint API Manager endpoints observed in the HAR trace:
 *   - List:    GET /apimanager/api/v1/organizations/{orgId}/environments/{envId}/apis?filters[endpointType]=llm
 *   - Detail:  GET /apimanager/api/v1/.../apis/{instanceId}?includeProxyConfiguration=true&includeTlsContexts=true
 *   - Upstreams, policies, apiAsset for the selected instance.
 *   - Chat:    POST <publicEndpoint><basePath>/chat/completions  (or /responses) with client_id/client_secret headers.
 */

/**
 * One row from API Manager `apis[].routing` (header / model rules → upstream ids).
 */
export interface LlmProxyRoutingRule {
  label: string;
  /** e.g. `x-routing-header: openai` when rules use header matching. */
  matchSummary: string | null;
  /** Upstream UUIDs from API Manager for this route. */
  upstreamIds: string[];
}

export interface LlmProxyListItem {
  /** API instance ID (numeric, as returned by api/v1). */
  id: string;
  /** Exchange asset id (string). */
  assetId: string;
  /** Display name of the LLM Proxy. */
  name: string;
  /** Exchange group id (owner org). */
  groupId: string;
  /** Asset version. */
  assetVersion: string;
  /** Inbound endpoint URI (e.g. https://gateway.example.com or null). */
  endpointUri: string | null;
  /** Base path configured on the proxy (e.g. /llm-proxy). */
  basePath: string | null;
  /** Deployment status as reported by API Manager (e.g. "active", "failed"). */
  deploymentStatus: string | null;
  /** From policies or `metadata.globalRouting.llmConfigs.routingType` when present. */
  routingStrategy: "model-based" | "semantic" | "unknown";
  /** Named routes from API Manager `routing` (e.g. Route OpenAI / Route Gemini). */
  routes?: LlmProxyRoutingRule[];
  /** From `metadata.globalRouting.llmConfigs` when the proxy defines a fallback. */
  fallbackRoute?: string | null;
  fallbackModel?: string | null;
  /** Semantic routing: similarity threshold below which fallback applies (when API returns it). */
  fallbackThreshold?: number | null;
  /**
   * Semantic routing: `metadata.globalRouting.llmConfigs.denyTopicIDs` — Prompt Guard deny-list
   * topic ids (shown only when strategy is semantic).
   */
  denyTopicIds?: string[];
}

export interface LlmProxyListResponse {
  total: number;
  instances: LlmProxyListItem[];
}

export interface LlmProxyUpstream {
  /** Upstream id in API Manager. */
  id?: string;
  /** Upstream label (used by API Manager UI; often the provider slug). */
  label?: string;
  /** Upstream URI (provider endpoint). */
  uri?: string;
  /** Target model configured on the route (e.g. "gpt-5-mini"). */
  targetModel?: string;
  /** Inbound format for this route (openai | gemini). */
  format?: string;
  /** Provider slug (e.g. "openai", "azureopenai", "gemini"). */
  provider?: string;
  /** Prompt topic IDs attached to this route (semantic routing only). */
  promptTopicIds?: string[];
}

export interface LlmProxyPolicy {
  /** Policy id. */
  id?: string | number;
  /** Template asset id (e.g. "semantic-routing-policy-openai"). */
  assetId?: string;
  /** Template group id. */
  groupId?: string;
  /** Policy display name. */
  policyTemplateName?: string;
}

export interface LlmProxyDetail {
  id: string;
  name: string;
  assetId: string;
  groupId: string;
  assetVersion: string;
  /** Public endpoint of the Flex Gateway (inbound URI minus basePath, if derivable). */
  publicEndpoint: string | null;
  /** Base path configured on the proxy. */
  basePath: string | null;
  /** Inbound endpoint format (openai | gemini | unknown). */
  endpointFormat: "openai" | "gemini" | "unknown";
  upstreams: LlmProxyUpstream[];
  policies: LlmProxyPolicy[];
  routingStrategy: "model-based" | "semantic" | "unknown";
  /** From API Manager instance `routing` when returned on detail GET. */
  routes?: LlmProxyRoutingRule[];
  fallbackRoute?: string | null;
  fallbackModel?: string | null;
  fallbackThreshold?: number | null;
  denyTopicIds?: string[];
}

// ============================================================================
// Chat request / response
// ============================================================================

export type LlmProxyChatEndpoint = "/chat/completions" | "/responses";

export interface LlmProxyChatRequest {
  endpoint: LlmProxyChatEndpoint;
  /** Public endpoint of the Flex Gateway (e.g. "https://gateway.example.com"). */
  publicEndpoint: string;
  /** Base path configured on the proxy (e.g. "/llm-proxy"). */
  basePath: string;
  clientId: string;
  clientSecret: string;
  /** Raw payload forwarded verbatim to the LLM Proxy. */
  payload: Record<string, unknown>;
}

/** Minimal OpenAI-compatible message shape for chat UI. */
export interface ChatMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string;
  /** Only set for tool messages. */
  tool_call_id?: string;
}

/** Credentials saved per-proxy in localStorage. */
export interface SavedCredentials {
  publicEndpoint: string;
  basePath: string;
  clientId: string;
  clientSecret: string;
}

export const CREDENTIALS_STORAGE_PREFIX = "llm-proxy-creds:";

// ============================================================================
// Prompt topics (dynamic sidebar)
// ============================================================================

/**
 * A prompt topic loaded from the Anypoint Semantic Service. Each topic carries
 * up to 10 example utterances used for either semantic routing (when
 * `usedForDenyList=false`) or the Semantic Prompt Guard (when `usedForDenyList=true`).
 */
export interface LlmProxyPromptTopic {
  id: string;
  name: string;
  usedForDenyList: boolean;
  /** Raw utterance strings when obtainable (xapi access); empty otherwise. */
  utterances: string[];
  /**
   * Total number of utterances configured on this topic, inferred from the
   * embeddings array length in the policy configuration. Available even when
   * xapi blocks utterance-body retrieval.
   */
  utteranceCount: number;
  /** Route label when this topic is attached to a semantic-routing upstream; null for deny-list. */
  routeLabel: string | null;
}

export interface LlmProxyPromptTopicsResponse {
  topics: LlmProxyPromptTopic[];
  /** Reserved for future use if the API needs to signal auth failure separately. */
  unauthorized?: boolean;
}

// ============================================================================
// Per-reply chat metadata
// ============================================================================

/** OpenAI-compatible usage block. */
export interface LlmProxyUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/**
 * Metadata captured from a single chat reply: headers proxied from the Flex
 * Gateway (`x-llm-proxy-*` plus a few response-level headers like content-type)
 * and, when available, the `usage` block from the response body.
 */
export interface LlmProxyChatMeta {
  headers: Record<string, string>;
  usage?: LlmProxyUsage | null;
  /** Endpoint that was hit for this reply (captured at request time). */
  endpoint?: LlmProxyChatEndpoint;
}

/**
 * Highlights on the proxy network diagram after a chat response: which hops were
 * traversed. Segments are [client→Flex Gateway, Gateway→LLM Proxy, Proxy→upstream].
 */
export interface LlmProxyRouteTrace {
  edges: [boolean, boolean, boolean];
  provider?: string;
  model?: string;
  /** True when `x-llm-proxy-routing-fallback` indicates traffic used fallback routing. */
  routingFallback?: boolean;
  /**
   * Prompt matched the semantic deny list (403 or `x-llm-proxy-*`); highlight Deny list on the diagram.
   */
  denyListMatch?: boolean;
  /** e.g. topic id from error JSON when `denyListMatch`. */
  denyTopicLabel?: string;
}
