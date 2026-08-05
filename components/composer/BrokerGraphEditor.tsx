"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  type FinalConnectionState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { LayoutTemplate } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import type { Broker, GraphNode, GraphNodeKind } from "@/lib/composer/model";
import type {
  AgentFabricGraphNodeData,
  NodeIssueSeverity,
} from "@/lib/composer/agentfabric-graph-types";
import { nodePreviewText, nodeSummaryChips } from "@/lib/composer/node-summary";
import { type ValidationIssue } from "@/lib/composer/validate";
import { useValidationResult } from "@/lib/composer/validation/validation-context";
import { routeOutputLabel, routerOutputHandleId, routerCanvasOutputs } from "@/lib/composer/agentfabric-graph";
import { agentFabricNodeTypes } from "@/components/composer/graph/nodes";
import { composerEdgeTypes, type InsertableEdgeData } from "@/components/composer/graph/InsertableEdge";
import NodeKindPicker from "@/components/composer/graph/NodeKindPicker";
import CanvasSearch from "@/components/composer/graph/CanvasSearch";
import { matchNodeIds } from "@/lib/composer/node-search";
import { isEditorSurface, resolveShortcut } from "@/lib/composer/keyboard";
import NodePaletteButton from "@/components/composer/NodePaletteButton";
import { MuleIcon } from "@/components/composer/MuleIcon";
import { useHelpMode } from "@/lib/composer/help/help-mode";
import { isAllowedTransitionTarget } from "@/lib/composer/graph-transitions";
import { placeNewNode } from "@/lib/composer/node-placement";
import { newId } from "@/lib/composer/factory";
import { accentForKind } from "@/components/composer/graph/kind-accent";

const BASE_PALETTE: GraphNodeKind[] = ["generator", "orchestrator", "subagent", "executor", "router", "echo"];
/** Kinds that can continue a flow — trigger is unique and echo is terminal. */
const CONNECTABLE_PALETTE: GraphNodeKind[] = ["generator", "orchestrator", "subagent", "executor", "router", "echo"];
const INSERTABLE_PALETTE: GraphNodeKind[] = ["generator", "orchestrator", "subagent", "executor", "router"];
const ALL_KINDS: GraphNodeKind[] = ["trigger", ...BASE_PALETTE];

function isGraphNodeKind(value: string): value is GraphNodeKind {
  return (ALL_KINDS as string[]).includes(value);
}

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

interface NodeIssue {
  severity: NodeIssueSeverity;
  messages: string[];
}

/** A node-kind choice the user still has to make, from a dropped edge or an edge `+`. */
type PendingCreate =
  | {
      mode: "connect";
      sourceId: string;
      sourceHandle: string | null;
      screenX: number;
      screenY: number;
    }
  | { mode: "insert"; edgeId: string; screenX: number; screenY: number };

interface SearchState {
  query: string;
  /** Index into the current match list, advanced by Enter. */
  cursor: number;
}

/** Canvas actions the command palette can trigger from outside the editor. */
export type CanvasCommand =
  | { kind: "addNode"; nodeKind: string }
  | { kind: "resetLayout" };

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

/** Worst severity plus a tooltip for each node that validation flagged. */
function indexNodeIssues(issues: ValidationIssue[]): Map<string, NodeIssue> {
  const byNode = new Map<string, NodeIssue>();
  for (const issue of issues) {
    const nodeId = issue.location.nodeId;
    if (!nodeId) continue;
    if (issue.severity !== "error" && issue.severity !== "warning") continue;
    const existing = byNode.get(nodeId);
    if (!existing) {
      byNode.set(nodeId, { severity: issue.severity, messages: [issue.message] });
      continue;
    }
    existing.messages.push(issue.message);
    if (issue.severity === "error") existing.severity = "error";
  }
  return byNode;
}

function buildNodes(
  broker: Broker,
  selectedId: string | null,
  connectedHandles: Map<string, Set<string>>,
  nodeIssues: Map<string, NodeIssue>,
  layoutDirection: "vertical" | "horizontal"
): AfFlowNode[] {
  const actionKindByName = new Map(
    broker.actions.map((action) => [action.name, action.actionKind] as const)
  );

  function inferExecutorIconKind(node: GraphNode): AgentFabricGraphNodeData["executorIconKind"] {
    const statements = node.executorStatements ?? [];
    if (statements.length === 0) return "executor";
    const runStatements = statements.filter((s) => s.kind === "run");
    if (runStatements.length === 0) return "setVariable";
    const runKinds = runStatements
      .map((s) => (s.actionName ? actionKindByName.get(s.actionName) : undefined))
      .filter((k): k is "a2a:send_message" | "mcp:tool" => k === "a2a:send_message" || k === "mcp:tool");
    if (runKinds.length !== runStatements.length) return "executor";
    if (runKinds.every((k) => k === "mcp:tool")) return "mcp";
    if (runKinds.every((k) => k === "a2a:send_message")) return "a2a";
    return "executor";
  }

  function routerOutputsInVisualOrder(node: GraphNode): string[] {
    const outputs = routerCanvasOutputs(node);
    if (layoutDirection !== "horizontal" || node.kind !== "router") return outputs;

    const nodeById = new Map(broker.nodes.map((candidate) => [candidate.id, candidate] as const));
    const targetYByOutput = new Map<string, number>();
    for (const route of node.routes ?? []) {
      if (!route.targetNodeId) continue;
      const target = nodeById.get(route.targetNodeId);
      if (!target) continue;
      targetYByOutput.set(routeOutputLabel(route), target.position.y);
    }
    if (node.otherwiseTargetNodeId) {
      const target = nodeById.get(node.otherwiseTargetNodeId);
      if (target) targetYByOutput.set("otherwise", target.position.y);
    }

    const connectedOutputs = outputs.filter((output) => targetYByOutput.has(output));
    const disconnectedOutputs = outputs.filter((output) => !targetYByOutput.has(output));
    connectedOutputs.sort((a, b) => (targetYByOutput.get(a) ?? 0) - (targetYByOutput.get(b) ?? 0));
    return [...connectedOutputs, ...disconnectedOutputs];
  }

  return broker.nodes.map((n) => {
    const nodeType = nodeTypeForKind(n.kind);
    const issue = nodeIssues.get(n.id);
    const data: AgentFabricGraphNodeData = {
      nodeType,
      label: n.name,
      subtitle: n.label || n.kind,
      blockType: n.kind,
      kind: n.kind,
      connectedHandles: connectedHandles.get(n.id) ?? new Set<string>(),
      terminal: n.kind === "echo",
      summaryChips: nodeSummaryChips(n, broker),
      preview: nodePreviewText(n),
      issueSeverity: issue?.severity,
      issueSummary: issue?.messages.join("\n"),
    };
    if (n.kind === "executor") {
      data.executorIconKind = inferExecutorIconKind(n);
    }
    if (n.kind === "router") data.outputs = encodeProtocolOutputs(routerOutputsInVisualOrder(n));
    return {
      id: n.id,
      type: nodeType,
      position: n.position,
      selected: n.id === selectedId,
      // The trigger is the entry point; removing it would strand the graph.
      deletable: n.kind !== "trigger",
      data,
    };
  });
}

function buildEdges(
  broker: Broker,
  connectedHandles: Map<string, Set<string>>,
  onInsert: InsertableEdgeData["onInsert"],
  layoutDirection: "vertical" | "horizontal"
): Edge[] {
  const edges: Edge[] = [];
  const data: InsertableEdgeData = { onInsert };
  const linearSourceHandle = layoutDirection === "horizontal" ? "right" : "bottom";
  const linearTargetHandle = layoutDirection === "horizontal" ? "left" : "top";
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
        const output = routeOutputLabel(r);
        const sourceHandle = routerOutputHandleId(output);
        mark(n.id, sourceHandle);
        mark(r.targetNodeId, "top");
        edges.push({
          id: `route-${r.id}`,
          type: "insertable",
          source: n.id,
          sourceHandle,
          target: r.targetNodeId,
          targetHandle: linearTargetHandle,
          label: r.label || r.when,
          data,
        });
      }
      if (n.otherwiseTargetNodeId) {
        const sourceHandle = routerOutputHandleId("otherwise");
        mark(n.id, sourceHandle);
        mark(n.otherwiseTargetNodeId, "top");
        edges.push({
          id: `otherwise-${n.id}`,
          type: "insertable",
          source: n.id,
          sourceHandle,
          target: n.otherwiseTargetNodeId,
          targetHandle: linearTargetHandle,
          label: "otherwise",
          data,
        });
      }
    } else if (n.onExitTarget) {
      mark(n.id, linearSourceHandle);
      mark(n.onExitTarget, linearTargetHandle);
      edges.push({
        id: `exit-${n.id}`,
        type: "insertable",
        source: n.id,
        sourceHandle: linearSourceHandle,
        target: n.onExitTarget,
        targetHandle: linearTargetHandle,
        data,
      });
    }
  }
  return edges;
}

function InnerEditor({
  selectedId,
  onSelect,
  pendingCommand,
  onCommandHandled,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  pendingCommand?: CanvasCommand | null;
  onCommandHandled?: () => void;
}) {
  const { project, dispatch } = useComposer();
  const { helpMode } = useHelpMode();
  const broker = project.brokers[0];
  const layoutDirection = project.graphLayoutDirection ?? "vertical";
  const { fitView, screenToFlowPosition } = useReactFlow();

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<AfFlowNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [search, setSearch] = useState<SearchState | null>(null);

  const matchIds = useMemo(
    () => (search ? matchNodeIds(broker, search.query) : []),
    [search, broker]
  );

  const handleInsertOnEdge = useCallback<NonNullable<InsertableEdgeData["onInsert"]>>(
    (edgeId, screenX, screenY) => {
      setPendingCreate({ mode: "insert", edgeId, screenX, screenY });
    },
    []
  );

  const validation = useValidationResult();
  const nodeIssues = useMemo(
    () => indexNodeIssues([...validation.errors, ...validation.warnings]),
    [validation]
  );

  // The model owns positions. New nodes are placed deliberately when added, so
  // the canvas only mirrors the model — adding or connecting never reflows a
  // layout the user arranged by hand. Use "Hierarchical layout" to reflow.
  useEffect(() => {
    if (!broker) return;
    const connectedHandles = new Map<string, Set<string>>();
    const edges = buildEdges(broker, connectedHandles, handleInsertOnEdge, layoutDirection);
    const nodes = buildNodes(broker, selectedId, connectedHandles, nodeIssues, layoutDirection);
    // While searching, fade everything that does not match so hits stand out.
    const dim = search?.query.trim() ? new Set(matchIds) : null;
    setRfNodes(dim ? nodes.map((n) => (dim.has(n.id) ? n : { ...n, style: { opacity: 0.2 } })) : nodes);
    setRfEdges(edges);
  }, [broker, selectedId, setRfNodes, setRfEdges, handleInsertOnEdge, nodeIssues, search, matchIds, layoutDirection]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const targetNode = broker.nodes.find((n) => n.id === connection.target);
      return isAllowedTransitionTarget(targetNode);
    },
    [broker.nodes]
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target && isValidConnection(c)) {
        dispatch({
          type: "connect",
          sourceId: c.source,
          targetId: c.target,
          sourceHandle: c.sourceHandle,
        });
      }
    },
    [dispatch, isValidConnection]
  );

  /** Dropping a connection on empty canvas offers to create the target node there. */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectionState.isValid) return;
      const sourceId = connectionState.fromNode?.id;
      if (!sourceId) return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      setPendingCreate({
        mode: "connect",
        sourceId,
        sourceHandle: connectionState.fromHandle?.id ?? null,
        screenX: point.clientX,
        screenY: point.clientY,
      });
    },
    []
  );

  const resolvePendingCreate = useCallback(
    (kind: GraphNodeKind) => {
      if (!pendingCreate || !broker) return;
      const id = newId();
      const position = screenToFlowPosition({
        x: pendingCreate.screenX,
        y: pendingCreate.screenY,
      });

      if (pendingCreate.mode === "connect") {
        dispatch({
          type: "addNode",
          kind,
          position,
          id,
          connectFrom: { nodeId: pendingCreate.sourceId, sourceHandle: pendingCreate.sourceHandle },
        });
      } else {
        const edge = rfEdges.find((e) => e.id === pendingCreate.edgeId);
        if (!edge) {
          setPendingCreate(null);
          return;
        }
        dispatch({
          type: "insertNodeOnEdge",
          kind,
          position,
          id,
          sourceId: edge.source,
          targetId: edge.target,
          sourceHandle: edge.sourceHandle,
        });
      }

      setPendingCreate(null);
      onSelect(id);
    },
    [pendingCreate, broker, screenToFlowPosition, dispatch, rfEdges, onSelect]
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const e of deleted) {
        dispatch({
          type: "disconnect",
          sourceId: e.source,
          targetId: e.target,
          sourceHandle: e.sourceHandle,
        });
      }
    },
    [dispatch]
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const n of deleted) dispatch({ type: "removeNode", id: n.id });
    },
    [dispatch]
  );

  const palette = useMemo(() => {
    if (!broker) return BASE_PALETTE;
    const hasTrigger = broker.nodes.some((n) => n.kind === "trigger");
    return hasTrigger ? BASE_PALETTE : (["trigger", ...BASE_PALETTE] as GraphNodeKind[]);
  }, [broker]);

  const addNode = useCallback(
    (kind: GraphNodeKind) => {
      if (!broker) return;
      const id = newId();
      const position = placeNewNode(broker, kind, { anchorNodeId: selectedId });
      dispatch({ type: "addNode", kind, position, id });
      onSelect(id);
      // Let the node mount before panning so it is never created off-screen.
      window.setTimeout(() => {
        void fitView({ padding: 0.25, duration: 250 });
      }, 0);
    },
    [broker, selectedId, dispatch, onSelect, fitView]
  );

  /** Select and centre the next search hit, wrapping at the end. */
  const focusNextMatch = useCallback(() => {
    if (matchIds.length === 0) return;
    setSearch((s) => (s ? { ...s, cursor: (s.cursor + 1) % matchIds.length } : s));
    const nodeId = matchIds[(search?.cursor ?? 0) % matchIds.length];
    onSelect(nodeId);
    void fitView({ nodes: [{ id: nodeId }], padding: 0.6, duration: 250, maxZoom: 1 });
  }, [matchIds, search?.cursor, onSelect, fitView]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditorSurface(event.target)) return;
      if (resolveShortcut(event) !== "canvasSearch") return;
      event.preventDefault();
      setSearch((s) => s ?? { query: "", cursor: 0 });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const resetToHierarchicalLayout = useCallback((direction?: "vertical" | "horizontal") => {
    dispatch({ type: "resetGraphLayoutToHierarchical", direction: direction ?? layoutDirection });
    window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 200 });
    }, 0);
  }, [dispatch, fitView, layoutDirection]);

  useEffect(() => {
    if (!pendingCommand) return;
    if (pendingCommand.kind === "addNode") {
      if (isGraphNodeKind(pendingCommand.nodeKind)) addNode(pendingCommand.nodeKind);
    } else {
      resetToHierarchicalLayout();
    }
    onCommandHandled?.();
  }, [pendingCommand, addNode, resetToHierarchicalLayout, onCommandHandled]);

  if (!broker) {
    return <div className="flex h-full items-center justify-center text-sm text-composer-label-muted">No broker.</div>;
  }

  const missingTrigger = !broker.nodes.some((n) => n.kind === "trigger");

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-3 top-3 z-10 rounded-anypoint border border-composer-border bg-composer-surface/95 p-2 shadow-md backdrop-blur transition-anypoint">
        <p className="px-0.5 pb-1.5 text-xs font-semibold uppercase tracking-wide text-composer-label-muted">Add node</p>
        <div className="grid grid-cols-3 gap-1.5">
          {palette.map((kind) => (
            <NodePaletteButton key={kind} kind={kind} onAdd={() => addNode(kind)} />
          ))}
        </div>
        {helpMode ? (
          <p className="mt-1.5 border-t border-composer-border px-0.5 pt-1.5 text-xs leading-snug text-composer-label-muted">
            Help mode is on — click <span className="font-medium text-primary">ⓘ</span> on any node to learn what it does before adding.
          </p>
        ) : null}
      </div>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-anypoint border border-composer-border bg-composer-surface/95 p-1.5 text-xs shadow-md backdrop-blur">
        <button
          type="button"
          onClick={() => resetToHierarchicalLayout("vertical")}
          title="Reflow top-to-bottom hierarchy and persist direction"
          className={`inline-flex items-center gap-1 rounded-anypoint px-2 py-1 font-medium transition-anypoint ${
            layoutDirection === "vertical"
              ? "bg-composer-surface-muted text-composer-label"
              : "text-composer-label-muted hover:bg-composer-surface-muted"
          }`}
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
          Vertical
        </button>
        <button
          type="button"
          onClick={() => resetToHierarchicalLayout("horizontal")}
          title="Reflow left-to-right hierarchy and persist direction"
          className={`rounded-anypoint px-2 py-1 font-medium transition-anypoint ${
            layoutDirection === "horizontal"
              ? "bg-composer-surface-muted text-composer-label"
              : "text-composer-label-muted hover:bg-composer-surface-muted"
          }`}
        >
          Horizontal
        </button>
      </div>
      {search ? (
        <CanvasSearch
          query={search.query}
          matchCount={matchIds.length}
          onQueryChange={(query) => setSearch({ query, cursor: 0 })}
          onNext={focusNextMatch}
          onClose={() => setSearch(null)}
        />
      ) : null}
      {missingTrigger ? (
        <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
          <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
            <MuleIcon name="agentNetwork" size={112} className="opacity-35" />
            <p className="text-sm font-medium text-composer-label">Add a trigger to start your agent flow</p>
            <p className="text-xs leading-relaxed text-composer-label-muted">
              The trigger is the entry point for incoming messages. Use the palette to add one, then connect it to your graph.
            </p>
          </div>
        </div>
      ) : null}
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={agentFabricNodeTypes}
        edgeTypes={composerEdgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onConnectEnd={onConnectEnd}
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
        <MiniMap
          pannable
          zoomable
          className="!bg-gray-50"
          nodeColor={(node) => accentForKind((node.data as AgentFabricGraphNodeData).kind)}
          nodeStrokeWidth={0}
        />
      </ReactFlow>
      {pendingCreate ? (
        <NodeKindPicker
          kinds={pendingCreate.mode === "insert" ? INSERTABLE_PALETTE : CONNECTABLE_PALETTE}
          screenX={pendingCreate.screenX}
          screenY={pendingCreate.screenY}
          title={pendingCreate.mode === "insert" ? "Insert node" : "Connect to new node"}
          onPick={resolvePendingCreate}
          onDismiss={() => setPendingCreate(null)}
        />
      ) : null}
    </div>
  );
}

export default function BrokerGraphEditor(props: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Canvas action requested from the command palette, cleared once handled. */
  pendingCommand?: CanvasCommand | null;
  onCommandHandled?: () => void;
}) {
  return (
    <ReactFlowProvider>
      <InnerEditor {...props} />
    </ReactFlowProvider>
  );
}
