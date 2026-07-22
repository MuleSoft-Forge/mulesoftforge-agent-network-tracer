"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Position,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useComposer } from "@/lib/composer/store";
import { assetsReferencedByBroker } from "@/lib/composer/model";

const ASSET_COLOR: Record<string, string> = {
  agent: "#9a63f9",
  mcp: "#00b5d1",
  llm: "#178bea",
};

export default function TopologyView() {
  const { project } = useComposer();
  const broker = project.brokers[0];
  const referencedAssets = useMemo(
    () => assetsReferencedByBroker(project, broker),
    [project, broker]
  );

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const brokerId = "broker";

    if (broker) {
      nodes.push({
        id: brokerId,
        position: { x: 40, y: 220 },
        data: { label: `${broker.card.name || broker.name}\n(broker)` },
        sourcePosition: Position.Right,
        style: {
          background: "#059669",
          color: "white",
          border: "none",
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          width: 170,
          whiteSpace: "pre-line",
          textAlign: "center",
        },
      });
    }

    referencedAssets.forEach((asset, i) => {
      nodes.push({
        id: asset.id,
        position: { x: 380, y: 40 + i * 90 },
        data: { label: `${asset.name}` },
        targetPosition: Position.Left,
        style: {
          background: "white",
          color: "#111827",
          border: `2px solid ${ASSET_COLOR[asset.kind] ?? "#9ca3af"}`,
          borderRadius: 8,
          fontSize: 12,
          width: 180,
          textAlign: "center",
        },
      });
      if (broker) {
        edges.push({
          id: `e-${asset.id}`,
          source: brokerId,
          target: asset.id,
          animated: true,
          label: asset.kind,
        });
      }
    });
    return { nodes, edges };
  }, [broker, referencedAssets]);

  if (!broker) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-sm text-gray-400">
        No broker configured yet.
      </div>
    );
  }

  if (referencedAssets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-sm text-gray-400">
        No assets referenced by the broker yet. Wire agents, MCP servers, or LLMs via Actions or LLM bindings on the
        Broker tab — network-level dependencies alone do not appear here.
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} proOptions={{ hideAttribution: true }}>
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}
