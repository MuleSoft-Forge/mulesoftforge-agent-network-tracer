/** Deliberate placement for newly added graph nodes (replaces random scatter). */

import type { Broker, GraphNodeKind } from "@/lib/composer/model";

/** Matches the rendered card bounds in AfNode (min-w-56 to max-w-72, chips + preview). */
export const NODE_WIDTH = 288;
export const NODE_HEIGHT = 124;
const H_GAP = 56;
const V_GAP = 176;
/** Breathing room required between two node boxes before they count as clear. */
const MIN_GAP = 24;

/** Where the trigger lands in an otherwise empty graph. */
export const ORIGIN = { x: 80, y: 80 };

interface Point {
  x: number;
  y: number;
}

function overlaps(a: Point, b: Point): boolean {
  return (
    Math.abs(a.x - b.x) < NODE_WIDTH + MIN_GAP && Math.abs(a.y - b.y) < NODE_HEIGHT + MIN_GAP
  );
}

/** Slide right until the slot is clear so new nodes never land on top of one another. */
function firstFreeSlot(taken: Point[], start: Point): Point {
  const candidate = { ...start };
  let guard = 0;
  while (taken.some((p) => overlaps(p, candidate)) && guard < 50) {
    candidate.x += NODE_WIDTH + H_GAP;
    guard += 1;
  }
  return candidate;
}

/**
 * Place a new node below its anchor (the selected node, else the bottom-most
 * node), falling back to the viewport centre when the graph is empty.
 */
export function placeNewNode(
  broker: Broker,
  kind: GraphNodeKind,
  options: { anchorNodeId?: string | null; viewportCenter?: Point } = {}
): Point {
  const nodes = broker.nodes;
  if (kind === "trigger") {
    const topMost = nodes.reduce<Point | null>(
      (best, n) => (best === null || n.position.y < best.y ? n.position : best),
      null
    );
    if (!topMost) return options.viewportCenter ?? ORIGIN;
    return firstFreeSlot(
      nodes.map((n) => n.position),
      { x: topMost.x, y: topMost.y - V_GAP }
    );
  }

  if (nodes.length === 0) return options.viewportCenter ?? ORIGIN;

  const anchor =
    (options.anchorNodeId ? nodes.find((n) => n.id === options.anchorNodeId) : undefined) ??
    nodes.reduce((lowest, n) => (n.position.y > lowest.position.y ? n : lowest), nodes[0]);

  return firstFreeSlot(
    nodes.map((n) => n.position),
    { x: anchor.position.x, y: anchor.position.y + V_GAP }
  );
}
