/** Factory helpers for constructing model pieces with sane defaults. */

import type {
  AssetKind,
  Broker,
  BrokerAction,
  ComposerProject,
  GraphNode,
  GraphNodeKind,
  ImportedAsset,
  LlmBinding,
} from "@/lib/composer/model";
import {
  CONNECTION_KIND_BY_KIND,
  connectionNameForAsset,
  toIdentifier,
} from "@/lib/composer/model";

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function createTriggerNode(targetId?: string): GraphNode {
  return {
    id: newId(),
    kind: "trigger",
    name: "trigger",
    interfaceName: "a2a",
    position: { x: 80, y: 200 },
    onExitTarget: targetId,
  };
}

export function createEchoNode(): GraphNode {
  return {
    id: newId(),
    kind: "echo",
    name: "response",
    position: { x: 520, y: 200 },
    echoKind: "a2a:status_update_event",
    state: "TASK_STATE_COMPLETED",
    message: "The request was processed by the network.",
  };
}

const NODE_DEFAULTS: Record<GraphNodeKind, Partial<GraphNode>> = {
  trigger: { interfaceName: "a2a" },
  generator: { prompt: "" },
  orchestrator: { reasoningInstructions: "", actionRefs: [] },
  subagent: { reasoningInstructions: "", actionRefs: [] },
  executor: {},
  router: { routes: [], otherwiseTargetNodeId: undefined },
  echo: { echoKind: "a2a:status_update_event", state: "TASK_STATE_COMPLETED", message: "" },
};

export function createNode(kind: GraphNodeKind, name: string, position: { x: number; y: number }): GraphNode {
  return {
    id: newId(),
    kind,
    name,
    position,
    ...NODE_DEFAULTS[kind],
  };
}

export function createBroker(name: string): Broker {
  const echo = createEchoNode();
  const trigger = createTriggerNode(echo.id);
  return {
    id: newId(),
    name,
    interfaceName: "a2a",
    card: {
      name,
      description: "",
      version: "1.0.0",
      capabilities: { streaming: false, pushNotifications: true },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [],
    },
    systemInstructions: "",
    defaultLlmBindingName: undefined,
    llmBindings: [],
    actions: [],
    nodes: [trigger, echo],
  };
}

export function createEmptyProject(organizationId = ""): ComposerProject {
  return {
    version: 1,
    identity: {
      name: "My Agent Network",
      organizationId,
      assetId: "my-agent-network",
      version: "1.0.0",
      descriptorVersion: "1.0.0",
      apiVersion: "v2.0",
    },
    assets: [],
    brokers: [createBroker("My Broker")],
    variableOverrides: {},
  };
}

export interface AssetImportInput {
  kind: AssetKind;
  groupId: string;
  assetId: string;
  version: string;
  name: string;
  description?: string;
  url?: string;
  namespace?: string;
  meta?: unknown;
}

/** Build an ImportedAsset from an Exchange selection, with derived defaults. */
export function importAsset(input: AssetImportInput): ImportedAsset {
  const baseName = toIdentifier(input.name || input.assetId);
  return {
    id: newId(),
    kind: input.kind,
    groupId: input.groupId,
    assetId: input.assetId,
    version: input.version,
    namespace: input.namespace || input.groupId,
    name: input.name || input.assetId,
    description: input.description,
    baseName,
    url: input.url ?? "",
    // LLMs typically need an API key; agents/MCP default to no auth (URL only).
    auth: input.kind === "llm" ? { kind: "apiKey" } : { kind: "none" },
    meta: input.meta,
  };
}

/** Create a broker action targeting an imported asset (agent -> a2a, mcp -> tool). */
export function createActionForAsset(asset: ImportedAsset): BrokerAction | null {
  const connectionName = connectionNameForAsset(asset);
  if (asset.kind === "agent") {
    return {
      id: newId(),
      name: toIdentifier(asset.name),
      actionKind: "a2a:send_message",
      connectionName,
    };
  }
  if (asset.kind === "mcp") {
    return {
      id: newId(),
      name: toIdentifier(asset.name),
      actionKind: "mcp:tool",
      connectionName,
      toolName: "",
    };
  }
  return null; // llm assets are bound via llmBindings, not actions
}

/** Create an LLM binding for an imported llm asset. */
export function createLlmBindingForAsset(asset: ImportedAsset): LlmBinding | null {
  if (asset.kind !== "llm") return null;
  const provider = guessProvider(asset);
  return {
    id: newId(),
    name: toIdentifier(asset.name),
    connectionName: connectionNameForAsset(asset),
    provider,
    model: provider === "Gemini" ? "gemini-2.5-flash" : "gpt-5-mini",
  };
}

function guessProvider(asset: ImportedAsset): "OpenAI" | "Gemini" {
  const hay = `${asset.name} ${asset.assetId}`.toLowerCase();
  if (hay.includes("gemini") || hay.includes("google")) return "Gemini";
  return "OpenAI";
}

/** Assert exhaustive handling of asset kinds where needed. */
export const CONNECTION_SCHEME = CONNECTION_KIND_BY_KIND;
