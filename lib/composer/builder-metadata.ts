import type { Broker, ComposerProject } from "@/lib/composer/model";

/** exchange.json metadata key for Agent Network Builder UI state. */
export const BUILDER_METADATA_KEY = "agentNetworkBuilder";

export type GraphNodePosition = { x: number; y: number };

/** Canvas positions keyed by graph node name (stable across import). */
export type BrokerGraphLayout = Record<string, GraphNodePosition>;

export interface AgentNetworkBuilderMetadata {
  graphLayouts?: Record<string, BrokerGraphLayout>;
  /** When false, export omits saved canvas positions (hierarchical layout is derived on import). */
  graphLayoutPinned?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parsePosition(value: unknown): GraphNodePosition | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const x = asNumber(rec.x);
  const y = asNumber(rec.y);
  if (x === undefined || y === undefined) return undefined;
  return { x, y };
}

/** Read Builder metadata from exchange.json metadata object. */
export function parseBuilderMetadata(
  metadata: Record<string, unknown> | undefined
): AgentNetworkBuilderMetadata | undefined {
  const root = asRecord(metadata?.[BUILDER_METADATA_KEY]);
  if (!root) return undefined;

  const layoutsRaw = asRecord(root.graphLayouts);
  const graphLayouts: Record<string, BrokerGraphLayout> = {};
  if (layoutsRaw) {
    for (const [brokerKey, layoutRaw] of Object.entries(layoutsRaw)) {
      const layoutObj = asRecord(layoutRaw);
      if (!layoutObj) continue;
      const nodes: BrokerGraphLayout = {};
      for (const [nodeName, posRaw] of Object.entries(layoutObj)) {
        const pos = parsePosition(posRaw);
        if (pos) nodes[nodeName] = pos;
      }
      if (Object.keys(nodes).length > 0) graphLayouts[brokerKey] = nodes;
    }
  }

  const graphLayoutPinnedRaw = root.graphLayoutPinned;
  const graphLayoutPinned =
    graphLayoutPinnedRaw === false ? false : graphLayoutPinnedRaw === true ? true : undefined;

  if (Object.keys(graphLayouts).length === 0 && graphLayoutPinned === undefined) {
    return undefined;
  }

  return {
    ...(Object.keys(graphLayouts).length > 0 ? { graphLayouts } : {}),
    ...(graphLayoutPinned !== undefined ? { graphLayoutPinned } : {}),
  };
}

/** Serialize Builder metadata for exchange.json. */
export function serializeBuilderMetadata(
  metadata: AgentNetworkBuilderMetadata | undefined
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  const pinned = metadata.graphLayoutPinned;
  const layouts = metadata.graphLayouts;
  const hasLayouts = layouts && Object.keys(layouts).length > 0;

  if (pinned === false) {
    return {
      [BUILDER_METADATA_KEY]: {
        graphLayoutPinned: false,
      },
    };
  }

  if (!hasLayouts) return undefined;

  return {
    [BUILDER_METADATA_KEY]: {
      graphLayouts: layouts,
      ...(pinned === true ? { graphLayoutPinned: true } : {}),
    },
  };
}

/** Snapshot current canvas positions from the composer model. */
export function extractGraphLayouts(project: ComposerProject): AgentNetworkBuilderMetadata | undefined {
  if (project.graphLayoutPinned === false) {
    return { graphLayoutPinned: false };
  }

  const graphLayouts: Record<string, BrokerGraphLayout> = {};
  for (const broker of project.brokers) {
    if (broker.nodes.length === 0) continue;
    const nodes: BrokerGraphLayout = {};
    for (const node of broker.nodes) {
      nodes[node.name] = { x: node.position.x, y: node.position.y };
    }
    graphLayouts[broker.name] = nodes;
  }
  if (Object.keys(graphLayouts).length === 0) return undefined;
  return { graphLayouts, graphLayoutPinned: project.graphLayoutPinned ?? true };
}

/** Apply saved node-name positions onto a parsed broker graph. */
export function applyGraphLayout(broker: Broker, layout: BrokerGraphLayout | undefined): Broker {
  if (!layout) return broker;
  return {
    ...broker,
    nodes: broker.nodes.map((node) => {
      const saved = layout[node.name];
      return saved ? { ...node, position: saved } : node;
    }),
  };
}
