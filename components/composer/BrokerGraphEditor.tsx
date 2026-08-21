"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
  type OnConnectStartParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, ChevronRight, LayoutTemplate } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import type { Broker, GraphNode, GraphNodeKind } from "@/lib/composer/model";
import type {
  AgentFabricGraphNodeData,
  NextStepSuggestion,
  NodeCoachItem,
  NodeCoachPanel,
  NodeIssueSeverity,
} from "@/lib/composer/agentfabric-graph-types";
import { nodePreviewText, nodeSummaryChips } from "@/lib/composer/node-summary";
import { type ValidationIssue } from "@/lib/composer/validate";
import { useValidationResult } from "@/lib/composer/validation/validation-context";
import {
  ROUTER_OTHERWISE_SLOT,
  routerCanvasOutputs,
  routerOutputHandleId,
  type RouterCanvasOutput,
} from "@/lib/composer/agentfabric-graph";
import { agentFabricNodeTypes } from "@/components/composer/graph/nodes";
import {
  COACH_POPUP_OFFSET,
  COACH_POPUP_WIDTH,
} from "@/components/composer/graph/nodes/NodeCoach";
import { composerEdgeTypes, type InsertableEdgeData } from "@/components/composer/graph/InsertableEdge";
import NodeKindPicker from "@/components/composer/graph/NodeKindPicker";
import CanvasSearch from "@/components/composer/graph/CanvasSearch";
import { matchNodeIds } from "@/lib/composer/node-search";
import { isEditorSurface, resolveShortcut } from "@/lib/composer/keyboard";
import NodePaletteButton from "@/components/composer/NodePaletteButton";
import { MuleIcon } from "@/components/composer/MuleIcon";
import { useHelpMode } from "@/lib/composer/help/help-mode";
import {
  checkConnectionCompatibilityByIds,
  type ConnectionSchema,
} from "@/lib/composer/graph-connection-compatibility";
import { NODE_WIDTH, placeNewNode } from "@/lib/composer/node-placement";
import { newId } from "@/lib/composer/factory";
import { accentForKind } from "@/components/composer/graph/kind-accent";
import { graphAdvice } from "@/lib/composer/graph/graph-advice";
import { outcomeLabelForKind } from "@/lib/composer/graph/plain-language";
import { nextNodeSuggestionsFor } from "@/lib/composer/graph/next-node-suggestions";
import type { ProjectFocusTarget } from "@/lib/composer/project-field-anchors";

const BASE_PALETTE: GraphNodeKind[] = ["generator", "orchestrator", "subagent", "executor", "router", "echo"];
/** Kinds that can receive a connection — trigger is unique. */
const CONNECTABLE_PALETTE: GraphNodeKind[] = ["generator", "orchestrator", "subagent", "executor", "router", "echo"];
const INSERTABLE_PALETTE: GraphNodeKind[] = ["generator", "orchestrator", "subagent", "executor", "router", "echo"];
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

interface ActiveConnectionDrag {
  sourceId: string;
  sourceHandle: string | null;
  schema: ConnectionSchema;
}

interface RepelPulse {
  x: number;
  y: number;
  reason: string;
  at: number;
}

interface EdgeContextMenuState {
  edgeId: string;
  x: number;
  y: number;
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

function sourceSchemaForKind(kind: GraphNodeKind): ConnectionSchema | null {
  switch (kind) {
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
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
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

/** Everything a node card needs to render its coaching footer and popups. */
interface CoachContext {
  /** Node whose popup is open, with which panel — at most one at a time. */
  open: { nodeId: string; panel: NodeCoachPanel; side: "left" | "right" } | null;
  itemsByNode: Map<string, NodeCoachItem[]>;
  nextStepsFor: (node: GraphNode) => NextStepSuggestion[];
  onOpen: (nodeId: string, panel: NodeCoachPanel) => void;
  onClose: () => void;
  onFocusItem: (item: NodeCoachItem) => void;
  onAddNext: (nodeId: string, kind: GraphNodeKind) => void;
}

function buildNodes({
  broker,
  selectedId,
  connectedHandles,
  nodeIssues,
  handleCompatibilityByNode,
  layoutDirection,
  coach,
}: {
  broker: Broker;
  selectedId: string | null;
  connectedHandles: Map<string, Set<string>>;
  nodeIssues: Map<string, NodeIssue>;
  handleCompatibilityByNode: Map<string, Partial<Record<string, "compatible" | "incompatible">>>;
  layoutDirection: "vertical" | "horizontal";
  coach: CoachContext;
}): AfFlowNode[] {
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

  function routerOutputsInVisualOrder(node: GraphNode): RouterCanvasOutput[] {
    const outputs = routerCanvasOutputs(node);
    if (layoutDirection !== "horizontal" || node.kind !== "router") return outputs;

    const nodeById = new Map(broker.nodes.map((candidate) => [candidate.id, candidate] as const));
    const targetYByHandle = new Map<string, number>();
    for (const route of node.routes ?? []) {
      if (!route.targetNodeId) continue;
      const target = nodeById.get(route.targetNodeId);
      if (!target) continue;
      targetYByHandle.set(routerOutputHandleId(route.id), target.position.y);
    }
    if (node.otherwiseTargetNodeId) {
      const target = nodeById.get(node.otherwiseTargetNodeId);
      if (target) targetYByHandle.set(routerOutputHandleId(ROUTER_OTHERWISE_SLOT), target.position.y);
    }

    const connectedOutputs = outputs.filter((output) => targetYByHandle.has(output.handleId));
    const disconnectedOutputs = outputs.filter((output) => !targetYByHandle.has(output.handleId));
    connectedOutputs.sort(
      (a, b) => (targetYByHandle.get(a.handleId) ?? 0) - (targetYByHandle.get(b.handleId) ?? 0)
    );
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
      handleCompatibility: handleCompatibilityByNode.get(n.id),
      onOpenCoach: () => coach.onOpen(n.id, "node"),
      coach: {
        nodeName: n.name,
        outcome: outcomeLabelForKind(n.kind),
        items: coach.itemsByNode.get(n.id) ?? [],
        nextSteps: coach.nextStepsFor(n),
        openPanel: coach.open?.nodeId === n.id ? coach.open.panel : null,
        openSide: coach.open?.nodeId === n.id ? coach.open.side : "right",
        onOpen: (panel) => coach.onOpen(n.id, panel),
        onClose: coach.onClose,
        onFocusItem: coach.onFocusItem,
        onAddNext: (kind) => coach.onAddNext(n.id, kind),
      },
    };
    if (n.kind === "executor") {
      data.executorIconKind = inferExecutorIconKind(n);
    }
    if (n.kind === "router") data.routerOutputs = routerOutputsInVisualOrder(n);
    return {
      id: n.id,
      type: nodeType,
      position: n.position,
      selected: n.id === selectedId,
      // The trigger is the entry point; removing it would strand the graph.
      deletable: n.kind !== "trigger",
      // Lift the card whose popup is open so neighbours cannot cover it.
      ...(coach.open?.nodeId === n.id ? { zIndex: 1000 } : {}),
      data,
    };
  });
}

function buildEdges(
  broker: Broker,
  connectedHandles: Map<string, Set<string>>,
  nodeIssues: Map<string, NodeIssue>,
  onInsert: InsertableEdgeData["onInsert"],
  layoutDirection: "vertical" | "horizontal"
): Edge[] {
  const edges: Edge[] = [];
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
  const nodeHasError = (nodeId: string): boolean =>
    (nodeIssues.get(nodeId)?.severity ?? "warning") === "error";

  for (const n of broker.nodes) {
    if (n.kind === "router") {
      for (const r of n.routes ?? []) {
        if (!r.targetNodeId) continue;
        const sourceHandle = routerOutputHandleId(r.id);
        mark(n.id, sourceHandle);
        mark(r.targetNodeId, "top");
        const compatibility = checkConnectionCompatibilityByIds(
          broker,
          n.id,
          r.targetNodeId,
          sourceHandle,
          linearTargetHandle
        );
        edges.push({
          id: `route-${r.id}`,
          type: "insertable",
          source: n.id,
          sourceHandle,
          target: r.targetNodeId,
          targetHandle: linearTargetHandle,
          label: r.label || r.when,
          data: {
            onInsert,
            flowActive:
              compatibility.ok &&
              !nodeHasError(n.id) &&
              !nodeHasError(r.targetNodeId),
          },
        });
      }
      if (n.otherwiseTargetNodeId) {
        const sourceHandle = routerOutputHandleId(ROUTER_OTHERWISE_SLOT);
        mark(n.id, sourceHandle);
        mark(n.otherwiseTargetNodeId, "top");
        const compatibility = checkConnectionCompatibilityByIds(
          broker,
          n.id,
          n.otherwiseTargetNodeId,
          sourceHandle,
          linearTargetHandle
        );
        edges.push({
          id: `otherwise-${n.id}`,
          type: "insertable",
          source: n.id,
          sourceHandle,
          target: n.otherwiseTargetNodeId,
          targetHandle: linearTargetHandle,
          label: "otherwise",
          data: {
            onInsert,
            flowActive:
              compatibility.ok &&
              !nodeHasError(n.id) &&
              !nodeHasError(n.otherwiseTargetNodeId),
          },
        });
      }
    } else if (n.onExitTarget) {
      mark(n.id, linearSourceHandle);
      mark(n.onExitTarget, linearTargetHandle);
      const compatibility = checkConnectionCompatibilityByIds(
        broker,
        n.id,
        n.onExitTarget,
        linearSourceHandle,
        linearTargetHandle
      );
      edges.push({
        id: `exit-${n.id}`,
        type: "insertable",
        source: n.id,
        sourceHandle: linearSourceHandle,
        target: n.onExitTarget,
        targetHandle: linearTargetHandle,
        data: {
          onInsert,
          flowActive:
            compatibility.ok &&
            !nodeHasError(n.id) &&
            !nodeHasError(n.onExitTarget),
        },
      });
    }
  }
  return edges;
}

function buildHandleCompatibilityMap(
  broker: Broker,
  activeConnection: ActiveConnectionDrag | null
): Map<string, Partial<Record<string, "compatible" | "incompatible">>> {
  const map = new Map<string, Partial<Record<string, "compatible" | "incompatible">>>();
  if (!activeConnection) return map;
  const sourceNodeHints = map.get(activeConnection.sourceId) ?? {};
  if (activeConnection.sourceHandle) {
    sourceNodeHints[activeConnection.sourceHandle] = "compatible";
  }
  map.set(activeConnection.sourceId, sourceNodeHints);
  for (const node of broker.nodes) {
    const handles: string[] = [];
    if (node.kind !== "trigger") {
      handles.push("top", "left");
    }
    if (handles.length === 0) continue;
    const result: Partial<Record<string, "compatible" | "incompatible">> = {};
    for (const handleId of handles) {
      const compatibility = checkConnectionCompatibilityByIds(
        broker,
        activeConnection.sourceId,
        node.id,
        activeConnection.sourceHandle,
        handleId
      );
      result[handleId] = compatibility.ok ? "compatible" : "incompatible";
    }
    map.set(node.id, result);
  }
  return map;
}

function InnerEditor({
  selectedId,
  onSelect,
  pendingCommand,
  onCommandHandled,
  onRequestFocus,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  pendingCommand?: CanvasCommand | null;
  onCommandHandled?: () => void;
  onRequestFocus?: (target: ProjectFocusTarget) => void;
}) {
  const { project, dispatch } = useComposer();
  const { helpMode } = useHelpMode();
  const broker = project.brokers[0];
  const layoutDirection = project.graphLayoutDirection ?? "vertical";
  const { fitView, screenToFlowPosition, flowToScreenPosition, getNode, getZoom } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<AfFlowNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [search, setSearch] = useState<SearchState | null>(null);
  const [activeConnection, setActiveConnection] = useState<ActiveConnectionDrag | null>(null);
  const [repelPulse, setRepelPulse] = useState<RepelPulse | null>(null);
  const [edgeContextMenu, setEdgeContextMenu] = useState<EdgeContextMenuState | null>(null);
  const [isAddNodeCollapsed, setIsAddNodeCollapsed] = useState(true);
  const [openCoach, setOpenCoach] = useState<CoachContext["open"]>(null);
  const [connectionReason, setConnectionReason] = useState<string | null>(null);

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
  const advice = useMemo(() => graphAdvice(project, broker, validation), [project, broker, validation]);

  const nodeIssues = useMemo(
    () => indexNodeIssues([...validation.errors, ...validation.warnings]),
    [validation]
  );
  const handleCompatibilityByNode = useMemo(
    () => buildHandleCompatibilityMap(broker, activeConnection),
    [broker, activeConnection]
  );

  const focusFromAdvice = useCallback(
    (target: { nodeId?: string; anchor?: string }) => {
      if (target.nodeId) onSelect(target.nodeId);
      onRequestFocus?.({
        tab: "graph",
        ...(target.nodeId ? { nodeId: target.nodeId } : {}),
        ...(target.anchor ? { anchor: target.anchor } : {}),
      });
    },
    [onRequestFocus, onSelect]
  );

  const coachItemsByNode = useMemo(() => {
    const map = new Map<string, NodeCoachItem[]>();
    for (const item of advice) {
      if (!item.nodeId) continue;
      const items = map.get(item.nodeId) ?? [];
      items.push({
        id: item.id,
        tier: item.tier,
        title: item.title,
        why: item.why,
        nodeId: item.nodeId,
        anchor: item.field,
      });
      map.set(item.nodeId, items);
    }
    return map;
  }, [advice]);

  const linearSourceHandle = layoutDirection === "horizontal" ? "right" : "bottom";

  const addSuggestedNode = useCallback(
    (sourceId: string, kind: GraphNodeKind) => {
      const id = newId();
      const position = placeNewNode(broker, kind, {
        anchorNodeId: sourceId,
        direction: layoutDirection,
      });
      dispatch({
        type: "addNode",
        kind,
        position,
        id,
        connectFrom: { nodeId: sourceId, sourceHandle: linearSourceHandle },
      });
      setOpenCoach(null);
      onSelect(id);
    },
    [broker, layoutDirection, linearSourceHandle, dispatch, onSelect]
  );

  /**
   * The popup is portalled inside the canvas, which clips overflow, so open it
   * on whichever side of the card still has room for it.
   */
  const coachSideFor = useCallback(
    (nodeId: string): "left" | "right" => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      const node = getNode(nodeId);
      if (!bounds || !node) return "right";
      const cardWidth = (node.measured?.width ?? NODE_WIDTH) * getZoom();
      const cardRight = flowToScreenPosition(node.position).x + cardWidth;
      return cardRight + COACH_POPUP_OFFSET + COACH_POPUP_WIDTH > bounds.right ? "left" : "right";
    },
    [getNode, getZoom, flowToScreenPosition]
  );

  const coachContext = useMemo<CoachContext>(
    () => ({
      open: openCoach,
      itemsByNode: coachItemsByNode,
      // Only offer successors while the exit is still free — a wired node has one.
      nextStepsFor: (node) => (node.onExitTarget ? [] : nextNodeSuggestionsFor(node)),
      onOpen: (nodeId, panel) =>
        setOpenCoach((current) =>
          current?.nodeId === nodeId && current.panel === panel
            ? null
            : { nodeId, panel, side: coachSideFor(nodeId) }
        ),
      onClose: () => setOpenCoach(null),
      onFocusItem: (item) => focusFromAdvice({ nodeId: item.nodeId, anchor: item.anchor }),
      onAddNext: addSuggestedNode,
    }),
    [openCoach, coachItemsByNode, coachSideFor, focusFromAdvice, addSuggestedNode]
  );

  // The model owns positions. New nodes are placed deliberately when added, so
  // the canvas only mirrors the model — adding or connecting never reflows a
  // layout the user arranged by hand. Use "Hierarchical layout" to reflow.
  useEffect(() => {
    if (!broker) return;
    const connectedHandles = new Map<string, Set<string>>();
    const edges = buildEdges(
      broker,
      connectedHandles,
      nodeIssues,
      handleInsertOnEdge,
      layoutDirection
    );
    const nodes = buildNodes({
      broker,
      selectedId,
      connectedHandles,
      nodeIssues,
      handleCompatibilityByNode,
      layoutDirection,
      coach: coachContext,
    });
    // While searching, fade everything that does not match so hits stand out.
    const dim = search?.query.trim() ? new Set(matchIds) : null;
    setRfNodes(dim ? nodes.map((n) => (dim.has(n.id) ? n : { ...n, style: { opacity: 0.2 } })) : nodes);
    setRfEdges(edges);
  }, [
    broker,
    selectedId,
    setRfNodes,
    setRfEdges,
    handleInsertOnEdge,
    nodeIssues,
    handleCompatibilityByNode,
    search,
    matchIds,
    layoutDirection,
    coachContext,
  ]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (!connection.source || !connection.target) return false;
      return checkConnectionCompatibilityByIds(
        broker,
        connection.source,
        connection.target,
        connection.sourceHandle,
        connection.targetHandle
      ).ok;
    },
    [broker]
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

  const onConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      if (!params.nodeId) return;
      const sourceNode = broker.nodes.find((n) => n.id === params.nodeId);
      if (!sourceNode) return;
      const schema = sourceSchemaForKind(sourceNode.kind);
      if (!schema) return;
      setActiveConnection({
        sourceId: params.nodeId,
        sourceHandle: params.handleId ?? null,
        schema,
      });
    },
    [broker.nodes]
  );

  /** Dropping a connection on empty canvas offers to create the target node there. */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      setActiveConnection(null);
      if (connectionState.isValid) {
        setConnectionReason(null);
        return;
      }
      const sourceId = connectionState.fromNode?.id;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      if (sourceId && connectionState.toNode?.id) {
        const incompatibility = checkConnectionCompatibilityByIds(
          broker,
          sourceId,
          connectionState.toNode.id,
          connectionState.fromHandle?.id ?? null,
          connectionState.toHandle?.id ?? null
        );
        if (!incompatibility.ok) {
          const reason = incompatibility.reason ?? "Incompatible connection.";
          setConnectionReason(reason);
          setRepelPulse({
            x: point.clientX,
            y: point.clientY,
            reason,
            at: Date.now(),
          });
          return;
        }
      }
      if (!sourceId) return;
      setPendingCreate({
        mode: "connect",
        sourceId,
        sourceHandle: connectionState.fromHandle?.id ?? null,
        screenX: point.clientX,
        screenY: point.clientY,
      });
    },
    [broker]
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

  const onEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      event.preventDefault();
      setEdgeContextMenu({ edgeId: edge.id, x: event.clientX, y: event.clientY });
    },
    []
  );

  const deleteEdgeFromContextMenu = useCallback(() => {
    if (!edgeContextMenu) return;
    const edge = rfEdges.find((e) => e.id === edgeContextMenu.edgeId);
    if (!edge) {
      setEdgeContextMenu(null);
      return;
    }
    dispatch({
      type: "disconnect",
      sourceId: edge.source,
      targetId: edge.target,
      sourceHandle: edge.sourceHandle,
    });
    setEdgeContextMenu(null);
  }, [edgeContextMenu, rfEdges, dispatch]);

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
      const position = placeNewNode(broker, kind, {
        anchorNodeId: selectedId,
        direction: layoutDirection,
      });
      dispatch({ type: "addNode", kind, position, id });
      onSelect(id);
      // Let the node mount before panning so it is never created off-screen.
      window.setTimeout(() => {
        void fitView({ padding: 0.25, duration: 250 });
      }, 0);
    },
    [broker, selectedId, layoutDirection, dispatch, onSelect, fitView]
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

  useEffect(() => {
    if (!repelPulse) return;
    const timer = window.setTimeout(() => setRepelPulse(null), 520);
    return () => window.clearTimeout(timer);
  }, [repelPulse]);

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
    <div ref={canvasRef} className="relative h-full w-full">
      <div className="absolute left-3 top-3 z-10 rounded-anypoint border border-composer-border bg-composer-surface/95 p-2 shadow-md backdrop-blur transition-anypoint">
        <button
          type="button"
          onClick={() => setIsAddNodeCollapsed((collapsed) => !collapsed)}
          className="flex w-full items-center justify-between gap-2 rounded-anypoint px-0.5 py-0.5 text-left text-xs font-semibold uppercase tracking-wide text-composer-label-muted transition-anypoint hover:bg-composer-surface-muted"
          aria-expanded={!isAddNodeCollapsed}
          aria-label={isAddNodeCollapsed ? "Expand add node panel" : "Collapse add node panel"}
        >
          <span>Add node</span>
          {isAddNodeCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {!isAddNodeCollapsed ? (
          <>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {palette.map((kind) => (
                <NodePaletteButton key={kind} kind={kind} onAdd={() => addNode(kind)} />
              ))}
            </div>
            {helpMode ? (
              <p className="mt-1.5 border-t border-composer-border px-0.5 pt-1.5 text-xs leading-snug text-composer-label-muted">
                Help mode is on — click <span className="font-medium text-primary">ⓘ</span> on any node to learn what it does before adding.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-anypoint border border-composer-border bg-composer-surface/95 p-1.5 text-xs shadow-md backdrop-blur">
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
        <div className="absolute inset-0 z-[5] flex items-center justify-center bg-white/70">
          <div className="flex max-w-md flex-col items-center gap-3 rounded-anypoint border border-composer-border bg-white px-6 py-5 text-center shadow-lg">
            <MuleIcon name="agentNetwork" size={112} className="opacity-35" />
            <p className="text-sm font-medium text-composer-label">Add a trigger to start your agent flow</p>
            <p className="text-xs leading-relaxed text-composer-label-muted">
              The trigger is the entry point for incoming messages. Use the palette to add one, then connect it to your graph.
            </p>
            <button
              type="button"
              className="rounded-anypoint bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
              onClick={() => addNode("trigger")}
            >
              Add trigger
            </button>
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
        onConnectStart={onConnectStart}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onConnectEnd={onConnectEnd}
        onEdgesDelete={onEdgesDelete}
        onEdgeContextMenu={onEdgeContextMenu}
        onNodesDelete={onNodesDelete}
        onNodeDragStop={(_e, node) => dispatch({ type: "moveNode", id: node.id, position: node.position })}
        onNodeClick={(_e, node) => onSelect(node.id)}
        onPaneClick={() => {
          onSelect(null);
          setEdgeContextMenu(null);
          setOpenCoach(null);
        }}
        fitView
        minZoom={0.15}
        maxZoom={1.5}
        connectionRadius={48}
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
      {repelPulse ? (
        <div
          className="pointer-events-none absolute z-20"
          style={{ left: repelPulse.x, top: repelPulse.y, transform: "translate(-50%, -50%)" }}
          title={repelPulse.reason}
        >
          <div className="h-20 w-20 animate-ping rounded-full border-4 border-red-400/70 bg-red-200/20" />
          <div className="-mt-14 rounded bg-red-50/95 px-2 py-1 text-[11px] font-medium text-red-700 shadow-sm ring-1 ring-red-200">
            Schema mismatch
          </div>
        </div>
      ) : null}
      {connectionReason ? (
        <div className="absolute bottom-16 right-3 z-20 max-w-sm rounded-anypoint border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 shadow">
          {connectionReason}
        </div>
      ) : null}
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
      {edgeContextMenu ? (
        <div
          className="fixed z-40 min-w-[160px] rounded-anypoint border border-composer-border bg-composer-surface p-1 shadow-lg"
          style={{ left: edgeContextMenu.x, top: edgeContextMenu.y }}
          onMouseLeave={() => setEdgeContextMenu(null)}
        >
          <button
            type="button"
            onClick={deleteEdgeFromContextMenu}
            className="w-full rounded-anypoint px-2 py-1.5 text-left text-xs text-red-700 transition-anypoint hover:bg-red-50"
          >
            Delete connector
          </button>
        </div>
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
  onRequestFocus?: (target: ProjectFocusTarget) => void;
}) {
  return (
    <ReactFlowProvider>
      <InnerEditor {...props} />
    </ReactFlowProvider>
  );
}
