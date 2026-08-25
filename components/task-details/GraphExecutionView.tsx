"use client";

import { useCallback, useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Graph } from "@sf-agentscript/agentfabric-dialect";
import { protocolGraphToReactFlow } from "@/lib/composer/agentfabric-graph";
import { applyDagreOverviewLayout } from "@/lib/composer/agentfabric-graph-layout";
import type {
  AgentFabricGraphEdge,
  AgentFabricGraphNode,
  AgentFabricGraphNodeData,
} from "@/lib/composer/agentfabric-graph-types";
import { agentFabricNodeTypes } from "@/components/composer/graph/nodes";
import type { ExecutionOverlay } from "@/lib/task-timeline/execution-overlay";
import { canonicalNodeKey, edgeKey } from "@/lib/task-timeline/execution-overlay";
import type { NodeVisit } from "@/lib/task-timeline/build-v2-node-timeline";
import LoggingDetailNotice from "@/components/task-details/LoggingDetailNotice";

/** Un-traversed nodes stay legible but recede, so the path reads at a glance. */
const UNTRAVERSED_OPACITY = 0.34;

/**
 * Nodes the Object Store proves ran but that logs never described. Held between
 * the two so they read as entered without claiming the detail we do not have.
 */
const REACHED_WITHOUT_DETAIL_OPACITY = 0.72;

const TRAVERSED_STROKE = "#4f46e5";
const UNTRAVERSED_STROKE = "#d1d5db";

export interface GraphExecutionSource {
  agentFileName: string;
  version: string;
  /** False when the version was inferred from the task's start time. */
  versionPinned: boolean;
  brokerKey?: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

function GraphCanvas({
  graph,
  overlay,
  selectedNodeKey,
  onSelectVisit,
}: {
  graph: Graph;
  overlay: ExecutionOverlay;
  selectedNodeKey: string | null;
  onSelectVisit: (visit: NodeVisit) => void;
}) {
  const { fitView } = useReactFlow();

  const layout = useMemo(() => {
    const raw = protocolGraphToReactFlow(graph);
    return applyDagreOverviewLayout(raw.nodes, raw.edges);
  }, [graph]);

  // Execution is applied as presentation over the laid-out graph rather than by
  // building different nodes, so the cards stay byte-for-byte the Composer's.
  const nodes = useMemo<AgentFabricGraphNode[]>(
    () =>
      layout.nodes.map((node) => {
        const key = canonicalNodeKey(node.id);
        const exec = overlay.byNode.get(key);
        const reachedFromState = exec == null && overlay.reachedWithoutDetail.has(key);
        const isSelected = selectedNodeKey != null && key === selectedNodeKey;
        const badge =
          exec != null
            ? `#${exec.order} · ${formatDuration(exec.durationMs)}${
                exec.visitCount > 1 ? ` · ×${exec.visitCount}` : ""
              }${exec.isFinal ? " · ended here" : ""}`
            : reachedFromState
              ? "ran · no logged detail"
              : "not reached";
        const opacity = exec != null
          ? undefined
          : reachedFromState
            ? REACHED_WITHOUT_DETAIL_OPACITY
            : UNTRAVERSED_OPACITY;
        return {
          ...node,
          data: {
            ...node.data,
            // Reuse the card's existing subtitle slot to carry execution facts;
            // no change to the shared node components is needed.
            subtitle: badge,
          } as AgentFabricGraphNodeData,
          ...(opacity != null ? { style: { opacity } } : {}),
          ...(isSelected ? { className: "ring-2 ring-indigo-500 ring-offset-2 rounded-lg" } : {}),
        };
      }),
    [layout.nodes, overlay.byNode, overlay.reachedWithoutDetail, selectedNodeKey]
  );

  const edges = useMemo<AgentFabricGraphEdge[]>(
    () =>
      layout.edges.map((edge) => {
        const order = overlay.traversedEdges.get(edgeKey(edge.source, edge.target));
        const traversed = order != null;
        const existingLabel = typeof edge.label === "string" ? edge.label : undefined;
        const label = traversed
          ? existingLabel != null
            ? `${order} · ${existingLabel}`
            : String(order)
          : existingLabel;
        return {
          ...edge,
          animated: traversed,
          ...(label != null ? { label } : {}),
          labelStyle: { fontSize: 10, fill: traversed ? TRAVERSED_STROKE : "#9ca3af" },
          style: traversed
            ? { stroke: TRAVERSED_STROKE, strokeWidth: 2.5 }
            : { stroke: UNTRAVERSED_STROKE, strokeWidth: 1.5, strokeDasharray: "4 4", opacity: 0.7 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: traversed ? TRAVERSED_STROKE : UNTRAVERSED_STROKE,
          },
        };
      }),
    [layout.edges, overlay.traversedEdges]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void fitView({ padding: 0.2, duration: 200 });
    }, 0);
    return () => clearTimeout(timer);
  }, [fitView, layout.nodes]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: AgentFabricGraphNode) => {
      const exec = overlay.byNode.get(canonicalNodeKey(node.id));
      // Un-traversed nodes have no visit, so there is nothing to show; leave the
      // current selection alone rather than blanking the detail pane.
      if (exec != null) onSelectVisit(exec.visit);
    },
    [overlay.byNode, onSelectVisit]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={agentFabricNodeTypes}
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
    </ReactFlow>
  );
}

export interface GraphExecutionViewProps {
  graph: Graph;
  overlay: ExecutionOverlay;
  source: GraphExecutionSource;
  /** Nodes the logs report that the published graph does not declare. */
  driftedNodes: string[];
  selectedNodeKey: string | null;
  onSelectVisit: (visit: NodeVisit) => void;
  /** Per-task INSECURE-LOGGING status from Runtime Manager, when known. */
  insecureLoggingEnabled?: boolean;
}

/**
 * The path one invocation took through the broker's AgentScript graph.
 *
 * The Broker Activity diagram shows deployment topology and looks the same for
 * every task; this is per-task, drawn on the network's published definition so it
 * matches the Composer exactly, with this task's execution layered on top.
 */
export default function GraphExecutionView({
  graph,
  overlay,
  source,
  driftedNodes,
  selectedNodeKey,
  onSelectVisit,
  insecureLoggingEnabled,
}: GraphExecutionViewProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-100 px-3 py-1.5 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm bg-indigo-600" />
          path taken ({overlay.hops} {overlay.hops === 1 ? "hop" : "hops"})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm border border-dashed border-gray-400" />
          not taken
        </span>
        {overlay.reachedWithoutDetail.size > 0 && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-4 rounded-sm bg-indigo-600"
              style={{ opacity: REACHED_WITHOUT_DETAIL_OPACITY }}
            />
            ran, no logged detail
          </span>
        )}
        <LoggingDetailNotice
          hasUndetailedNodes={overlay.reachedWithoutDetail.size > 0}
          insecureLoggingEnabled={insecureLoggingEnabled}
        />
        <span className="truncate text-gray-400" title={source.agentFileName}>
          {source.agentFileName} @ {source.version}
          {!source.versionPinned && " (version inferred from when this task ran)"}
        </span>
        {overlay.byNode.size === 0 && (
          <span className="text-amber-700">
            {overlay.reachedWithoutDetail.size > 0
              ? "No graph-node logs were found, so the nodes marked as run come from the broker's persisted state, which records no ordering — hence no path."
              : "No graph-node logs were found for this task, so the definition is shown with nothing traversed."}
          </span>
        )}
        {driftedNodes.length > 0 && (
          <span className="text-amber-700">
            This task ran {driftedNodes.length === 1 ? "a node" : "nodes"} the published version
            does not declare ({driftedNodes.join(", ")}), so the deployed definition differs from
            what is drawn.
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <ReactFlowProvider>
          <GraphCanvas
            graph={graph}
            overlay={overlay}
            selectedNodeKey={selectedNodeKey}
            onSelectVisit={onSelectVisit}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
