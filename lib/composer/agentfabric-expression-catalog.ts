import type { Broker, GraphNodeKind, OutputSchemaNode } from "@/lib/composer/model";

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

/** First text part of the inbound A2A message — what a node wired off the trigger reads. */
export const REQUEST_MESSAGE_TEXT_EXPRESSION = "{!@request.payload.message.parts[0].text}";

const REQUEST_SNIPPETS: ExpressionCatalogEntry[] = [
  {
    insert: REQUEST_MESSAGE_TEXT_EXPRESSION,
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

const A2A_CONSTRUCTOR_SNIPPETS: ExpressionCatalogEntry[] = [
  {
    insert: 'a2a.message({messageId: uuid(), parts: [a2a.textPart("")]})',
    label: "a2a.message",
    description: "Build an A2A message from one or more parts",
  },
  {
    insert: 'a2a.textPart("")',
    label: "a2a.textPart",
    description: "Build a text part",
  },
  {
    insert: "a2a.dataPart({})",
    label: "a2a.dataPart",
    description: "Build a structured data part",
  },
  {
    insert: 'a2a.filePart({uri: "", name: "", mimeType: ""})',
    label: "a2a.filePart (URI)",
    description: "Build a file part from a URI",
  },
  {
    insert: 'a2a.filePart({bytes: "", name: "", mimeType: ""})',
    label: "a2a.filePart (bytes)",
    description: "Build a file part from base64 bytes",
  },
  {
    insert: 'a2a.artifact({artifactId: uuid(), name: "", parts: [a2a.dataPart({})]})',
    label: "a2a.artifact",
    description: "Build an A2A artifact from parts",
  },
];

const BUILTIN_SNIPPETS: ExpressionCatalogEntry[] = [
  { insert: "now()", label: "now", description: "Current UTC time in ISO 8601 format" },
  { insert: "uuid()", label: "uuid", description: "Random UUID v4" },
  { insert: 'strip("")', label: "strip", description: "Trim leading and trailing characters" },
  {
    insert: 'startswith("", "")',
    label: "startswith",
    description: "Test a string prefix",
  },
  { insert: 'endswith("", "")', label: "endswith", description: "Test a string suffix" },
  { insert: "parse_json('')", label: "parse_json", description: "Parse a JSON string" },
  { insert: "abs(0)", label: "abs", description: "Absolute numeric value" },
  { insert: "round(0, 2)", label: "round", description: "Round to an optional digit count" },
  { insert: "sum([])", label: "sum", description: "Sum a numeric list" },
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
  if (field) return `${base}.${field}`;
  return base;
}

function nestedOutputFieldPaths(
  schema: OutputSchemaNode,
  path: string
): Array<{ path: string; description?: string; type: string }> {
  const paths: Array<{ path: string; description?: string; type: string }> = [];
  if (schema.type === "object") {
    paths.push(...outputFieldPaths(schema.properties, path));
  }
  if (schema.type === "array" && schema.items) {
    const itemPath = `${path}[0]`;
    paths.push({
      path: itemPath,
      description: schema.items.description,
      type: schema.items.type,
    });
    paths.push(...nestedOutputFieldPaths(schema.items, itemPath));
  }
  return paths;
}

function outputFieldPaths(
  properties: Broker["nodes"][number]["outputs"],
  prefix = ""
): Array<{ path: string; description?: string; type: string }> {
  const paths: Array<{ path: string; description?: string; type: string }> = [];
  for (const property of properties ?? []) {
    const path = prefix ? `${prefix}.${property.name}` : property.name;
    paths.push({ path, description: property.description, type: property.type });
    paths.push(...nestedOutputFieldPaths(property, path));
  }
  return paths;
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
    for (const out of outputFieldPaths(node.outputs)) {
      nodeEntries.push({
        insert: nodeExpression(node.kind, node.name, "output", out.path),
        label: `${node.kind}.${node.name}.output.${out.path}`,
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

  const variableNames = new Set<string>(
    (broker.agentScriptVariables ?? []).map((variable) => variable.name.trim()).filter(Boolean)
  );
  if (variableNames.size > 0) {
    groups.push({
      label: "Workflow variables",
      entries: [...variableNames].sort().map((name) => ({
        insert: `@variables.${name}`,
        label: `@variables.${name}`,
        description: "Value assigned by an executor set statement",
      })),
    });
  }

  groups.push(
    { label: "A2A constructors", entries: A2A_CONSTRUCTOR_SNIPPETS },
    { label: "Built-in functions", entries: BUILTIN_SNIPPETS }
  );

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
