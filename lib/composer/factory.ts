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
import { normalizeAnfId } from "@/lib/composer/anf-id";
import { defaultAuthForAssetKind } from "@/lib/composer/connectivity/defaults";
import { defaultLlmBaseUrlForAsset } from "@/lib/composer/connectivity/llm-default-urls";
import { mcpMetaForAsset, tagCachedMcpMeta } from "@/lib/composer/mcp-metadata";
import { actionInputsForMcpTool } from "@/lib/composer/mcp-action-inputs";
import { defaultNodeDescription, nodeKindRequiresDescription } from "@/lib/composer/node-description";

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
    ...(nodeKindRequiresDescription(kind) ? { description: defaultNodeDescription(kind, name) } : {}),
    ...NODE_DEFAULTS[kind],
  };
}

/** @param key Broker map key (snake_case). @param displayName A2A card name; defaults to key. */
export function createBroker(key: string, displayName?: string): Broker {
  const echo = createEchoNode();
  const trigger = createTriggerNode(echo.id);
  const cardName = displayName ?? key;
  return {
    id: newId(),
    name: key,
    interfaceName: "a2a",
    card: {
      name: cardName,
      description: cardName,
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

/** Minimal broker shell for a new blank project — no graph nodes or prefilled card text. */
export function createBlankBroker(): Broker {
  return {
    id: newId(),
    name: "",
    interfaceName: "a2a",
    card: {
      name: "",
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
    nodes: [],
  };
}

export function createEmptyProject(organizationId = ""): ComposerProject {
  return {
    version: 1,
    identity: {
      name: "",
      organizationId,
      assetId: "",
      version: "0.0.0",
      descriptorVersion: "1.0.0",
      apiVersion: "v1.0",
      tags: [],
    },
    assets: [],
    brokers: [createBlankBroker()],
    policyBindings: {},
    variableOverrides: {},
    customVariables: [],
  };
}

/** Workable starter defaults for tests — not used for user "Start blank". */
export function createScaffoldProject(organizationId = ""): ComposerProject {
  return {
    version: 1,
    identity: {
      name: "My Agent Network",
      organizationId,
      assetId: "my-agent-network",
      version: "0.0.0",
      descriptorVersion: "1.0.0",
      apiVersion: "v1.0",
      tags: ["broker"],
    },
    assets: [],
    brokers: [createBroker("my_broker", "My Broker")],
    policyBindings: {},
    variableOverrides: {},
    customVariables: [],
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
  const baseName = normalizeAnfId(input.name || input.assetId, "asset");
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
    url:
      input.url?.trim() ||
      (input.kind === "llm"
        ? defaultLlmBaseUrlForAsset({
            name: input.name || input.assetId,
            assetId: input.assetId,
            description: input.description,
          })
        : ""),
    authentication: defaultAuthForAssetKind(input.kind, baseName),
    meta: input.meta ? tagCachedMcpMeta(input.meta, input.assetId) : undefined,
  };
}

/** Unique action name among existing broker actions. */
export function uniqueActionName(base: string, used: Set<string>, fallback = "action"): string {
  let name = toIdentifier(base, fallback);
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let i = 2;
  while (used.has(`${name}${i}`)) i += 1;
  name = `${name}${i}`;
  used.add(name);
  return name;
}

/** One MCP tool action targeting an imported MCP asset. */
export function createMcpToolAction(
  asset: ImportedAsset,
  toolName: string,
  usedNames: Set<string>
): BrokerAction {
  const connectionName = connectionNameForAsset(asset);
  const assetBase = toIdentifier(asset.baseName || asset.name || asset.assetId);
  const toolBase = toIdentifier(toolName);
  const nameBase = toolBase === assetBase ? toolBase : `${assetBase}_${toolBase}`;
  const inputs = actionInputsForMcpTool(asset, toolName);
  return {
    id: newId(),
    name: uniqueActionName(nameBase, usedNames, toolBase),
    actionKind: "mcp:tool",
    connectionName,
    toolName,
    ...(inputs?.length ? { inputs } : {}),
  };
}

/** MCP actions: one per catalog tool when metadata is present, otherwise a single empty action. */
export function createActionsForMcpAsset(asset: ImportedAsset, usedNames: Set<string>): BrokerAction[] {
  const meta = mcpMetaForAsset(asset);
  if (meta && meta.tools.length > 0) {
    return meta.tools.map((tool) => createMcpToolAction(asset, tool.name, usedNames));
  }
  const created = createActionForAsset(asset);
  if (!created) return [];
  created.name = uniqueActionName(created.name, usedNames);
  return [created];
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
