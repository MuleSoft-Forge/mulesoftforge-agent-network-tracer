"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  diagramNodeWidth,
  layoutLlmProxyDiagram,
  LLM_PROXY_DIAGRAM_LEGEND,
  LLM_PROXY_DIAGRAM_NODE_HEIGHT,
  LLM_PROXY_DIAGRAM_NODE_WIDTH,
  LLM_PROXY_SEMANTIC_EMBEDDING_EDGE_ID,
  strokeForDiagramKind,
  type LlmProxyDiagramGraph,
  type LlmProxyDiagramNode,
} from "@/lib/llmProxy/proxy-diagram";

const NODE_H = LLM_PROXY_DIAGRAM_NODE_HEIGHT;
const PAD = 8;
/** Same asset as the landing page / header (`app/page.tsx`, `Header.tsx`). */
const CLIENT_LOGO_HREF = "/ant-logo-landing.png";
/** Shield + check — Flex Gateway ingress (user-provided asset in `public/`). */
const GATEWAY_LOGO_HREF = "/llm-proxy-flex-gateway-icon.png";
/** Hub / proxy instance (pink ring + network) — this LLM Proxy node. */
const PROXY_ICON_HREF = "/llm-proxy-instance-icon.png";
/** MuleSoft-style policies (document + shield) — routes, fallback, deny. */
const ROUTE_POLICY_ICON_HREF = "/llm-proxy-route-policy-icon.png";
const NODE_ICON_SIZE = 36;

/** Active request path (non–deny “happy” trace). */
const EDGE_ACTIVE_TRACE = "#22c55e";
/** Active edge to Deny list only — stays red. */
const EDGE_ACTIVE_DENY = "#dc2626";
const DENY_EDGE_ID = "llmpx-e-proxy-deny";

function diagramNodeIconHref(kind: LlmProxyDiagramNode["kind"]): string | null {
  switch (kind) {
    case "client":
      return CLIENT_LOGO_HREF;
    case "gateway":
      return GATEWAY_LOGO_HREF;
    case "proxy":
      return PROXY_ICON_HREF;
    case "semanticEmbedding":
    case "route":
    case "fallback":
    case "deny":
      return ROUTE_POLICY_ICON_HREF;
    default:
      return null;
  }
}
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 3.5;
const ZOOM_SENSITIVITY = 0.001;
const CANVAS_SIZE = 2400;

interface LlmProxyNodeCanvasProps {
  graph: LlmProxyDiagramGraph;
  className?: string;
}

export default function LlmProxyNodeCanvas({ graph, className = "" }: LlmProxyNodeCanvasProps) {
  const [viewBox, setViewBox] = useState({
    x: 0,
    y: 0,
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [nodeDragStart, setNodeDragStart] = useState({ x: 0, y: 0 });
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastContainerSizeRef = useRef<{ w: number; h: number } | null>(null);
  const initialFitDoneRef = useRef(false);
  const justDraggedRef = useRef(false);

  const [localPositions, setLocalPositions] = useState<Map<string, { x: number; y: number }>>(
    () => new Map()
  );

  const baseLayout = useMemo(() => layoutLlmProxyDiagram(graph), [graph]);
  const graphKey = useMemo(
    () => `${graph.nodes.map((n) => n.id).join(",")}|${graph.edges.length}`,
    [graph]
  );

  useEffect(() => {
    setLocalPositions(new Map(baseLayout));
  }, [graphKey, baseLayout]);

  const positions = useMemo(() => {
    const m = new Map(baseLayout);
    localPositions.forEach((p, id) => m.set(id, p));
    return m;
  }, [baseLayout, localPositions]);

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.target === svgRef.current) setSelectedNodeId(null);
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
        const rect = svgRef.current.getBoundingClientRect();
        const dx = (e.clientX - nodeDragStart.x) * (viewBox.width / rect.width);
        const dy = (e.clientY - nodeDragStart.y) * (viewBox.height / rect.height);
        setLocalPositions((prev) => {
          const next = new Map(prev);
          const cur = next.get(draggedNodeId) ?? baseLayout.get(draggedNodeId);
          if (cur) next.set(draggedNodeId, { x: cur.x + dx, y: cur.y + dy });
          return next;
        });
        setNodeDragStart({ x: e.clientX, y: e.clientY });
      } else if (isDragging && draggedNodeId === null && svgRef.current) {
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
    [isDragging, dragStart, viewBox, draggedNodeId, nodeDragStart, baseLayout]
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

  const handleNodeMouseDown = useCallback((e: React.MouseEvent<SVGGElement>, nodeId: string) => {
    e.stopPropagation();
    if (e.button === 0) {
      setDraggedNodeId(nodeId);
      setNodeDragStart({ x: e.clientX, y: e.clientY });
      setIsDragging(false);
    }
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
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
      setViewBox({
        x: svgX - (mouseX / rect.width) * newWidth,
        y: svgY - (mouseY / rect.height) * newHeight,
        width: newWidth,
        height: newHeight,
      });
    },
    [viewBox]
  );

  const fitToView = useCallback(() => {
    if (graph.nodes.length === 0 || positions.size === 0) return;
    const coords = graph.nodes
      .map((n) => positions.get(n.id))
      .filter((p): p is { x: number; y: number } => p != null);
    if (coords.length === 0) return;
    const minX = Math.min(...coords.map((p) => p.x));
    const minY = Math.min(...coords.map((p) => p.y));
    const maxX = Math.max(
      0,
      ...graph.nodes.map((n) => {
        const p = positions.get(n.id);
        if (!p) return 0;
        return p.x + diagramNodeWidth(n.kind);
      })
    );
    const maxY = Math.max(...coords.map((p) => p.y)) + NODE_H;
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const el = containerRef.current;
    const containerW = el ? el.clientWidth : 800;
    const containerH = el ? el.clientHeight : 600;
    const containerAspect = containerW / containerH;
    const contentAspect = contentW / contentH;
    let vbW: number;
    let vbH: number;
    if (contentAspect > containerAspect) {
      vbW = contentW;
      vbH = vbW / containerAspect;
    } else {
      vbH = contentH;
      vbW = vbH * containerAspect;
    }
    const margin = 0.12;
    vbW *= 1 + margin * 2;
    vbH *= 1 + margin * 2;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setViewBox({ x: cx - vbW / 2, y: cy - vbH / 2, width: vbW, height: vbH });
  }, [graph.nodes, positions]);

  const handleZoomIn = useCallback(() => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const svgX = viewBox.x + (centerX / rect.width) * viewBox.width;
    const svgY = viewBox.y + (centerY / rect.height) * viewBox.height;
    const zoomFactor = 0.82;
    const newWidth = Math.max(CANVAS_SIZE / MAX_ZOOM, viewBox.width * zoomFactor);
    const newHeight = Math.max(CANVAS_SIZE / MAX_ZOOM, viewBox.height * zoomFactor);
    setViewBox({
      x: svgX - (centerX / rect.width) * newWidth,
      y: svgY - (centerY / rect.height) * newHeight,
      width: newWidth,
      height: newHeight,
    });
  }, [viewBox]);

  const handleZoomOut = useCallback(() => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const svgX = viewBox.x + (centerX / rect.width) * viewBox.width;
    const svgY = viewBox.y + (centerY / rect.height) * viewBox.height;
    const zoomFactor = 1.22;
    const newWidth = Math.min(CANVAS_SIZE / MIN_ZOOM, viewBox.width * zoomFactor);
    const newHeight = Math.min(CANVAS_SIZE / MIN_ZOOM, viewBox.height * zoomFactor);
    setViewBox({
      x: svgX - (centerX / rect.width) * newWidth,
      y: svgY - (centerY / rect.height) * newHeight,
      width: newWidth,
      height: newHeight,
    });
  }, [viewBox]);

  useEffect(() => {
    initialFitDoneRef.current = false;
  }, [graphKey]);

  useEffect(() => {
    if (graph.nodes.length === 0 || positions.size === 0 || initialFitDoneRef.current) return;
    const raf = requestAnimationFrame(() => {
      fitToView();
      initialFitDoneRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [graphKey, graph.nodes.length, positions.size, fitToView]);

  useEffect(() => {
    if (!graph.nodes.length) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.closest('input, textarea, [contenteditable="true"]')) return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        fitToView();
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [graph.nodes.length, fitToView, handleZoomIn, handleZoomOut]);

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
      if (last && last.w > 0 && last.h > 0 && (newW !== last.w || newH !== newH)) {
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

  const handleCanvasDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.target === svgRef.current) fitToView();
    },
    [fitToView]
  );

  const selectedNode =
    selectedNodeId != null ? nodeById.get(selectedNodeId) ?? null : null;

  if (graph.nodes.length === 0) {
    return (
      <div className={`flex h-full items-center justify-center text-sm text-gray-400 ${className}`}>
        Nothing to draw for this proxy.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden bg-gray-50 ${className}`}
    >
      <div className="absolute bottom-4 left-4 z-10 flex max-w-[calc(100%-6rem)] flex-col-reverse gap-2">
        <div
          className="w-fit rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm"
          aria-label="LLM Proxy diagram legend"
        >
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Node types
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {LLM_PROXY_DIAGRAM_LEGEND.map(({ kind, label }) => (
              <div key={kind} className="flex items-center gap-1.5">
                {kind === "client" ? (
                  <Image
                    src={CLIENT_LOGO_HREF}
                    alt=""
                    width={14}
                    height={14}
                    className="h-3.5 w-3.5 shrink-0 rounded object-contain"
                  />
                ) : kind === "gateway" ? (
                  <Image
                    src={GATEWAY_LOGO_HREF}
                    alt=""
                    width={14}
                    height={14}
                    className="h-3.5 w-3.5 shrink-0 rounded object-contain"
                  />
                ) : kind === "proxy" ? (
                  <Image
                    src={PROXY_ICON_HREF}
                    alt=""
                    width={14}
                    height={14}
                    className="h-3.5 w-3.5 shrink-0 rounded object-contain"
                  />
                ) : kind === "route" ||
                  kind === "fallback" ||
                  kind === "deny" ||
                  kind === "semanticEmbedding" ? (
                  <Image
                    src={ROUTE_POLICY_ICON_HREF}
                    alt=""
                    width={14}
                    height={14}
                    className="h-3.5 w-3.5 shrink-0 rounded object-contain"
                  />
                ) : (
                  <span
                    className="inline-block h-3 w-3 rounded-sm border-2 border-gray-800 bg-white"
                    style={{ borderColor: strokeForDiagramKind(kind) }}
                    aria-hidden
                  />
                )}
                <span className="text-xs text-gray-700">{label}</span>
              </div>
            ))}
          </div>
        </div>
        {selectedNode && (
          <div className="w-fit max-w-sm rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5">
              <span className="text-xs font-semibold text-gray-700">Node</span>
              <button
                type="button"
                onClick={() => setSelectedNodeId(null)}
                className="rounded p-1 text-gray-500 hover:bg-gray-100"
                aria-label="Close"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-1 px-3 py-2 text-sm">
              <p className="font-medium text-gray-900">{selectedNode.title}</p>
              <p className="text-xs text-gray-500">{selectedNode.subtitle}</p>
              <p className="text-[10px] capitalize text-gray-400">{selectedNode.kind}</p>
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
        aria-label="LLM Proxy request path diagram"
      >
        <defs>
          <filter id="llmpx-node-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.1" />
          </filter>
          <marker id="llmpx-arrow" markerWidth={10} markerHeight={10} refX={8} refY={5} orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill="#94a3b8" />
          </marker>
          <marker id="llmpx-arrow-active" markerWidth={10} markerHeight={10} refX={8} refY={5} orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill={EDGE_ACTIVE_TRACE} />
          </marker>
          <marker id="llmpx-arrow-active-deny" markerWidth={10} markerHeight={10} refX={8} refY={5} orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill={EDGE_ACTIVE_DENY} />
          </marker>
        </defs>

        {graph.edges.map((e) => {
          const src = positions.get(e.source);
          const tgt = positions.get(e.target);
          if (!src || !tgt) return null;
          const srcNode = nodeById.get(e.source);
          const tgtNode = nodeById.get(e.target);
          const wSrc = srcNode
            ? diagramNodeWidth(srcNode.kind)
            : LLM_PROXY_DIAGRAM_NODE_WIDTH;
          const wTgt = tgtNode
            ? diagramNodeWidth(tgtNode.kind)
            : LLM_PROXY_DIAGRAM_NODE_WIDTH;
          const isHorizontalProxyEmbedding =
            e.id === LLM_PROXY_SEMANTIC_EMBEDDING_EDGE_ID;
          let x1: number;
          let y1: number;
          let x2: number;
          let y2: number;
          if (isHorizontalProxyEmbedding) {
            x1 = src.x + wSrc;
            y1 = src.y + NODE_H / 2;
            x2 = tgt.x;
            y2 = tgt.y + NODE_H / 2;
          } else {
            x1 = src.x + wSrc / 2;
            y1 = src.y + NODE_H;
            x2 = tgt.x + wTgt / 2;
            y2 = tgt.y;
          }
          const isHovered = hoveredEdgeId === e.id;
          const dimmed = hoveredEdgeId !== null && !isHovered;
          const isDenyTrace = e.active && e.id === DENY_EDGE_ID;
          const edgeStroke = e.active
            ? isDenyTrace
              ? EDGE_ACTIVE_DENY
              : EDGE_ACTIVE_TRACE
            : "#94a3b8";
          const markerEnd = e.active
            ? isDenyTrace
              ? "url(#llmpx-arrow-active-deny)"
              : "url(#llmpx-arrow-active)"
            : "url(#llmpx-arrow)";
          const strokeW = (isHovered ? 3.2 : 2.4) + (e.active ? 1 : 0);
          return (
            <g
              key={e.id}
              onMouseEnter={() => setHoveredEdgeId(e.id)}
              onMouseLeave={() => setHoveredEdgeId(null)}
              className="cursor-pointer"
            >
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={18} />
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={edgeStroke}
                strokeWidth={strokeW}
                markerEnd={markerEnd}
                style={{ opacity: dimmed ? 0.25 : 1 }}
              />
            </g>
          );
        })}

        {graph.nodes.map((n: LlmProxyDiagramNode) => {
          const pos = positions.get(n.id);
          if (!pos) return null;
          const nw = diagramNodeWidth(n.kind);
          const isCore =
            n.kind === "client" || n.kind === "gateway" || n.kind === "proxy";
          const stroke = strokeForDiagramKind(n.kind);
          const isDrag = draggedNodeId === n.id;
          const iconHref = diagramNodeIconHref(n.kind);
          const hasLeadingIcon = iconHref != null;
          const textStartX = hasLeadingIcon
            ? pos.x + PAD + NODE_ICON_SIZE + 6
            : pos.x + PAD;
          const titleMax = hasLeadingIcon
            ? isCore
              ? 30
              : 22
            : isCore
              ? 34
              : 28;
          const subMax = hasLeadingIcon
            ? isCore
              ? 36
              : 28
            : isCore
              ? 40
              : 34;
          return (
            <g
              key={n.id}
              onMouseDown={(e) => handleNodeMouseDown(e, n.id)}
              onClick={(e) => {
                e.stopPropagation();
                if (!justDraggedRef.current) setSelectedNodeId(n.id);
              }}
              className="cursor-move"
            >
              <rect
                x={pos.x}
                y={pos.y}
                width={nw}
                height={NODE_H}
                rx={8}
                fill="white"
                stroke={stroke}
                strokeWidth={selectedNodeId === n.id ? 2.8 : 2}
                filter={selectedNodeId === n.id || isDrag ? "url(#llmpx-node-shadow)" : undefined}
                style={{ opacity: isDrag ? 0.88 : 1 }}
              />
              {iconHref ? (
                <image
                  href={iconHref}
                  x={pos.x + PAD}
                  y={pos.y + (NODE_H - NODE_ICON_SIZE) / 2}
                  width={NODE_ICON_SIZE}
                  height={NODE_ICON_SIZE}
                  preserveAspectRatio="xMidYMid meet"
                  className="pointer-events-none"
                />
              ) : null}
              <text
                x={textStartX}
                y={pos.y + 22}
                className="pointer-events-none fill-gray-900 text-xs font-medium"
              >
                {n.title.length > titleMax ? `${n.title.slice(0, titleMax - 1)}…` : n.title}
              </text>
              <text
                x={textStartX}
                y={pos.y + 40}
                className="pointer-events-none fill-gray-500 text-[10px]"
              >
                {n.subtitle.length > subMax ? `${n.subtitle.slice(0, subMax - 1)}…` : n.subtitle}
              </text>
              <title>
                {n.title}
                {"\n"}
                {n.subtitle}
              </title>
            </g>
          );
        })}
      </svg>

      <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2">
        <div
          className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-[10px] tabular-nums text-gray-500 shadow-sm"
          aria-live="polite"
        >
          {Math.round((CANVAS_SIZE / viewBox.width) * 100)}%
        </div>
        <div className="flex items-center rounded-lg border border-gray-300 bg-white shadow-sm">
          <button
            type="button"
            onClick={handleZoomOut}
            className="flex h-8 w-8 items-center justify-center rounded-l-lg border-r border-gray-300 text-gray-600 hover:bg-gray-50"
            aria-label="Zoom out"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={fitToView}
            className="flex h-8 w-8 items-center justify-center border-r border-gray-300 text-gray-600 hover:bg-gray-50"
            aria-label="Fit view"
            title="Fit (F)"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" strokeWidth={2} />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            className="flex h-8 w-8 items-center justify-center rounded-r-lg text-gray-600 hover:bg-gray-50"
            aria-label="Zoom in"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
