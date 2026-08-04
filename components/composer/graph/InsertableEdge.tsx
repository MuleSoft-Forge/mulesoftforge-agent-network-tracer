"use client";

import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { Plus } from "lucide-react";

export interface InsertableEdgeData extends Record<string, unknown> {
  /** Opens the kind picker to splice a node into this edge. */
  onInsert?: (edgeId: string, screenX: number, screenY: number) => void;
}

export type InsertableEdgeType = Edge<InsertableEdgeData>;

/**
 * Edge that reveals a `+` on hover to insert a node between its endpoints,
 * which otherwise takes a delete, an add, and two reconnects.
 */
export function InsertableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
  data,
}: EdgeProps<InsertableEdgeType>) {
  const [hovered, setHovered] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const onInsert = data?.onInsert;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {/* Invisible wide path so the hover target is not a 2px line. */}
      <path
        d={edgePath}
        fill="none"
        strokeWidth={18}
        stroke="transparent"
        className="react-flow__edge-interaction"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute flex items-center gap-1"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {label ? (
            <span className="rounded bg-composer-surface/90 px-1.5 py-0.5 text-[11px] text-composer-label-muted shadow-sm">
              {label}
            </span>
          ) : null}
          {onInsert ? (
            <button
              type="button"
              aria-label="Insert a node on this connection"
              title="Insert a node here"
              onClick={(event) => onInsert(id, event.clientX, event.clientY)}
              className={`flex h-5 w-5 items-center justify-center rounded-full border bg-composer-surface shadow-sm transition-opacity ${
                hovered
                  ? "border-primary text-primary opacity-100"
                  : "border-composer-border text-composer-label-muted opacity-0"
              }`}
            >
              <Plus className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const composerEdgeTypes = { insertable: InsertableEdge };
