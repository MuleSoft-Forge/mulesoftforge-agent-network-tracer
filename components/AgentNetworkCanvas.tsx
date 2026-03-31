"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { CanonicalGraph, CanonicalNode, CanonicalEdge } from "@/lib/agent-network-types";
import type { EdgeStyle, NodeFilters, CanvasLayout } from "@/components/CanvasOptionsMenu";
import CanvasOptionsMenu from "@/components/CanvasOptionsMenu";
import {
  calculateTreeLayout,
  calculateRadialLayout,
  applyRepulsion,
} from "@/lib/layouts/canvas-layouts";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 56;
const NODE_ICON_SIZE = 32;
const NODE_PAD = 8;
const PAD = 24;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
const ZOOM_SENSITIVITY = 0.001;
const CANVAS_SIZE = 2000; // Large canvas for freeform movement

interface AgentNetworkCanvasProps {
  graph: CanonicalGraph | null;
  edgeStyle?: EdgeStyle;
  onEdgeStyleChange?: (style: EdgeStyle) => void;
  layout?: CanvasLayout;
  onLayoutChange?: (layout: CanvasLayout) => void;
  nodeFilters?: NodeFilters;
  onNodeFiltersChange?: (filters: NodeFilters) => void;
  className?: string;
}

const BEND_OFFSET = 48;

const NODE_TYPE_COLORS: Record<string, { stroke: string; label: string }> = {
  BROKER: { stroke: "#059669", label: "Broker" },
  AGENT: { stroke: "#9a63f9", label: "Agent" },
  MCP: { stroke: "#00b5d1", label: "MCP" },
  LLM: { stroke: "#178bea", label: "LLM" },
};

export default function AgentNetworkCanvas({
  graph,
  edgeStyle = "straight",
  onEdgeStyleChange,
  layout = "tree",
  onLayoutChange,
  nodeFilters = { showAgents: true, showMCPServers: true, showLLM: true },
  onNodeFiltersChange,
  className = "",
}: AgentNetworkCanvasProps) {
  // All hooks must be called before any conditional returns
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: CANVAS_SIZE, height: CANVAS_SIZE });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [nodeDragStart, setNodeDragStart] = useState({ x: 0, y: 0 });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastContainerSizeRef = useRef<{ w: number; h: number } | null>(null);
  const initialFitDoneRef = useRef(false);
  const justDraggedRef = useRef(false);
  // Local state for node positions that can be updated by dragging
  const [localPositions, setLocalPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  // Pan handlers - only pan if not dragging a node
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.target === svgRef.current) {
        setSelectedNodeId(null); // Clear selection when clicking canvas background
      }
      if (e.button === 0 && draggedNodeId === null) {
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
      }
    },
    [draggedNodeId]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (draggedNodeId && svgRef.current) {
        // Dragging a node
        const rect = svgRef.current.getBoundingClientRect();
        const dx = (e.clientX - nodeDragStart.x) * (viewBox.width / rect.width);
        const dy = (e.clientY - nodeDragStart.y) * (viewBox.height / rect.height);

        setLocalPositions((prev) => {
          const newPositions = new Map(prev);
          const currentPos = newPositions.get(draggedNodeId);
          if (currentPos) {
            newPositions.set(draggedNodeId, {
              x: currentPos.x + dx,
              y: currentPos.y + dy,
            });
          }
          return newPositions;
        });

        setNodeDragStart({ x: e.clientX, y: e.clientY });
      } else if (isDragging && draggedNodeId === null && svgRef.current) {
        // Panning the canvas
        const rect = svgRef.current.getBoundingClientRect();
        const dx = (e.clientX - dragStart.x) * (viewBox.width / rect.width);
        const dy = (e.clientY - dragStart.y) * (viewBox.height / rect.height);
        setViewBox((prev) => ({
          x: prev.x - dx,
          y: prev.y - dy,
          width: prev.width,
          height: prev.height,
        }));
        setDragStart({ x: e.clientX, y: e.clientY });
      }
    },
    [isDragging, dragStart, viewBox, draggedNodeId, nodeDragStart]
  );

  const handleMouseUp = useCallback(() => {
    if (draggedNodeId) {
      justDraggedRef.current = true;
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 0);
    }
    setIsDragging(false);
    setDraggedNodeId(null);
  }, [draggedNodeId]);

  // Node drag handlers
  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent<SVGGElement>, nodeId: string) => {
      e.stopPropagation(); // Prevent canvas pan
      if (e.button === 0) {
        setDraggedNodeId(nodeId);
        setNodeDragStart({ x: e.clientX, y: e.clientY });
        setIsDragging(false); // Disable canvas pan
      }
    },
    []
  );

  // Zoom handler - zoom towards mouse position
  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      if (!svgRef.current) return;

      const rect = svgRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Convert mouse position to SVG coordinates
      const svgX = viewBox.x + (mouseX / rect.width) * viewBox.width;
      const svgY = viewBox.y + (mouseY / rect.height) * viewBox.height;

      const delta = e.deltaY * ZOOM_SENSITIVITY;
      const zoomFactor = 1 - delta;
      const newWidth = Math.max(
        CANVAS_SIZE / MAX_ZOOM,
        Math.min(CANVAS_SIZE / MIN_ZOOM, viewBox.width * zoomFactor)
      );
      const newHeight = Math.max(
        CANVAS_SIZE / MAX_ZOOM,
        Math.min(CANVAS_SIZE / MIN_ZOOM, viewBox.height * zoomFactor)
      );

      // Adjust viewBox to zoom towards mouse position
      setViewBox({
        x: svgX - (mouseX / rect.width) * newWidth,
        y: svgY - (mouseY / rect.height) * newHeight,
        width: newWidth,
        height: newHeight,
      });
    },
    [viewBox]
  );

  // Zoom in handler - zoom towards center
  const handleZoomIn = useCallback(() => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const svgX = viewBox.x + (centerX / rect.width) * viewBox.width;
    const svgY = viewBox.y + (centerY / rect.height) * viewBox.height;

    const zoomFactor = 0.8; // Zoom in by 20%
    const newWidth = Math.max(
      CANVAS_SIZE / MAX_ZOOM,
      viewBox.width * zoomFactor
    );
    const newHeight = Math.max(
      CANVAS_SIZE / MAX_ZOOM,
      viewBox.height * zoomFactor
    );

    setViewBox({
      x: svgX - (centerX / rect.width) * newWidth,
      y: svgY - (centerY / rect.height) * newHeight,
      width: newWidth,
      height: newHeight,
    });
  }, [viewBox]);

  // Zoom out handler - zoom from center
  const handleZoomOut = useCallback(() => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const svgX = viewBox.x + (centerX / rect.width) * viewBox.width;
    const svgY = viewBox.y + (centerY / rect.height) * viewBox.height;

    const zoomFactor = 1.25; // Zoom out by 25%
    const newWidth = Math.min(
      CANVAS_SIZE / MIN_ZOOM,
      viewBox.width * zoomFactor
    );
    const newHeight = Math.min(
      CANVAS_SIZE / MIN_ZOOM,
      viewBox.height * zoomFactor
    );

    setViewBox({
      x: svgX - (centerX / rect.width) * newWidth,
      y: svgY - (centerY / rect.height) * newHeight,
      width: newWidth,
      height: newHeight,
    });
  }, [viewBox]);

  // Calculate positions using useMemo to avoid recalculating on every render
  // Use nodeCount and layout as dependencies
  const nodeCount = graph && graph.nodes ? graph.nodes.length : 0;
  const initialPositions = useMemo(() => {
    const posMap = new Map<string, { x: number; y: number }>();
    if (!graph || graph.nodes.length === 0) {
      return posMap;
    }

    // Check if nodes have existing positions (from dragging)
    const hasExistingPositions = graph.nodes.some(
      (n) => n.position && n.position.x !== 0 && n.position.y !== 0
    );

    if (hasExistingPositions) {
      // Use existing positions if they exist (user has dragged nodes)
      graph.nodes.forEach((n) => {
        if (n.position && n.position.x !== 0 && n.position.y !== 0) {
          posMap.set(n.id, n.position);
        }
      });
    } else {
      // Calculate layout (tree or radial)
      const layoutPositions =
        layout === "radial"
          ? calculateRadialLayout(graph)
          : calculateTreeLayout(graph);
      const repulsedPositions =
        layout === "tree"
          ? applyRepulsion(layoutPositions, graph)
          : layoutPositions;

      repulsedPositions.forEach((pos, id) => {
        posMap.set(id, pos);
      });
    }

    return posMap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeCount, layout]);

  // Initialize local positions from graph when it changes
  useEffect(() => {
    if (initialPositions.size > 0) {
      setLocalPositions(new Map(initialPositions));
    } else {
      // Clear local positions if graph is empty
      setLocalPositions(new Map());
    }
  }, [initialPositions]);

  // Reset initial-fit flag when graph or layout changes so we fit again
  const graphKey = graph ? `${graph.nodes.length}-${graph.edges.length}-${layout}` : "";
  useEffect(() => {
    initialFitDoneRef.current = false;
  }, [graphKey]);

  // Merge local positions with initial positions (local takes precedence)
  const positions = useMemo(() => {
    const merged = new Map(initialPositions);
    localPositions.forEach((pos, id) => {
      merged.set(id, pos);
    });
    return merged;
  }, [initialPositions, localPositions]);

  // Filter nodes based on nodeFilters
  const filteredNodes = useMemo((): CanonicalNode[] => {
    if (!graph) return [];
    return graph.nodes.filter((node: CanonicalNode) => {
      if (node.type === "AGENT") return nodeFilters.showAgents;
      if (node.type === "MCP") return nodeFilters.showMCPServers;
      if (node.type === "LLM") return nodeFilters.showLLM;
      return true;
    });
  }, [graph, nodeFilters]);

  // Fit the viewBox so the graph fills the available container space.
  // Uses the container's pixel dimensions to pick the right zoom level
  // rather than a fixed percentage padding that leaves small graphs tiny.
  const fitToView = useCallback(() => {
    if (!graph || filteredNodes.length === 0 || positions.size === 0) {
      return;
    }

    const visiblePositions = filteredNodes
      .map((node: CanonicalNode) => positions.get(node.id))
      .filter((pos): pos is { x: number; y: number } => pos !== undefined);

    if (visiblePositions.length === 0) return;

    const minX = Math.min(...visiblePositions.map((p) => p.x));
    const minY = Math.min(...visiblePositions.map((p) => p.y));
    const maxX = Math.max(...visiblePositions.map((p) => p.x)) + NODE_WIDTH;
    const maxY = Math.max(...visiblePositions.map((p) => p.y)) + NODE_HEIGHT;

    const contentW = maxX - minX;
    const contentH = maxY - minY;

    // Get the actual pixel size of the container
    const el = containerRef.current;
    const containerW = el ? el.clientWidth : 800;
    const containerH = el ? el.clientHeight : 600;

    // We want the graph to fill ~80% of the container (10% margin each side).
    // Calculate the SVG-unit viewBox that achieves this.
    const containerAspect = containerW / containerH;
    const contentAspect = contentW / contentH;

    let vbW: number;
    let vbH: number;

    if (contentAspect > containerAspect) {
      // Graph is wider than container — fit to width
      vbW = contentW;
      vbH = vbW / containerAspect;
    } else {
      // Graph is taller than container — fit to height
      vbH = contentH;
      vbW = vbH * containerAspect;
    }

    // Add a small margin (10% of the fitted dimension on each side)
    const margin = 0.1;
    const marginW = vbW * margin;
    const marginH = vbH * margin;
    vbW += marginW * 2;
    vbH += marginH * 2;

    // Center the content within the viewBox
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    setViewBox({
      x: cx - vbW / 2,
      y: cy - vbH / 2,
      width: vbW,
      height: vbH,
    });
  }, [graph, filteredNodes, positions]);

  // Keep the old name so keyboard shortcut / button refs still work
  const handleCenter = fitToView;

  // Double-click on canvas background to fit view to nodes
  const handleCanvasDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.target === svgRef.current) {
        handleCenter();
      }
    },
    [handleCenter]
  );

  // Keyboard shortcuts: F = fit, +/= = zoom in, - = zoom out
  useEffect(() => {
    if (!graph) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.closest("input, textarea, [contenteditable=\"true\"]")) return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        handleCenter();
      }
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        handleZoomIn();
      }
      if (e.key === "-") {
        e.preventDefault();
        handleZoomOut();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [graph, handleCenter, handleZoomIn, handleZoomOut]);

  // On canvas resize: keep the network at the same on-screen size (same zoom level).
  // Shrinking the canvas shows a cropped view; growing it shows more. No re-fit.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const newW = entry.contentRect.width;
      const newH = entry.contentRect.height;
      const last = lastContainerSizeRef.current;
      lastContainerSizeRef.current = { w: newW, h: newH };
      if (last && last.w > 0 && last.h > 0 && (newW !== last.w || newH !== last.h)) {
        setViewBox((vb) => {
          const centerX = vb.x + vb.width / 2;
          const centerY = vb.y + vb.height / 2;
          const scaleX = newW / last.w;
          const scaleY = newH / last.h;
          const newWidth = vb.width * scaleX;
          const newHeight = vb.height * scaleY;
          return {
            x: centerX - newWidth / 2,
            y: centerY - newHeight / 2,
            width: newWidth,
            height: newHeight,
          };
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit view when graph first loads (once per graph change)
  useEffect(() => {
    if (!graph || filteredNodes.length === 0 || positions.size === 0 || initialFitDoneRef.current) {
      return;
    }
    // Small delay to ensure the container has its final size after layout
    const raf = requestAnimationFrame(() => {
      fitToView();
      initialFitDoneRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [graph, filteredNodes.length, positions.size, fitToView]);

  // Clear selection when the selected node is filtered out
  useEffect(() => {
    if (selectedNodeId && filteredNodes.length > 0 && !filteredNodes.some((n: CanonicalNode) => n.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [selectedNodeId, filteredNodes]);

  // Early return after all hooks
  if (!graph || graph.nodes.length === 0) {
    return (
      <div className={`flex h-full items-center justify-center text-gray-400 ${className}`}>
        <span className="text-sm">
          {graph?.mode === "design"
            ? "Exchange Versions: select an org and switch to Exchange Versions to load assets."
            : "Activity: select a Business Group and broker to load the network."}
        </span>
      </div>
    );
  }

  const typeColor = (type: string) => NODE_TYPE_COLORS[type]?.stroke ?? NODE_TYPE_COLORS.AGENT.stroke;

  const selectedNode = selectedNodeId && graph
    ? graph.nodes.find((n: CanonicalNode) => n.id === selectedNodeId) ?? null
    : null;

  // Filter edges - only show edges where both source and target nodes are visible
  const filteredEdges = useMemo((): CanonicalEdge[] => {
    if (!graph) return [];
    const visibleNodeIds = new Set(filteredNodes.map((n: CanonicalNode) => n.id));
    return graph.edges.filter(
      (edge: CanonicalEdge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    );
  }, [graph, filteredNodes]);

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full bg-gray-50 overflow-hidden ${className}`}
    >
      {/* Bottom-left: node details panel (when selected) + legend */}
      <div className="absolute bottom-4 left-4 flex flex-col-reverse gap-2 max-w-[calc(100%-8rem)]">
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm w-fit"
          aria-label="Node type legend"
        >
          {Object.entries(NODE_TYPE_COLORS).map(([type, { stroke, label }]: [string, { stroke: string; label: string }]) => (
            <div key={type} className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 rounded-sm border-2 border-gray-800"
                style={{ borderColor: stroke, backgroundColor: "white" }}
                aria-hidden
              />
              <span className="text-xs text-gray-700">{label}</span>
            </div>
          ))}
        </div>
        {selectedNode && (
          <div className="rounded-lg border border-gray-200 bg-white shadow-lg z-10 w-fit max-w-sm">
            <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
              <span className="text-xs font-semibold text-gray-700">Node details</span>
              <button
                type="button"
                onClick={() => setSelectedNodeId(null)}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label="Close"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-3 py-2 space-y-1.5 text-sm">
              <p className="font-medium text-gray-900">{selectedNode.label}</p>
              <p className="text-gray-600">
                <span className="font-medium">{selectedNode.type}</span>
                {selectedNode.version && ` · ${selectedNode.version}`}
              </p>
              {selectedNode.frameworkType && (
                <p className="text-gray-500">{selectedNode.frameworkType}</p>
              )}
              {(selectedNode.exchangeAssetId ?? selectedNode.id) && (
                <p className="text-[10px] text-gray-400 truncate" title={selectedNode.exchangeAssetId ?? selectedNode.id}>
                  {selectedNode.exchangeAssetId ?? selectedNode.id}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        className={draggedNodeId ? "cursor-grabbing" : isDragging ? "cursor-grabbing" : "cursor-grab"}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onDoubleClick={handleCanvasDoubleClick}
        aria-label="Agent network graph"
      >
        <defs>
          <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.12" />
          </filter>
          <marker
            id="arrow"
            markerWidth={8}
            markerHeight={8}
            refX={6}
            refY={4}
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill="#94a3b8" />
          </marker>
        </defs>
        {filteredEdges.map((e: CanonicalEdge) => {
          const src = positions.get(e.source);
          const tgt = positions.get(e.target);
          if (!src || !tgt) return null;

          const sourceNode = filteredNodes.find((n: CanonicalNode) => n.id === e.source);
          const targetNode = filteredNodes.find((n: CanonicalNode) => n.id === e.target);
          
          const isBrokerToLLM = sourceNode?.type === "BROKER" && targetNode?.type === "LLM";
          
          let x1: number, y1: number, x2: number, y2: number;
          
          if (isBrokerToLLM) {
            x1 = src.x + NODE_WIDTH;
            y1 = src.y + NODE_HEIGHT / 2;
            x2 = tgt.x;
            y2 = tgt.y + NODE_HEIGHT / 2;
          } else {
            x1 = src.x + NODE_WIDTH / 2;
            y1 = src.y + NODE_HEIGHT;
            x2 = tgt.x + NODE_WIDTH / 2;
            y2 = tgt.y;
          }

          const isHovered = hoveredEdgeId === e.id;
          const dimmed = hoveredEdgeId !== null && !isHovered;
          const edgeOpacity = dimmed ? 0.25 : 1;
          const strokeW = isHovered ? 2.2 : 1.5;
          
          if (edgeStyle === "bent") {
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const cpx = (x1 + x2) / 2 - (dy / len) * BEND_OFFSET;
            const cpy = (y1 + y2) / 2 + (dx / len) * BEND_OFFSET;
            const d = `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`;
            return (
              <g
                key={e.id}
                onMouseEnter={() => setHoveredEdgeId(e.id)}
                onMouseLeave={() => setHoveredEdgeId(null)}
                className="cursor-pointer"
              >
                {/* Invisible wide stroke for easier hover */}
                <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                <path
                  d={d}
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth={strokeW}
                  markerEnd="url(#arrow)"
                  style={{ opacity: edgeOpacity }}
                />
              </g>
            );
          }
          return (
            <g
              key={e.id}
              onMouseEnter={() => setHoveredEdgeId(e.id)}
              onMouseLeave={() => setHoveredEdgeId(null)}
              className="cursor-pointer"
            >
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} />
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#94a3b8"
                strokeWidth={strokeW}
                markerEnd="url(#arrow)"
                style={{ opacity: edgeOpacity }}
              />
            </g>
          );
        })}
        {filteredNodes.map((n: CanonicalNode) => {
          const pos = positions.get(n.id);
          if (!pos) return null;
          const isDragging = draggedNodeId === n.id;
          const hasIcon = !!n.icon;
          const defaultIconByType: Record<string, string> = {
            MCP: "/mcp-icon-default.png",
            AGENT: "/agent-icon-default.png",
            BROKER: "/broker-icon-default.png",
            LLM: "/llm-icon-default.png",
          };
          const iconUrl = hasIcon
            ? `/api/exchange/icon?path=${encodeURIComponent(n.icon!)}`
            : defaultIconByType[n.type] ?? null;
          const showIcon = !!iconUrl;
          const textStartX = showIcon
            ? pos.x + NODE_PAD + NODE_ICON_SIZE + 6
            : pos.x + NODE_WIDTH / 2;
          const textAnchor = showIcon ? "start" : "middle";
          const labelMaxLen = showIcon ? 22 : 28;
          const assetName = n.exchangeAssetId ?? (n.id.includes(":") ? n.id.split(":").pop() ?? n.id : n.id);
          return (
            <g
              key={n.id}
              onMouseDown={(e) => handleNodeMouseDown(e, n.id)}
              onClick={(e) => {
                e.stopPropagation();
                if (!justDraggedRef.current) {
                  setSelectedNodeId(n.id);
                }
              }}
              onMouseEnter={() => setHoveredNodeId(n.id)}
              onMouseLeave={() => setHoveredNodeId(null)}
              className="cursor-move"
            >
              <title>
                {n.label}
                {"\n"}
                {assetName}
              </title>
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
                fill="white"
                stroke={typeColor(n.type)}
                strokeWidth={isDragging ? 3 : hoveredNodeId === n.id ? 2.5 : 2}
                filter={hoveredNodeId === n.id || isDragging ? "url(#node-shadow)" : undefined}
                className={isDragging ? "cursor-grabbing" : "cursor-move"}
                style={{ opacity: isDragging ? 0.8 : 1 }}
              />
              {/* Selection ring */}
              {selectedNodeId === n.id && (
                <rect
                  x={pos.x - 2}
                  y={pos.y - 2}
                  width={NODE_WIDTH + 4}
                  height={NODE_HEIGHT + 4}
                  rx={10}
                  fill="none"
                  stroke="#5e66f9"
                  strokeWidth={2.5}
                  className="pointer-events-none"
                />
              )}
              {iconUrl && (
                <image
                  href={iconUrl}
                  x={pos.x + NODE_PAD}
                  y={pos.y + (NODE_HEIGHT - NODE_ICON_SIZE) / 2}
                  width={NODE_ICON_SIZE}
                  height={NODE_ICON_SIZE}
                  preserveAspectRatio="xMidYMid meet"
                  className="pointer-events-none"
                />
              )}
              <text
                x={textStartX}
                y={pos.y + 20}
                textAnchor={textAnchor}
                className="text-xs font-medium fill-gray-900 pointer-events-none"
              >
                {n.label.length > labelMaxLen ? `${n.label.slice(0, labelMaxLen)}…` : n.label}
              </text>
              <text
                x={textStartX}
                y={pos.y + 36}
                textAnchor={textAnchor}
                className="text-[10px] fill-gray-500 pointer-events-none"
              >
                {n.type} · {n.version}
              </text>
              {n.frameworkType && (
                <text
                  x={textStartX}
                  y={pos.y + 50}
                  textAnchor={textAnchor}
                  className="text-[10px] fill-gray-500 pointer-events-none"
                >
                  {n.frameworkType}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {/* Canvas controls */}
      <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2">
        <div className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 shadow-sm text-[10px] text-gray-500 tabular-nums" aria-live="polite">
          {Math.round((CANVAS_SIZE / viewBox.width) * 100)}%
        </div>
        {(onEdgeStyleChange || onNodeFiltersChange || onLayoutChange) && (
          <div className="rounded-lg border border-gray-300 bg-white shadow-md p-1">
            <CanvasOptionsMenu
              edgeStyle={edgeStyle}
              onEdgeStyleChange={onEdgeStyleChange ?? (() => {})}
              layout={layout}
              onLayoutChange={onLayoutChange ?? (() => {})}
              nodeFilters={nodeFilters}
              onNodeFiltersChange={onNodeFiltersChange ?? (() => {})}
            />
          </div>
        )}
        <div className="flex items-center rounded-lg border border-gray-300 bg-white shadow-sm">
          <button
            type="button"
            onClick={handleZoomOut}
            title="Zoom out (−)"
            className="flex h-8 w-8 items-center justify-center border-r border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-1 focus:ring-primary rounded-l-lg"
            aria-label="Zoom out"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 12H4"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleCenter}
            title="Fit view (F)"
            className="flex h-8 w-8 items-center justify-center border-r border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-1 focus:ring-primary"
            aria-label="Center view"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            title="Zoom in (+)"
            className="flex h-8 w-8 items-center justify-center text-gray-600 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-1 focus:ring-primary rounded-r-lg"
            aria-label="Zoom in"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
