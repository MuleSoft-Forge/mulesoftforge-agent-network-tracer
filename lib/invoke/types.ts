import { inferA2AVersionFromCard } from "./a2a-version";

export type NodeStatus = "idle" | "active" | "complete" | "error";

export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
}

export interface AgentCard {
  name?: string;
  description?: string;
  version?: string;
  url?: string;
  protocolVersion?: string;
  supportedInterfaces?: Array<{
    url?: string;
    protocolVersion?: string;
    protocolBinding?: string;
  }>;
  skills?: AgentSkill[];
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
}

export interface InvokeMessage {
  id: string;
  role: "user" | "agent" | "error";
  content: string;
  timestamp: Date;
  /** Raw JSON-RPC body sent to the broker for this turn (user messages). */
  requestPayload?: unknown;
  /** Raw JSON-RPC (or error) body the broker returned for this turn (agent/error messages). */
  responsePayload?: unknown;
}

export type InvokeAuthType = "none" | "apiKey" | "basic" | "mulesoftClientIdSecret";

export interface InvokeAuthConfig {
  type: InvokeAuthType;
  apiKeyHeaderName: string;
  apiKeyValue: string;
  basicUsername: string;
  basicPassword: string;
  clientId: string;
  clientSecret: string;
}

export interface InvokeState {
  messages: InvokeMessage[];
  isProcessing: boolean;
  currentStep: string;
  nodeStatuses: Record<string, NodeStatus>;
  activeNodeId: string | null;
  agentCard: AgentCard | null;
  brokerUrl: string;
  a2aVersion: string;
  brokerLoaded: boolean;
  auth: InvokeAuthConfig;
  contextId: string | null;
}

export type InvokeAction =
  | { type: "SET_BROKER"; url: string; card: AgentCard | null; a2aVersion?: string }
  | { type: "SET_AUTH"; auth: Partial<InvokeAuthConfig> }
  | { type: "RESET_BROKER" }
  | { type: "SET_CONTEXT_ID"; contextId: string }
  | { type: "ADD_MESSAGE"; message: InvokeMessage }
  | {
      type: "SET_MESSAGE_PAYLOAD";
      messageId: string;
      requestPayload?: unknown;
      responsePayload?: unknown;
    }
  | { type: "SET_NODE_STATUS"; nodeId: string; status: NodeStatus }
  | { type: "SET_ACTIVE_NODE"; nodeId: string | null }
  | { type: "RESET_NODE_STATUSES" }
  | { type: "SET_PROCESSING"; value: boolean; step?: string }
  | { type: "SET_CURRENT_STEP"; step: string };

export const INITIAL_INVOKE_STATE: InvokeState = {
  messages: [],
  isProcessing: false,
  currentStep: "",
  nodeStatuses: {},
  activeNodeId: null,
  agentCard: null,
  brokerUrl: "",
  a2aVersion: "0.3",
  brokerLoaded: false,
  contextId: null,
  auth: {
    type: "none",
    apiKeyHeaderName: "x-api-key",
    apiKeyValue: "",
    basicUsername: "",
    basicPassword: "",
    clientId: "",
    clientSecret: "",
  },
};

export function invokeReducer(state: InvokeState, action: InvokeAction): InvokeState {
  switch (action.type) {
    case "SET_BROKER":
      return {
        ...state,
        brokerUrl: action.url,
        agentCard: action.card,
        a2aVersion: action.a2aVersion ?? inferA2AVersionFromCard(action.card),
        brokerLoaded: true,
        messages: [],
        nodeStatuses: {},
        activeNodeId: null,
        currentStep: "",
        isProcessing: false,
        contextId: null,
      };
    case "RESET_BROKER":
      return { ...INITIAL_INVOKE_STATE };
    case "SET_AUTH":
      return { ...state, auth: { ...state.auth, ...action.auth } };
    case "SET_CONTEXT_ID":
      return { ...state, contextId: action.contextId };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };
    case "SET_MESSAGE_PAYLOAD":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.messageId
            ? {
                ...m,
                requestPayload: action.requestPayload ?? m.requestPayload,
                responsePayload: action.responsePayload ?? m.responsePayload,
              }
            : m
        ),
      };
    case "SET_NODE_STATUS":
      return {
        ...state,
        nodeStatuses: { ...state.nodeStatuses, [action.nodeId]: action.status },
      };
    case "SET_ACTIVE_NODE":
      return { ...state, activeNodeId: action.nodeId };
    case "RESET_NODE_STATUSES":
      return { ...state, nodeStatuses: {}, activeNodeId: null, currentStep: "" };
    case "SET_PROCESSING":
      return {
        ...state,
        isProcessing: action.value,
        currentStep: action.step ?? (action.value ? state.currentStep : ""),
      };
    case "SET_CURRENT_STEP":
      return { ...state, currentStep: action.step };
    default: {
      const _exhaustive: never = action;
      return state;
    }
  }
}
