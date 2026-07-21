"use client";

import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useComposer } from "@/lib/composer/store";
import type { Broker, GraphNode, GraphNodeKind } from "@/lib/composer/model";
import { Button } from "@/components/composer/ui";

const KIND_COLOR: Record<GraphNodeKind, string> = {
  trigger: "#6b7280",
  generator: "#178bea",
  orchestrator: "#9a63f9",
  subagent: "#9a63f9",
  executor: "#059669",
  router: "#d97706",
  echo: "#0891b2",
};

const PALETTE: GraphNodeKind[] = ["generator", "orchestrator", "subagent", "executor", "router", "echo"];

type ComposerNodeData = { node: GraphNode; selected: boolean };

function ComposerFlowNode({ data }: NodeProps<Node<ComposerNodeData>>) {
  const { node, selected } = data;
  const color = KIND_COLOR[node.kind];
  return (
    <div
      className={`min-w-[140px] rounded-md border bg-white shadow-sm ${selected ? "ring-2 ring-primary" : "border-gray-200"}`}
    >
      {node.kind !== "trigger" && <Handle type="target" position={Position.Top} />}
      <div className="rounded-t-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white" style={{ backgroundColor: color }}>
        {node.kind}
      </div>
      <div className="px-2 py-1.5">
        <p className="truncate text-sm font-medium text-gray-900">{node.name}</p>
        {node.label ? <p className="truncate text-[11px] text-gray-400">{node.label}</p> : null}
      </div>
      {node.kind !== "echo" && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}

const nodeTypes = { composer: ComposerFlowNode };

function computeNodes(broker: Broker, selectedId: string | null): Node<ComposerNodeData>[] {
  return broker.nodes.map((n) => ({
    id: n.id,
    type: "composer",
    position: n.position,
    data: { node: n, selected: n.id === selectedId },
  }));
}

function computeEdges(broker: Broker): Edge[] {
  const edges: Edge[] = [];
  for (const n of broker.nodes) {
    if (n.kind === "router") {
      for (const r of n.routes ?? []) {
        edges.push({
          id: `route-${r.id}`,
          source: n.id,
          target: r.targetNodeId,
          label: r.label || r.when,
          animated: false,
        });
      }
      if (n.otherwiseTargetNodeId) {
        edges.push({ id: `otherwise-${n.id}`, source: n.id, target: n.otherwiseTargetNodeId, label: "otherwise" });
      }
    } else if (n.onExitTarget) {
      edges.push({ id: `exit-${n.id}`, source: n.id, target: n.onExitTarget });
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
  const broker = project.brokers[0];

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node<ComposerNodeData>>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    if (!broker) return;
    setRfNodes(computeNodes(broker, selectedId));
    setRfEdges(computeEdges(broker));
  }, [broker, selectedId, setRfNodes, setRfEdges]);

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
      <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5 rounded-lg border border-gray-200 bg-white/90 p-1.5 shadow-sm backdrop-blur">
        {PALETTE.map((kind) => (
          <Button key={kind} variant="ghost" onClick={() => addNode(kind)} title={`Add ${kind}`}>
            + {kind}
          </Button>
        ))}
      </div>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodesDelete={onNodesDelete}
        onNodeDragStop={(_e, node) => dispatch({ type: "moveNode", id: node.id, position: node.position })}
        onNodeClick={(_e, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
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
