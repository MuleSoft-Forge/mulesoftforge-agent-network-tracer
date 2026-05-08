export type NodeStatus = "idle" | "active" | "complete" | "error";
export type TraceEventType = "routing" | "api_call" | "response" | "error";

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
  skills?: AgentSkill[];
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
}

export interface MessageAttribution {
  name: string;
  nodeType: string;
}

export interface InvokeMessage {
  id: string;
  role: "user" | "agent" | "error";
  content: string;
  attribution?: MessageAttribution[];
  timestamp: Date;
}

export interface TraceEvent {
  id: string;
  timestamp: Date;
  type: TraceEventType;
  message: string;
  data?: unknown;
}

export type SidebarTab = "chat" | "trace" | "settings";

export interface InvokeState {
  messages: InvokeMessage[];
  traceEvents: TraceEvent[];
  isProcessing: boolean;
  currentStep: string;
  nodeStatuses: Record<string, NodeStatus>;
  activeNodeId: string | null;
  agentCard: AgentCard | null;
  brokerUrl: string;
  brokerLoaded: boolean;
  simulateLatency: boolean;
  simulateErrors: boolean;
  verbosity: "low" | "medium" | "high";
  sidebarTab: SidebarTab;
}

export type InvokeAction =
  | { type: "SET_BROKER"; url: string; card: AgentCard | null }
  | { type: "RESET_BROKER" }
  | { type: "ADD_MESSAGE"; message: InvokeMessage }
  | { type: "ADD_TRACE"; event: TraceEvent }
  | { type: "SET_NODE_STATUS"; nodeId: string; status: NodeStatus }
  | { type: "SET_ACTIVE_NODE"; nodeId: string | null }
  | { type: "RESET_NODE_STATUSES" }
  | { type: "SET_PROCESSING"; value: boolean; step?: string }
  | { type: "SET_CURRENT_STEP"; step: string }
  | { type: "SET_SIMULATE_LATENCY"; value: boolean }
  | { type: "SET_SIMULATE_ERRORS"; value: boolean }
  | { type: "SET_VERBOSITY"; value: "low" | "medium" | "high" }
  | { type: "SET_SIDEBAR_TAB"; tab: SidebarTab }
  | { type: "CLEAR_TRACE" };

export const INITIAL_INVOKE_STATE: InvokeState = {
  messages: [],
  traceEvents: [],
  isProcessing: false,
  currentStep: "",
  nodeStatuses: {},
  activeNodeId: null,
  agentCard: null,
  brokerUrl: "",
  brokerLoaded: false,
  simulateLatency: true,
  simulateErrors: false,
  verbosity: "medium",
  sidebarTab: "chat",
};

export function invokeReducer(state: InvokeState, action: InvokeAction): InvokeState {
  switch (action.type) {
    case "SET_BROKER":
      return {
        ...state,
        brokerUrl: action.url,
        agentCard: action.card,
        brokerLoaded: true,
        messages: [],
        traceEvents: [],
        nodeStatuses: {},
        activeNodeId: null,
        currentStep: "",
        isProcessing: false,
      };
    case "RESET_BROKER":
      return {
        ...INITIAL_INVOKE_STATE,
        simulateLatency: state.simulateLatency,
        simulateErrors: state.simulateErrors,
        verbosity: state.verbosity,
      };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };
    case "ADD_TRACE":
      return { ...state, traceEvents: [...state.traceEvents, action.event] };
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
    case "SET_SIMULATE_LATENCY":
      return { ...state, simulateLatency: action.value };
    case "SET_SIMULATE_ERRORS":
      return { ...state, simulateErrors: action.value };
    case "SET_VERBOSITY":
      return { ...state, verbosity: action.value };
    case "SET_SIDEBAR_TAB":
      return { ...state, sidebarTab: action.tab };
    case "CLEAR_TRACE":
      return { ...state, traceEvents: [] };
    default: {
      const _exhaustive: never = action;
      return state;
    }
  }
}
