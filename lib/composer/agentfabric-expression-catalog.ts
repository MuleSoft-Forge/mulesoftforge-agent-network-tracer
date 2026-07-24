import type { Broker, GraphNodeKind } from "@/lib/composer/model";

/** One insertable AgentFabric runtime expression. */
export interface ExpressionCatalogEntry {
  insert: string;
  label: string;
  description?: string;
}

export interface ExpressionCatalogGroup {
  label: string;
  entries: ExpressionCatalogEntry[];
}

export type ExpressionCatalog = ExpressionCatalogGroup[];

/** Flat list for Monaco completion providers. */
export interface FlatExpressionCatalogEntry extends ExpressionCatalogEntry {
  group: string;
}

const REQUEST_SCOPE_MEMBERS = ["payload", "interface", "headers"] as const;

const REQUEST_SNIPPETS: ExpressionCatalogEntry[] = [
  {
    insert: "{!@request.payload.message.parts[0].text}",
    label: "User message text",
    description: "First text part of the inbound A2A message",
  },
  {
    insert: "@request.payload",
    label: "Request payload",
    description: "Full inbound trigger payload",
  },
  {
    insert: "@request.interface",
    label: "Request interface",
    description: "Trigger interface key (e.g. a2a)",
  },
  {
    insert: "@request.headers['Authorization']",
    label: "Authorization header",
    description: "Example request header access",
  },
];

/** Node kinds that expose input/output references in expressions. */
const REFERENCABLE_NODE_KINDS = new Set<GraphNodeKind>([
  "trigger",
  "generator",
  "orchestrator",
  "subagent",
  "executor",
]);

function nodeExpression(kind: string, name: string, member: "input" | "output", field?: string): string {
  const base = `@${kind}.${name}.${member}`;
  if (field) return `{!${base}.${field}}`;
  return base;
}

/** Build grouped expression suggestions from the current broker graph. */
export function buildExpressionCatalog(
  broker: Broker,
  options?: { excludeNodeId?: string }
): ExpressionCatalog {
  const groups: ExpressionCatalogGroup[] = [
    {
      label: "Request",
      entries: REQUEST_SNIPPETS,
    },
  ];

  const nodeEntries: ExpressionCatalogEntry[] = [];
  for (const node of broker.nodes) {
    if (options?.excludeNodeId && node.id === options.excludeNodeId) continue;
    if (!REFERENCABLE_NODE_KINDS.has(node.kind)) continue;

    nodeEntries.push({
      insert: nodeExpression(node.kind, node.name, "input"),
      label: `${node.kind}.${node.name}.input`,
      description: node.label ?? "Prior node input",
    });
    nodeEntries.push({
      insert: nodeExpression(node.kind, node.name, "output"),
      label: `${node.kind}.${node.name}.output`,
      description: node.label ?? "Prior node output",
    });
    for (const out of node.outputs ?? []) {
      nodeEntries.push({
        insert: nodeExpression(node.kind, node.name, "output", out.name),
        label: `${node.kind}.${node.name}.output.${out.name}`,
        description: out.description ?? `${out.type} output field`,
      });
    }
  }
  if (nodeEntries.length > 0) {
    groups.push({ label: "Graph nodes", entries: nodeEntries });
  }

  if (broker.actions.length > 0) {
    groups.push({
      label: "Actions",
      entries: broker.actions.map((a) => ({
        insert: `{!@actions.${a.name}}`,
        label: `@actions.${a.name}`,
        description: a.actionKind,
      })),
    });
  }

  if (broker.llmBindings.length > 0) {
    groups.push({
      label: "LLM",
      entries: broker.llmBindings.map((b) => ({
        insert: `@llm.${b.name}`,
        label: `@llm.${b.name}`,
        description: `${b.provider} · ${b.model}`,
      })),
    });
  }

  return groups;
}

export function flattenExpressionCatalog(catalog: ExpressionCatalog): FlatExpressionCatalogEntry[] {
  return catalog.flatMap((group) =>
    group.entries.map((entry) => ({ ...entry, group: group.label }))
  );
}

/** Documented global `@request.*` members from AgentFabricSchemaInfo.globalScopes. */
export function requestScopeMembers(): readonly string[] {
  return REQUEST_SCOPE_MEMBERS;
}
