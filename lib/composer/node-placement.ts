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

type PlacementDirection = "vertical" | "horizontal";

interface Point {
  x: number;
  y: number;
}

function overlaps(a: Point, b: Point): boolean {
  return (
    Math.abs(a.x - b.x) < NODE_WIDTH + MIN_GAP && Math.abs(a.y - b.y) < NODE_HEIGHT + MIN_GAP
  );
}

/** Slide across the flow axis until the slot is clear so new nodes never stack. */
function firstFreeSlot(taken: Point[], start: Point, direction: PlacementDirection): Point {
  const candidate = { ...start };
  let guard = 0;
  while (taken.some((p) => overlaps(p, candidate)) && guard < 50) {
    if (direction === "horizontal") candidate.y += NODE_HEIGHT + MIN_GAP;
    else candidate.x += NODE_WIDTH + H_GAP;
    guard += 1;
  }
  return candidate;
}

/**
 * Place a new node after its anchor (the selected node, else the last node
 * along the flow), falling back to the viewport centre when the graph is empty.
 */
export function placeNewNode(
  broker: Broker,
  kind: GraphNodeKind,
  options: {
    anchorNodeId?: string | null;
    viewportCenter?: Point;
    direction?: PlacementDirection;
  } = {}
): Point {
  const nodes = broker.nodes;
  const direction = options.direction ?? "vertical";
  const taken = nodes.map((n) => n.position);

  if (kind === "trigger") {
    // The entry point goes before everything else along the flow axis.
    const first = nodes.reduce<Point | null>((best, n) => {
      if (best === null) return n.position;
      if (direction === "horizontal") return n.position.x < best.x ? n.position : best;
      return n.position.y < best.y ? n.position : best;
    }, null);
    if (!first) return options.viewportCenter ?? ORIGIN;
    const start =
      direction === "horizontal"
        ? { x: first.x - (NODE_WIDTH + H_GAP), y: first.y }
        : { x: first.x, y: first.y - V_GAP };
    return firstFreeSlot(taken, start, direction);
  }

  if (nodes.length === 0) return options.viewportCenter ?? ORIGIN;

  const lastAlongFlow = nodes.reduce((furthest, n) =>
    direction === "horizontal"
      ? n.position.x > furthest.position.x
        ? n
        : furthest
      : n.position.y > furthest.position.y
        ? n
        : furthest
  , nodes[0]);
  const anchor =
    (options.anchorNodeId ? nodes.find((n) => n.id === options.anchorNodeId) : undefined) ??
    lastAlongFlow;

  const start =
    direction === "horizontal"
      ? { x: anchor.position.x + NODE_WIDTH + H_GAP, y: anchor.position.y }
      : { x: anchor.position.x, y: anchor.position.y + V_GAP };
  return firstFreeSlot(taken, start, direction);
}
