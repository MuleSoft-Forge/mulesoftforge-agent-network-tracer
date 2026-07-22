"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Graph } from "@sf-agentscript/agentfabric-dialect";
import { extractAgentFabricGraph } from "@/lib/composer/agentscript-graph";
import { lexicalPositionForNode, protocolGraphToReactFlow } from "@/lib/composer/agentfabric-graph";
import { applyDagreOverviewLayout } from "@/lib/composer/agentfabric-graph-layout";
import { agentFabricNodeTypes } from "@/components/composer/graph/nodes";

const defaultEdgeOptions = {
  style: { stroke: "#64748b", strokeWidth: 2 },
  markerEnd: {
    type: "arrowclosed" as const,
    color: "#64748b",
    width: 18,
    height: 18,
  },
};

function GraphCanvas({
  graph,
  onNodeClick,
}: {
  graph: Graph;
  onNodeClick?: (nodeId: string) => void;
}) {
  const { fitView } = useReactFlow();
  const layout = useMemo(() => {
    const raw = protocolGraphToReactFlow(graph);
    return applyDagreOverviewLayout(raw.nodes, raw.edges);
  }, [graph]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fitView({ padding: 0.2, duration: 200 });
    }, 0);
    return () => clearTimeout(timer);
  }, [fitView, layout.nodes]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick]
  );

  return (
    <ReactFlow
      nodes={layout.nodes}
      edges={layout.edges}
      nodeTypes={agentFabricNodeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      onNodeClick={handleNodeClick}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      fitView
      minZoom={0.15}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={16} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}

export interface AgentFabricGraphViewProps {
  source: string;
  /** Called with 0-based line/character when a node with source range is clicked. */
  onNavigateToSource?: (position: { line: number; character: number }) => void;
}

export default function AgentFabricGraphView({ source, onNavigateToSource }: AgentFabricGraphViewProps) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(() => {
      void extractAgentFabricGraph(source).then((result) => {
        if (cancelled) return;
        setGraph(result.graph);
        setErrors(result.parseErrors);
        setLoading(false);
      });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source]);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      if (!graph || !onNavigateToSource) return;
      const position = lexicalPositionForNode(graph, nodeId);
      if (position) onNavigateToSource(position);
    },
    [graph, onNavigateToSource]
  );

  if (loading && !graph) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-gray-400">
        Building graph…
      </div>
    );
  }

  if (errors.length > 0 && !graph) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-xs font-medium text-amber-700">Could not build graph</p>
        <ul className="max-w-md space-y-1 text-[11px] text-amber-600">
          {errors.slice(0, 4).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-gray-400">
        No graph nodes in script
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <GraphCanvas graph={graph} onNodeClick={onNavigateToSource ? handleNodeClick : undefined} />
    </ReactFlowProvider>
  );
}
