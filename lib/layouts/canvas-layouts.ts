import type { CanonicalGraph, CanonicalNode } from "@/lib/agent-network-types";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 56;
const PAD = 24;
/** Space between the last agent and the first MCP */
const AGENT_MCP_GAP = PAD * 3;
const CANVAS_SIZE = 2000;

export type CanvasLayout = "tree";

interface Position {
  x: number;
  y: number;
}

/**
 * Build a map of parent -> children relationships from edges
 */
function buildChildrenMap(edges: CanonicalGraph["edges"]): Map<string, string[]> {
  const childrenMap = new Map<string, string[]>();
  for (const edge of edges) {
    const children = childrenMap.get(edge.source) || [];
    children.push(edge.target);
    childrenMap.set(edge.source, children);
  }
  return childrenMap;
}

/**
 * Find root nodes (brokers or nodes with no incoming edges)
 */
function findRootNodes(
  nodes: CanonicalNode[],
  edges: CanonicalGraph["edges"]
): CanonicalNode[] {
  const brokers = nodes.filter((n: CanonicalNode) => n.type === "BROKER");
  if (brokers.length > 0) return brokers;

  const hasIncomingEdge = new Set<string>();
  for (const edge of edges) {
    hasIncomingEdge.add(edge.target);
  }
  return nodes.filter((n: CanonicalNode) => !hasIncomingEdge.has(n.id));
}

/**
 * Calculate bounding box for a set of nodes
 */
function calculateBounds(
  nodeIds: string[],
  positions: Map<string, Position>
): { minX: number; maxX: number; centerX: number } | null {
  if (nodeIds.length === 0) return null;

  const nodePositions = nodeIds
    .map((id: string) => positions.get(id))
    .filter((pos): pos is Position => pos !== undefined);

  if (nodePositions.length === 0) return null;

  const minX = Math.min(...nodePositions.map((p: Position) => p.x));
  const maxX = Math.max(...nodePositions.map((p: Position) => p.x));
  return { minX, maxX, centerX: (minX + maxX) / 2 };
}

/**
 * Place broker's direct children (agents on left, MCPs on right).
 * Agents: single flat row. MCPs: single flat row. First MCP placed directly next to last agent.
 * LLMs: placed to the right of the broker at the same Y level.
 */
function placeBrokerChildren(
  children: CanonicalNode[],
  positions: Map<string, Position>,
  startY: number,
  centerX: number,
  brokerId?: string
): void {
  const agents = children.filter((n: CanonicalNode) => n.type === "AGENT");
  const mcps = children.filter((n: CanonicalNode) => n.type === "MCP");
  const llms = children.filter((n: CanonicalNode) => n.type === "LLM");

  const currentY = startY;
  const agentGroupWidth = agents.length > 0 ? agents.length * (NODE_WIDTH + PAD) - PAD : 0;
  const mcpGroupWidth = mcps.length > 0 ? mcps.length * (NODE_WIDTH + PAD) - PAD : 0;
  
  // Calculate total width: agents + gap + MCPs
  const totalWidth = agentGroupWidth + (agents.length > 0 && mcps.length > 0 ? AGENT_MCP_GAP : 0) + mcpGroupWidth;
  
  // Center the entire group (agents + MCPs) around centerX
  const leftEdge = centerX - totalWidth / 2;

  // Place agents in one flat row starting from leftEdge
  const agentStartX = leftEdge;
  agents.forEach((agent, i) => {
    positions.set(agent.id, {
      x: agentStartX + i * (NODE_WIDTH + PAD),
      y: currentY,
    });
  });

  // Place MCPs directly next to the last agent
  // Calculate the right edge of the last agent: its x position + NODE_WIDTH
  let mcpStartX: number;
  if (agents.length > 0 && mcps.length > 0) {
    // Last agent's x position
    const lastAgentX = agentStartX + (agents.length - 1) * (NODE_WIDTH + PAD);
    // Right edge of last agent = x + width
    const lastAgentRightEdge = lastAgentX + NODE_WIDTH;
    // First MCP starts right after last agent with gap
    mcpStartX = lastAgentRightEdge + AGENT_MCP_GAP;
  } else if (mcps.length > 0) {
    // No agents, start MCPs at leftEdge
    mcpStartX = leftEdge;
  } else {
    mcpStartX = leftEdge; // No MCPs, won't be used
  }
  
  mcps.forEach((mcp, i) => {
    positions.set(mcp.id, {
      x: mcpStartX + i * (NODE_WIDTH + PAD),
      y: currentY,
    });
  });

  // Place LLMs to the right of the broker at the same Y level
  if (llms.length > 0 && brokerId) {
    const brokerPos = positions.get(brokerId);
    if (brokerPos) {
      const llmStartX = brokerPos.x + NODE_WIDTH + PAD * 2; // Gap after broker
      llms.forEach((llm, i) => {
        positions.set(llm.id, {
          x: llmStartX + i * (NODE_WIDTH + PAD),
          y: brokerPos.y, // Same Y level as broker
        });
      });
    }
  }
}

/**
 * Place descendants of nodes recursively, centering each parent above its children
 */
function placeDescendants(
  parentNodes: CanonicalNode[],
  childrenMap: Map<string, string[]>,
  nodeMap: Map<string, CanonicalNode>,
  positions: Map<string, Position>,
  startY: number
): void {
  if (parentNodes.length === 0) return;

  let currentY = startY;
  const nextLevelParents: CanonicalNode[] = [];

  // Process each parent node
  for (const parent of parentNodes) {
    const childIds = childrenMap.get(parent.id) || [];
    if (childIds.length === 0) continue;

    const children = childIds
      .map((id: string) => nodeMap.get(id))
      .filter((node): node is CanonicalNode => node !== undefined);

    if (children.length === 0) continue;

    // Place children horizontally centered under parent
    const parentPos = positions.get(parent.id);
    if (!parentPos) continue;

    const childStartX = parentPos.x - ((children.length - 1) * (NODE_WIDTH + PAD)) / 2;
    children.forEach((child, i) => {
      positions.set(child.id, {
        x: childStartX + i * (NODE_WIDTH + PAD),
        y: currentY,
      });
    });

    // Add children as parents for next level
    nextLevelParents.push(...children);
  }

  // Recursively place next level
  if (nextLevelParents.length > 0) {
    placeDescendants(
      nextLevelParents,
      childrenMap,
      nodeMap,
      positions,
      currentY + NODE_HEIGHT + PAD * 2
    );
  }
}

/**
 * Tree Layout: Broker at top, agents on left, MCP on right
 * Creates a pyramid/top-down structure
 * Broker is centered above the agents/MCPs group
 * Supports hierarchical relationships (agents/MCPs can have children)
 */
export function calculateTreeLayout(graph: CanonicalGraph): Map<string, Position> {
  const positions = new Map<string, Position>();
  if (graph.nodes.length === 0) return positions;

  const centerX = CANVAS_SIZE / 2;
  let currentY = CANVAS_SIZE * 0.2; // Start near top

  // Build node map and hierarchy
  const nodeMap = new Map<string, CanonicalNode>();
  graph.nodes.forEach((node) => nodeMap.set(node.id, node));

  const childrenMap = buildChildrenMap(graph.edges);
  const rootNodes = findRootNodes(graph.nodes, graph.edges);

  // If no edges, fall back to type-based layout
  if (graph.edges.length === 0) {
    const brokers = graph.nodes.filter((n: CanonicalNode) => n.type === "BROKER");
    const agents = graph.nodes.filter((n: CanonicalNode) => n.type === "AGENT");
    const mcps = graph.nodes.filter((n: CanonicalNode) => n.type === "MCP");
    const llms = graph.nodes.filter((n: CanonicalNode) => n.type === "LLM");

    // Place broker(s) at top center
    brokers.forEach((broker, i) => {
      const offsetX = brokers.length > 1 ? (i - (brokers.length - 1) / 2) * (NODE_WIDTH + PAD) : 0;
      positions.set(broker.id, {
        x: centerX + offsetX,
        y: currentY,
      });
    });

    if (brokers.length > 0) {
      currentY += NODE_HEIGHT + PAD * 2;
    }

    // Place agents and MCPs (LLMs will be placed separately relative to brokers)
    // Pass broker ID so LLMs can be positioned relative to brokers if needed
    if (brokers.length > 0) {
      placeBrokerChildren([...agents, ...mcps], positions, currentY, centerX, brokers[0].id);
    } else {
      placeBrokerChildren([...agents, ...mcps], positions, currentY, centerX);
    }
    
    // Place LLMs to the right of brokers at the same Y level
    if (llms.length > 0 && brokers.length > 0) {
      brokers.forEach((broker) => {
        const brokerPos = positions.get(broker.id);
        if (brokerPos) {
          const llmStartX = brokerPos.x + NODE_WIDTH + PAD * 2;
          llms.forEach((llm, i) => {
            positions.set(llm.id, {
              x: llmStartX + i * (NODE_WIDTH + PAD),
              y: brokerPos.y,
            });
          });
        }
      });
    }

    return positions;
  }

  // Place root nodes (brokers) temporarily at top center
  rootNodes.forEach((broker, i) => {
    const offsetX = rootNodes.length > 1 ? (i - (rootNodes.length - 1) / 2) * (NODE_WIDTH + PAD) : 0;
    positions.set(broker.id, {
      x: centerX + offsetX,
      y: currentY,
    });
  });

  if (rootNodes.length > 0) {
    currentY += NODE_HEIGHT + PAD * 2;
  }

  // Get direct children of brokers (excluding LLMs - they'll be placed separately)
  // Also exclude nodes that are descendants of other broker children (they'll be placed by placeDescendants)
  const brokerChildIds = new Set<string>();
  const llmChildren = new Map<string, CanonicalNode[]>(); // brokerId -> LLM nodes
  
  // Build set of all nodes that have incoming edges from non-broker nodes (descendants)
  const descendantIds = new Set<string>();
  for (const edge of graph.edges) {
    const sourceNode = nodeMap.get(edge.source);
    // If source is not a broker, then target is a descendant
    if (sourceNode && sourceNode.type !== "BROKER") {
      descendantIds.add(edge.target);
    }
  }
  
  rootNodes.forEach((broker) => {
    const children = (childrenMap.get(broker.id) || [])
      .map((id: string) => nodeMap.get(id))
      .filter((node): node is CanonicalNode => node !== undefined);

    const llms = children.filter((n: CanonicalNode) => n.type === "LLM");
    const nonLLMs = children.filter((n: CanonicalNode) => n.type !== "LLM");
    
    if (llms.length > 0) {
      llmChildren.set(broker.id, llms);
    }
    
    // Only add direct children that are NOT descendants of other nodes
    // (e.g., exclude MCPs that are children of agents)
    nonLLMs.forEach((child) => {
      if (!descendantIds.has(child.id)) {
        brokerChildIds.add(child.id);
      }
    });
  });

  const brokerChildren = Array.from(brokerChildIds)
    .map((id: string) => nodeMap.get(id))
    .filter((node): node is CanonicalNode => node !== undefined);

  placeBrokerChildren(brokerChildren, positions, currentY, centerX);

  const childrenBounds = calculateBounds(brokerChildren.map((n: CanonicalNode) => n.id), positions);

  // Center brokers above their children
  if (childrenBounds) {
    rootNodes.forEach((broker, i) => {
      const offsetX = rootNodes.length > 1 ? (i - (rootNodes.length - 1) / 2) * (NODE_WIDTH + PAD) : 0;
      positions.set(broker.id, {
        x: childrenBounds.centerX + offsetX,
        y: currentY - NODE_HEIGHT - PAD * 2,
      });
    });
  }
  
  // Place LLMs to the right of their respective brokers at the same Y level
  // (Do this AFTER brokers are repositioned above their children)
  rootNodes.forEach((broker) => {
    const brokerPos = positions.get(broker.id);
    const llms = llmChildren.get(broker.id);
    if (brokerPos && llms && llms.length > 0) {
      const llmStartX = brokerPos.x + NODE_WIDTH + PAD * 2; // Gap after broker
      llms.forEach((llm, i) => {
        positions.set(llm.id, {
          x: llmStartX + i * (NODE_WIDTH + PAD),
          y: brokerPos.y, // Same Y level as broker
        });
      });
    }
  });

  // Place descendants (children of agents/MCPs); broker children are one flat row
  const descendantsY = currentY + (NODE_HEIGHT + PAD) + PAD * 2;
  placeDescendants(brokerChildren, childrenMap, nodeMap, positions, descendantsY);

  return positions;
}

/**
 * Radial Layout: Nodes arranged in a circle
 */
export function calculateRadialLayout(graph: CanonicalGraph): Map<string, Position> {
  const positions = new Map<string, Position>();
  if (graph.nodes.length === 0) return positions;

  const centerX = CANVAS_SIZE / 2;
  const centerY = CANVAS_SIZE / 2;
  
  // Separate nodes by type for better organization
  const brokers = graph.nodes.filter((n: CanonicalNode) => n.type === "BROKER");
  const others = graph.nodes.filter((n: CanonicalNode) => n.type !== "BROKER");

  // Place broker(s) at center
  brokers.forEach((broker, i) => {
    if (brokers.length === 1) {
      positions.set(broker.id, { x: centerX, y: centerY });
    } else {
      // Multiple brokers: small circle at center
      const angle = (i / brokers.length) * 2 * Math.PI;
      const radius = NODE_WIDTH;
      positions.set(broker.id, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
    }
  });

  // Place other nodes in a circle around center
  const radius = Math.max(250, others.length * 20);
  others.forEach((node, i) => {
    const angle = (i / others.length) * 2 * Math.PI;
    positions.set(node.id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  });

  return positions;
}

/**
 * Apply repulsion physics to nodes
 * Nodes repel each other to avoid overlap
 */
export function applyRepulsion(
  positions: Map<string, Position>,
  graph: CanonicalGraph,
  iterations: number = 10
): Map<string, Position> {
  const newPositions = new Map(positions);
  const repulsionStrength = 50;
  const minDistance = NODE_WIDTH + PAD;

  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Map<string, { x: number; y: number }>();
    
    // Initialize forces
    graph.nodes.forEach((node) => {
      forces.set(node.id, { x: 0, y: 0 });
    });

    // Calculate repulsion forces between all pairs
    graph.nodes.forEach((node1, i) => {
      const pos1 = newPositions.get(node1.id);
      if (!pos1) return;

      graph.nodes.slice(i + 1).forEach((node2) => {
        const pos2 = newPositions.get(node2.id);
        if (!pos2) return;

        const dx = pos2.x - pos1.x;
        const dy = pos2.y - pos1.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;

        if (distance < minDistance) {
          // Repel nodes that are too close
          const force = repulsionStrength / (distance * distance);
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;

          const force1 = forces.get(node1.id)!;
          const force2 = forces.get(node2.id)!;
          
          force1.x -= fx;
          force1.y -= fy;
          force2.x += fx;
          force2.y += fy;
        }
      });
    });

    // Apply forces with damping
    const damping = 0.1;
    graph.nodes.forEach((node) => {
      const force = forces.get(node.id);
      if (!force) return;
      
      const pos = newPositions.get(node.id);
      if (!pos) return;

      newPositions.set(node.id, {
        x: pos.x + force.x * damping,
        y: pos.y + force.y * damping,
      });
    });
  }

  return newPositions;
}
