import type { LlmProxyListItem, LlmProxyRouteTrace, LlmProxyRoutingRule } from "@/lib/llmProxy/types";

export type LlmProxyDiagramNodeKind =
  | "client"
  | "gateway"
  | "proxy"
  /** OpenAI embeddings API — semantic routing only (hardcoded provider for now). */
  | "semanticEmbedding"
  | "route"
  | "fallback"
  | "deny";

export interface LlmProxyDiagramNode {
  id: string;
  kind: LlmProxyDiagramNodeKind;
  title: string;
  subtitle: string;
}

export interface LlmProxyDiagramEdge {
  id: string;
  source: string;
  target: string;
  active?: boolean;
}

export interface LlmProxyDiagramGraph {
  nodes: LlmProxyDiagramNode[];
  edges: LlmProxyDiagramEdge[];
}

/** Policy nodes (route, fallback, deny) — compact width. */
export const LLM_PROXY_DIAGRAM_NODE_WIDTH = 220;
/** Client, Flex Gateway, LLM Proxy — wider cards. */
export const LLM_PROXY_DIAGRAM_NODE_WIDTH_CORE = 300;
export const LLM_PROXY_DIAGRAM_NODE_HEIGHT = 56;

/** Placed to the right of the LLM Proxy row for semantic routing (OpenAI embeddings). */
export const LLM_PROXY_SEMANTIC_EMBEDDING_NODE_ID = "llmpx-semantic-embedding";
export const LLM_PROXY_SEMANTIC_EMBEDDING_EDGE_ID = "llmpx-e-proxy-semantic-embedding";

export function diagramNodeWidth(kind: LlmProxyDiagramNodeKind): number {
  switch (kind) {
    case "client":
    case "gateway":
    case "proxy":
      return LLM_PROXY_DIAGRAM_NODE_WIDTH_CORE;
    case "semanticEmbedding":
    case "route":
    case "fallback":
    case "deny":
      return LLM_PROXY_DIAGRAM_NODE_WIDTH;
    default:
      return LLM_PROXY_DIAGRAM_NODE_WIDTH;
  }
}

const KIND_STROKE: Record<LlmProxyDiagramNodeKind, string> = {
  client: "#4f46e5",
  gateway: "#7c3aed",
  proxy: "#0891b2",
  semanticEmbedding: "#0891b2",
  route: "#2563eb",
  fallback: "#64748b",
  deny: "#be123c",
};

export function strokeForDiagramKind(kind: LlmProxyDiagramNodeKind): string {
  return KIND_STROKE[kind];
}

export const LLM_PROXY_DIAGRAM_LEGEND: { kind: LlmProxyDiagramNodeKind; label: string }[] = [
  { kind: "client", label: "Client" },
  { kind: "gateway", label: "Flex Gateway" },
  { kind: "proxy", label: "LLM Proxy" },
  { kind: "semanticEmbedding", label: "Semantic embedding" },
  { kind: "route", label: "Route" },
  { kind: "fallback", label: "Fallback" },
  { kind: "deny", label: "Deny list" },
];

function hostFromUri(uri: string | null): string {
  if (!uri?.trim()) return "—";
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

function shortUpstreamId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function pickActiveRouteIds(
  routes: LlmProxyRoutingRule[],
  trace: LlmProxyRouteTrace | null
): Set<string> {
  const out = new Set<string>();
  if (!trace?.edges[2]) return out;
  /** Deny list stops before any named upstream route. */
  if (trace.denyListMatch) return out;
  /** Primary named routes are not the winning path when Flex used fallback. */
  if (trace.routingFallback) return out;
  const m = (trace.model ?? "").toLowerCase().trim();
  const p = (trace.provider ?? "").toLowerCase().trim();
  let matched = false;
  routes.forEach((r, i) => {
    const rid = `llmpx-route-${i}`;
    const label = r.label.toLowerCase();
    const ms = (r.matchSummary ?? "").toLowerCase();
    if (m && (label.includes(m) || ms.includes(m))) {
      out.add(rid);
      matched = true;
    } else if (p && (label.includes(p) || ms.includes(p))) {
      out.add(rid);
      matched = true;
    }
  });
  if (!matched && routes.length > 0) {
    routes.forEach((_, i) => out.add(`llmpx-route-${i}`));
  }
  return out;
}

function hasFallbackPanel(proxy: LlmProxyListItem): boolean {
  const fr = proxy.fallbackRoute;
  const fm = proxy.fallbackModel;
  const ft = proxy.fallbackThreshold;
  return (
    (fr != null && fr.length > 0) ||
    (fm != null && fm.length > 0) ||
    (ft != null && Number.isFinite(ft))
  );
}

/** Graph for the LLM Proxy path diagram (not Agent Network canonical types). */
export function buildLlmProxyDiagram(
  proxy: LlmProxyListItem,
  trace: LlmProxyRouteTrace | null
): LlmProxyDiagramGraph {
  const clientId = "llmpx-client";
  const gatewayId = "llmpx-gateway";
  const proxyId = "llmpx-proxy";

  const nodes: LlmProxyDiagramNode[] = [];
  const edges: LlmProxyDiagramEdge[] = [];

  const te0 = trace?.edges[0] ?? false;
  const te1 = trace?.edges[1] ?? false;
  const te2 = trace?.edges[2] ?? false;

  nodes.push({
    id: clientId,
    kind: "client",
    title: "Client",
    subtitle: "OAuth2 · your app",
  });

  const gwHost = hostFromUri(proxy.endpointUri);
  nodes.push({
    id: gatewayId,
    kind: "gateway",
    title: "Flex Gateway",
    subtitle: truncate(gwHost, 36),
  });

  const strategyLabel =
    proxy.routingStrategy === "semantic"
      ? "Semantic routing"
      : proxy.routingStrategy === "model-based"
        ? "Model-based routing"
        : "Routing";

  nodes.push({
    id: proxyId,
    kind: "proxy",
    title: truncate(proxy.name, 30),
    subtitle: `${strategyLabel} · ${truncate(proxy.assetVersion || proxy.assetId, 24)}`,
  });

  edges.push({
    id: "llmpx-e-client-gateway",
    source: clientId,
    target: gatewayId,
    active: te0,
  });
  edges.push({
    id: "llmpx-e-gateway-proxy",
    source: gatewayId,
    target: proxyId,
    active: te1,
  });

  if (proxy.routingStrategy === "semantic") {
    nodes.push({
      id: LLM_PROXY_SEMANTIC_EMBEDDING_NODE_ID,
      kind: "semanticEmbedding",
      title: "Semantic embedding",
      subtitle: "OpenAI · hardcoded (embeddings API)",
    });
    edges.push({
      id: LLM_PROXY_SEMANTIC_EMBEDDING_EDGE_ID,
      source: proxyId,
      target: LLM_PROXY_SEMANTIC_EMBEDDING_NODE_ID,
      /** Used on every semantic request (including deny) once the request reaches the proxy. */
      active: te2,
    });
  }

  const routes = proxy.routes ?? [];
  const activeRouteIds = pickActiveRouteIds(routes, trace);

  routes.forEach((r, i) => {
    const rid = `llmpx-route-${i}`;
    const sub =
      r.matchSummary && r.matchSummary.length > 0
        ? r.matchSummary
        : r.upstreamIds.map(shortUpstreamId).join(", ") || "—";
    nodes.push({
      id: rid,
      kind: "route",
      title: r.label,
      subtitle: truncate(sub, 40),
    });
    edges.push({
      id: `llmpx-e-proxy-route-${i}`,
      source: proxyId,
      target: rid,
      active:
        te2 &&
        !trace?.denyListMatch &&
        activeRouteIds.has(rid),
    });
  });

  const traceUsedFallback =
    Boolean(trace?.routingFallback) && !trace?.denyListMatch;
  const showFallbackNode =
    hasFallbackPanel(proxy) || traceUsedFallback;

  if (showFallbackNode) {
    const fid = "llmpx-fallback";
    const configParts = [
      proxy.fallbackRoute,
      proxy.fallbackModel,
      proxy.fallbackThreshold != null && Number.isFinite(proxy.fallbackThreshold)
        ? `threshold ${proxy.fallbackThreshold}`
        : null,
    ].filter((x): x is string => typeof x === "string" && x.length > 0);
    let subtitleSource = "policy";
    if (configParts.length > 0) {
      subtitleSource = configParts.join(" · ");
    } else if (traceUsedFallback && (trace?.model || trace?.provider)) {
      const hint =
        trace?.provider && trace?.model
          ? `${trace.provider} · ${trace.model}`
          : (trace?.model ?? trace?.provider ?? "");
      subtitleSource = hint ? `Response · ${hint}` : "policy";
    }
    nodes.push({
      id: fid,
      kind: "fallback",
      title: "Fallback",
      subtitle: truncate(subtitleSource, 42),
    });
    edges.push({
      id: "llmpx-e-proxy-fallback",
      source: proxyId,
      target: fid,
      active: te2 && traceUsedFallback,
    });
  }

  const denyIds = proxy.denyTopicIds ?? [];
  const traceDeny = Boolean(trace?.denyListMatch);
  const showDenyFromConfig =
    proxy.routingStrategy === "semantic" && denyIds.length > 0;
  if (showDenyFromConfig || traceDeny) {
    const did = "llmpx-deny";
    const n = denyIds.length;
    const denySubtitle = trace?.denyTopicLabel
      ? truncate(trace.denyTopicLabel, 44)
      : n > 0
        ? `${n} topic${n === 1 ? "" : "s"} · Prompt Guard`
        : "Prompt Guard · deny list";
    nodes.push({
      id: did,
      kind: "deny",
      title: "Deny list",
      subtitle: denySubtitle,
    });
    edges.push({
      id: "llmpx-e-proxy-deny",
      source: proxyId,
      target: did,
      active: traceDeny,
    });
  }

  return { nodes, edges };
}

/**
 * Top-down tree layout: root at top, each row is one hop deeper.
 */
export function layoutLlmProxyDiagram(graph: LlmProxyDiagramGraph): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const { nodes, edges } = graph;
  if (nodes.length === 0) return positions;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, 0);
    children.set(n.id, []);
  }
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
    children.get(e.source)!.push(e.target);
  }

  const roots = nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0);
  const rootId = roots[0]?.id ?? nodes[0].id;

  const level = new Map<string, number>();
  const queue: string[] = [rootId];
  level.set(rootId, 0);
  while (queue.length) {
    const id = queue.shift()!;
    const d = level.get(id)!;
    for (const c of children.get(id) ?? []) {
      if (!level.has(c)) {
        level.set(c, d + 1);
        queue.push(c);
      }
    }
  }
  for (const n of nodes) {
    if (!level.has(n.id)) level.set(n.id, 0);
  }

  const byLevel = new Map<number, string[]>();
  let maxL = 0;
  for (const n of nodes) {
    const L = level.get(n.id) ?? 0;
    maxL = Math.max(maxL, L);
    const row = byLevel.get(L) ?? [];
    row.push(n.id);
    byLevel.set(L, row);
  }

  const H = LLM_PROXY_DIAGRAM_NODE_HEIGHT;
  const GAP_X = 28;
  /** Space from LLM Proxy to the semantic embedding policy card (3× policy row gap). */
  const GAP_PROXY_TO_SEMANTIC_EMBEDDING_X = GAP_X * 3;
  /** Vertical gap between stacked hops (client → gateway → proxy → …). */
  const GAP_Y = 58;
  /**
   * Extra vertical offset before policy rows (routes / fallback / deny) so the ingress chain
   * breathes more above the policy fan-out.
   */
  const EXTRA_Y_BEFORE_POLICY_LEVEL = 52;
  const CENTER_X = 900;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (let L = 0; L <= maxL; L++) {
    let row = [...(byLevel.get(L) ?? [])].sort();
    row = row.filter((id) => id !== LLM_PROXY_SEMANTIC_EMBEDDING_NODE_ID);
    let rowW = 0;
    for (const id of row) {
      const node = nodeMap.get(id);
      rowW += node ? diagramNodeWidth(node.kind) : LLM_PROXY_DIAGRAM_NODE_WIDTH;
    }
    rowW += Math.max(0, row.length - 1) * GAP_X;
    let x = CENTER_X - rowW / 2;
    const y =
      100 +
      L * (H + GAP_Y) +
      (L >= 3 ? EXTRA_Y_BEFORE_POLICY_LEVEL : 0);
    for (const id of row) {
      const node = nodeMap.get(id);
      const w = node ? diagramNodeWidth(node.kind) : LLM_PROXY_DIAGRAM_NODE_WIDTH;
      positions.set(id, { x, y });
      x += w + GAP_X;
    }
  }

  const proxyPos = positions.get("llmpx-proxy");
  /** Embedding is excluded from row placement above, so it is never in `positions` yet — check the graph, not `positions.has`. */
  if (proxyPos && nodeMap.has(LLM_PROXY_SEMANTIC_EMBEDDING_NODE_ID)) {
    positions.set(LLM_PROXY_SEMANTIC_EMBEDDING_NODE_ID, {
      x: proxyPos.x + diagramNodeWidth("proxy") + GAP_PROXY_TO_SEMANTIC_EMBEDDING_X,
      y: proxyPos.y,
    });
  }

  return positions;
}
