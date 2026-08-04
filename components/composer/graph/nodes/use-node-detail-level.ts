"use client";

import { useStore } from "@xyflow/react";

export type NodeDetailLevel = "compact" | "full";

/** Below this zoom the summary chips are unreadable, so cards collapse to a title row. */
const FULL_DETAIL_ZOOM = 0.55;

/**
 * Zoom-derived level of detail. The selector returns a coarse enum so cards
 * re-render when the level flips rather than on every wheel tick.
 */
export function useNodeDetailLevel(): NodeDetailLevel {
  return useStore((s) => (s.transform[2] < FULL_DETAIL_ZOOM ? "compact" : "full"));
}
