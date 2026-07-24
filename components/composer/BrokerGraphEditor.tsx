"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useComposer } from "@/lib/composer/store";
import type { Broker, GraphNode, GraphNodeKind } from "@/lib/composer/model";
import type { AgentFabricGraphNodeData } from "@/lib/composer/agentfabric-graph-types";
import { applyDagreOverviewLayout } from "@/lib/composer/agentfabric-graph-layout";
import { brokerTopologyKey } from "@/lib/composer/broker-graph-layout";
import { routerOutputHandleId } from "@/lib/composer/agentfabric-graph";
import { agentFabricNodeTypes } from "@/components/composer/graph/nodes";
import NodePaletteButton from "@/components/composer/NodePaletteButton";
import { useHelpMode } from "@/lib/composer/help/help-mode";

const PALETTE: GraphNodeKind[] = ["generator", "orchestrator", "subagent", "executor", "router", "echo"];

const defaultEdgeOptions = {
  style: { stroke: "#64748b", strokeWidth: 2 },
  markerEnd: {
    type: "arrowclosed" as const,
    color: "#64748b",
    width: 18,
    height: 18,
  },
};

type AfFlowNode = Node<AgentFabricGraphNodeData>;

/** React Flow node `type` for a model node, matching the official AgentFabric mapper. */
function nodeTypeForKind(kind: GraphNodeKind): AgentFabricGraphNodeData["nodeType"] {
  if (kind === "trigger") return "af-trigger";
  if (kind === "router") return "af-router";
  return "af-node";
}

/** Encode route labels into the protocol's comma-separated `outputs` string. */
function encodeProtocolOutputs(outputs: string[]): string {
  return outputs.map((o) => o.replace(/\\/g, "\\\\").replace(/,/g, "\\,")).join(",");
}

/** Ordered output labels for a router node (route labels + otherwise). */
function routerOutputs(node: GraphNode): string[] {
  const outputs = (node.routes ?? []).map((r) => (r.label || r.when || "route").trim());
  if (node.otherwiseTargetNodeId) outputs.push("otherwise");
  return outputs;
}

function buildNodes(
  broker: Broker,
  selectedId: string | null,
  connectedHandles: Map<string, Set<string>>
): AfFlowNode[] {
  return broker.nodes.map((n) => {
    const nodeType = nodeTypeForKind(n.kind);
    const data: AgentFabricGraphNodeData = {
      nodeType,
      label: n.name,
      subtitle: n.label || n.kind,
      blockType: n.kind,
      kind: n.kind,
      connectedHandles: connectedHandles.get(n.id) ?? new Set<string>(),
    };
    if (n.kind === "router") data.outputs = encodeProtocolOutputs(routerOutputs(n));
    return {
      id: n.id,
      type: nodeType,
      position: n.position,
      selected: n.id === selectedId,
      data,
    };
  });
}

function buildEdges(broker: Broker, connectedHandles: Map<string, Set<string>>): Edge[] {
  const edges: Edge[] = [];
  const mark = (nodeId: string, handle: string) => {
    let set = connectedHandles.get(nodeId);
    if (!set) {
      set = new Set<string>();
      connectedHandles.set(nodeId, set);
    }
    set.add(handle);
  };

  for (const n of broker.nodes) {
    if (n.kind === "router") {
      for (const r of n.routes ?? []) {
        if (!r.targetNodeId) continue;
        const output = (r.label || r.when || "route").trim();
        const sourceHandle = routerOutputHandleId(output);
        mark(n.id, sourceHandle);
        mark(r.targetNodeId, "top");
        edges.push({
          id: `route-${r.id}`,
          source: n.id,
          sourceHandle,
          target: r.targetNodeId,
          targetHandle: "top",
          label: r.label || r.when,
        });
      }
      if (n.otherwiseTargetNodeId) {
        const sourceHandle = routerOutputHandleId("otherwise");
        mark(n.id, sourceHandle);
        mark(n.otherwiseTargetNodeId, "top");
        edges.push({
          id: `otherwise-${n.id}`,
          source: n.id,
          sourceHandle,
          target: n.otherwiseTargetNodeId,
          targetHandle: "top",
          label: "otherwise",
        });
      }
    } else if (n.onExitTarget) {
      mark(n.id, "bottom");
      mark(n.onExitTarget, "top");
      edges.push({
        id: `exit-${n.id}`,
        source: n.id,
        sourceHandle: "bottom",
        target: n.onExitTarget,
        targetHandle: "top",
      });
    }
  }
  return edges;
}

function InnerEditor({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { project, dispatch } = useComposer();
  const { helpMode } = useHelpMode();
  const broker = project.brokers[0];
  const { fitView } = useReactFlow();

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<AfFlowNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const topologyKey = useMemo(() => (broker ? brokerTopologyKey(broker) : ""), [broker]);
  const laidOutTopology = useRef<string | null>(null);

  useEffect(() => {
    if (!broker) return;

    if (topologyKey !== laidOutTopology.current) {
      laidOutTopology.current = topologyKey;
      const layout = applyDagreOverviewLayout(
        buildNodes(broker, selectedId, new Map()),
        buildEdges(broker, new Map())
      );

      const positions: Record<string, { x: number; y: number }> = {};
      for (const node of layout.nodes) positions[node.id] = node.position;
      dispatch({ type: "layoutNodes", positions });

      setRfNodes(
        layout.nodes.map((node) => ({
          ...node,
          selected: node.id === selectedId,
        }))
      );
      setRfEdges(layout.edges);

      const timer = setTimeout(() => {
        void fitView({ padding: 0.2, duration: 200 });
      }, 0);
      return () => clearTimeout(timer);
    }

    const connectedHandles = new Map<string, Set<string>>();
    const edges = buildEdges(broker, connectedHandles);
    setRfNodes(buildNodes(broker, selectedId, connectedHandles));
    setRfEdges(edges);
  }, [broker, selectedId, topologyKey, dispatch, setRfNodes, setRfEdges, fitView]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target) dispatch({ type: "connect", sourceId: c.source, targetId: c.target });
    },
    [dispatch]
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const e of deleted) dispatch({ type: "disconnect", sourceId: e.source, targetId: e.target });
    },
    [dispatch]
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const n of deleted) dispatch({ type: "removeNode", id: n.id });
    },
    [dispatch]
  );

  const addNode = useCallback(
    (kind: GraphNodeKind) => {
      dispatch({ type: "addNode", kind, position: { x: 260, y: 60 + Math.random() * 260 } });
    },
    [dispatch]
  );

  if (!broker) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-400">No broker.</div>;
  }

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-3 top-3 z-10 max-w-md rounded-lg border border-gray-200 bg-white/95 p-1.5 shadow-sm backdrop-blur">
        <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Add node</p>
        <div className="flex flex-wrap gap-1">
          {PALETTE.map((kind) => (
            <NodePaletteButton key={kind} kind={kind} onAdd={() => addNode(kind)} />
          ))}
        </div>
        {helpMode ? (
          <p className="mt-1 border-t border-gray-100 px-1 pt-1 text-[10px] leading-snug text-gray-500">
            Help mode is on — click <span className="font-medium text-primary">ⓘ</span> on any node to learn what it does before adding.
          </p>
        ) : null}
      </div>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={agentFabricNodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodesDelete={onNodesDelete}
        onNodeDragStop={(_e, node) => dispatch({ type: "moveNode", id: node.id, position: node.position })}
        onNodeClick={(_e, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        fitView
        minZoom={0.15}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-gray-50" />
      </ReactFlow>
    </div>
  );
}

export default function BrokerGraphEditor(props: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <ReactFlowProvider>
      <InnerEditor {...props} />
    </ReactFlowProvider>
  );
}
