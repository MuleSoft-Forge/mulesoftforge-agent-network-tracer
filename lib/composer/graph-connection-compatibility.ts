import type { Broker, GraphNode } from "@/lib/composer/model";
import { isAllowedTransitionTarget } from "@/lib/composer/graph-transitions";

export type ConnectionSchema = "a2a.message" | "agent.turn";

export interface ConnectionEndpointRef {
  nodeId: string | null | undefined;
  handleId?: string | null;
}

export interface ConnectionCompatibility {
  ok: boolean;
  sourceSchema?: ConnectionSchema;
  targetAccepted?: ConnectionSchema[];
  reason?: string;
}

function sourceSchemaForNode(node: GraphNode): ConnectionSchema | null {
  switch (node.kind) {
    case "trigger":
      return "a2a.message";
    case "generator":
    case "orchestrator":
    case "subagent":
    case "executor":
    case "router":
    case "echo":
      return "agent.turn";
    default: {
      const _exhaustive: never = node.kind;
      return _exhaustive;
    }
  }
}

function acceptedSchemasForNode(node: GraphNode): ConnectionSchema[] {
  if (node.kind === "trigger") return [];
  return ["a2a.message", "agent.turn"];
}

export function checkConnectionCompatibility(
  broker: Broker,
  source: ConnectionEndpointRef,
  target: ConnectionEndpointRef
): ConnectionCompatibility {
  const sourceNode = source.nodeId ? broker.nodes.find((n) => n.id === source.nodeId) : undefined;
  const targetNode = target.nodeId ? broker.nodes.find((n) => n.id === target.nodeId) : undefined;
  if (!sourceNode || !targetNode) {
    return { ok: false, reason: "Missing source or target node." };
  }
  if (!isAllowedTransitionTarget(targetNode)) {
    return {
      ok: false,
      reason: `Cannot connect to "${targetNode.name}" — trigger only accepts inbound runtime events.`,
    };
  }
  const sourceSchema = sourceSchemaForNode(sourceNode);
  if (!sourceSchema) {
    return { ok: false, reason: `Node "${sourceNode.name}" is terminal and cannot emit transitions.` };
  }
  const targetAccepted = acceptedSchemasForNode(targetNode);
  if (!targetAccepted.includes(sourceSchema)) {
    return {
      ok: false,
      sourceSchema,
      targetAccepted,
      reason: `Schema mismatch: source emits ${sourceSchema}, target accepts ${targetAccepted.join(" | ")}.`,
    };
  }
  return { ok: true, sourceSchema, targetAccepted };
}

export function checkConnectionCompatibilityByIds(
  broker: Broker,
  sourceId: string,
  targetId: string,
  sourceHandle?: string | null,
  targetHandle?: string | null
): ConnectionCompatibility {
  return checkConnectionCompatibility(
    broker,
    { nodeId: sourceId, handleId: sourceHandle },
    { nodeId: targetId, handleId: targetHandle }
  );
}

