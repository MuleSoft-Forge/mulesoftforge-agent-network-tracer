/**
 * Agent Network Composer — intermediate model (the single source of truth).
 *
 * The whole Composer UI edits ONE `ComposerProject`. The three project files
 * (exchange.json, agent-network.yaml, brokers/<name>.agent) are pure, one-way
 * projections of this model (see lib/composer/serialize). The model owns every
 * canonical name so a single edit fans out across all three files.
 *
 * MVP rules baked in here:
 *  - Compose EXISTING Exchange assets or registry-local connections (never publish new Exchange assets).
 *  - Single broker per network (brokers[] kept for forward-compat).
 *  - Dependencies-only: each asset -> exchange.json dependency + yaml connection
 *    (+ deploy variable). No locally-defined `registry` cards are emitted.
 *  - The network has no a2a card; the broker's card is the public A2A front door.
 */

import { z } from "zod";
import { NetworkRegistrySchema } from "@/lib/composer/registry/types";
import { ConnectionAuthSchema } from "@/lib/composer/connectivity/auth-zod";
import {
  ConnectionAccessSchema,
  ConnectionPoliciesSchema,
} from "@/lib/composer/connectivity/connection-extras-zod";
import { PolicyBindingsMapSchema } from "@/lib/composer/connectivity/policy-bindings-zod";
import {
  buildDerivedConnection,
  deriveConnectionVariablesForAsset,
} from "@/lib/composer/connectivity/connection";
import { derivePolicyVariableBindings } from "@/lib/composer/connectivity/policy-variable-bindings";
import { variableStorageKey } from "@/lib/composer/variable-keys";
import { connectionIdForBaseName, normalizeAnfId } from "@/lib/composer/anf-id";
import type {
  ConnectionAccess,
  ConnectionAuth,
  ConnectionPolicies,
  DerivedConnectionSpec,
} from "@/lib/composer/connectivity/types";

/** The one discriminator per composed asset. Everything else is derived. */
export type AssetKind = "agent" | "mcp" | "llm";

/** kind -> exchange.json dependency classifier. */
export const CLASSIFIER_BY_KIND: Record<AssetKind, string> = {
  agent: "agent-metadata",
  mcp: "mcp-metadata",
  llm: "llm-metadata",
};

/** kind -> agent-network.yaml connection kind AND .agent URI scheme (they coincide). */
export const CONNECTION_KIND_BY_KIND: Record<AssetKind, "a2a" | "mcp" | "llm"> = {
  agent: "a2a",
  mcp: "mcp",
  llm: "llm",
};

// ---------------------------------------------------------------------------
// Zod schemas (source of truth; TS types are inferred below)
// ---------------------------------------------------------------------------

export const AssetKindSchema = z.enum(["agent", "mcp", "llm"]);

export { ConnectionAuthSchema };
export type { ConnectionAuth, ConnectionAccess, ConnectionPolicies };

export const ImportedAssetSchema = z.object({
  /** Internal id (uuid). */
  id: z.string().min(1),
  kind: AssetKindSchema,
  /** Exchange GAV of the EXISTING published asset. */
  groupId: z.string().min(1),
  assetId: z.string().min(1),
  version: z.string().min(1),
  /** ref.namespace in yaml; defaults to groupId. */
  namespace: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  /** Canonical model-owned name; base for connection/registry/variable names. */
  baseName: z.string().min(1),
  /**
   * Connection resolved against the yaml `registry:` block rather than an
   * exchange.json dependency on import. Such assets contribute no dependency
   * on export.
   */
  registryLocal: z.boolean().optional(),
  /**
   * Explicit connection name from an imported file that doesn't follow the
   * derived `<base>Connection` convention. When set it wins so actions/llm
   * bindings keep resolving to the real connection. Normally undefined.
   */
  connectionName: z.string().optional(),
  /** Deploy-time default URL for the connection (becomes the variable default). */
  url: z.string().optional(),
  /**
   * Yaml `url:` when it is a deploy variable ref (e.g. ${openaiLlm.baseUrl}).
   * Preserves non-default group/field names on import round-trip.
   */
  urlRef: z.string().optional(),
  /**
   * Yaml `url:` when it is a literal endpoint (not a ${group.field} ref).
   * Preserved on import round-trip instead of substituting a deploy variable.
   */
  literalConnectionUrl: z.string().optional(),
  /**
   * exchange.json metadata.variables group for this asset when it differs from
   * toIdentifier(assetId) — inferred from urlRef/auth refs on import.
   */
  variableGroup: z.string().optional(),
  /** Connection authentication per agent_network_v2.json (omit when none). */
  authentication: ConnectionAuthSchema.optional(),
  /** Connection access modifier. Omit in yaml when internal (default). */
  access: ConnectionAccessSchema.optional(),
  /** Inbound/outbound policy bindings on the connection. */
  policies: ConnectionPoliciesSchema.optional(),
  /** Exchange dependency packaging (default zip on export). */
  packaging: z.string().optional(),
  /** Raw a2a card / mcp metadata / llm metadata, for detail panels only. */
  meta: z.unknown().optional(),
});

export const OutputScalarTypeSchema = z.enum(["string", "number", "integer", "boolean"]);
export type OutputScalarType = z.infer<typeof OutputScalarTypeSchema>;

export const OutputItemsTypeSchema = z.enum(["string", "number", "integer", "boolean", "object"]);
export type OutputItemsType = z.infer<typeof OutputItemsTypeSchema>;

export type OutputProperty = {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  default?: string;
  /** Allowed values when type is string, number, or integer. */
  enum?: string[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minItems?: number;
  maxItems?: number;
  /** Required child property names when type is object. */
  required?: string[];
  /** Element type when type is array (maps to items.type in .agent). */
  itemsType?: OutputItemsType;
  /** Nested fields when type is object. */
  properties?: OutputProperty[];
  /** Nested fields when array items are objects. */
  itemsProperties?: OutputProperty[];
};

export const OutputPropertySchema: z.ZodType<OutputProperty> = z.lazy(() =>
  z.object({
    name: z.string().min(1),
    type: z.enum(["string", "number", "integer", "boolean", "array", "object"]),
    description: z.string().optional(),
    default: z.string().optional(),
    enum: z.array(z.string()).optional(),
    pattern: z.string().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    exclusiveMinimum: z.number().optional(),
    exclusiveMaximum: z.number().optional(),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().nonnegative().optional(),
    required: z.array(z.string()).optional(),
    itemsType: OutputItemsTypeSchema.optional(),
    properties: z.array(OutputPropertySchema).optional(),
    itemsProperties: z.array(OutputPropertySchema).optional(),
  })
);

export const ExecutorWithArgSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
});

export const ExecutorRunStatementSchema = z.object({
  kind: z.literal("run"),
  actionName: z.string().min(1),
  withArgs: z.array(ExecutorWithArgSchema).optional(),
});

export const ExecutorSetStatementSchema = z.object({
  kind: z.literal("set"),
  variable: z.string().min(1),
  expression: z.string().min(1),
});

export const ExecutorStatementSchema = z.discriminatedUnion("kind", [
  ExecutorRunStatementSchema,
  ExecutorSetStatementSchema,
]);

export const OrchestratorActionBindingSchema = z.object({
  /** Reasoning action alias (e.g. search_help). */
  alias: z.string().min(1),
  /** Underlying @actions.<name> target. */
  actionName: z.string().min(1),
  withArgs: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
});

export const ActionInputSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  default: z.string().optional(),
});

export const BrokerActionSchema = z.object({
  id: z.string().min(1),
  /** Action key referenced from graph nodes as @actions.<name>. */
  name: z.string().min(1),
  actionKind: z.enum(["a2a:send_message", "mcp:tool"]),
  /** Connection (imported asset) this action targets. */
  connectionName: z.string().min(1),
  /** Required for mcp:tool. */
  toolName: z.string().optional(),
  inputs: z.array(ActionInputSchema).optional(),
  httpHeaders: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
});

export const OpenAiReasoningEffortSchema = z.enum(["NONE", "MINIMAL", "LOW", "MEDIUM", "HIGH"]);
export const GeminiThinkingLevelSchema = z.enum(["LOW", "HIGH"]);

export const LlmBindingSchema = z.object({
  id: z.string().min(1),
  /** Key in the .agent `llm:` block, e.g. "geminiFlash". */
  name: z.string().min(1),
  /** Connection of an imported llm asset. */
  connectionName: z.string().min(1),
  provider: z.enum(["OpenAI", "Gemini"]),
  model: z.string().min(1),
  /** OpenAI-only tuning. */
  reasoningEffort: OpenAiReasoningEffortSchema.optional(),
  /** Shared optional tuning. */
  temperature: z.number().optional(),
  topP: z.number().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  /** OpenAI-only. */
  topLogprobs: z.number().int().nonnegative().optional(),
  /** Gemini-only. */
  thinkingLevel: GeminiThinkingLevelSchema.optional(),
  thinkingBudget: z.number().optional(),
  responseLogprobs: z.boolean().optional(),
  /** Provider-specific keys not modeled above — preserved on round-trip. */
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const GraphNodeKindSchema = z.enum([
  "trigger",
  "generator",
  "orchestrator",
  "subagent",
  "executor",
  "router",
  "echo",
]);

export const RouterRouteSchema = z.object({
  id: z.string().min(1),
  targetNodeId: z.string().min(1),
  when: z.string().min(1),
  label: z.string().optional(),
});

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: GraphNodeKindSchema,
  /** Node id emitted in the .agent (e.g. "classifySeverity"). */
  name: z.string().min(1),
  label: z.string().optional(),
  description: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }),

  /** trigger: interface key (e.g. a2a, a2a_v03). */
  interfaceName: z.string().optional(),
  /** trigger: brokers:// URI preserved from import. */
  triggerTarget: z.string().optional(),

  /** generator / orchestrator / subagent. */
  llmBindingName: z.string().optional(),
  systemInstructions: z.string().optional(),
  /** generator prompt. */
  prompt: z.string().optional(),
  /** orchestrator / subagent reasoning instructions. */
  reasoningInstructions: z.string().optional(),
  /** When true, emit `instructions: ->` + block under reasoning (imported AgentScript shape). */
  reasoningInstructionsProcedure: z.boolean().optional(),
  /** orchestrator / subagent reasoning loop cap (AgentScript `max_number_of_loops`). */
  maxNumberOfLoops: z.number().int().positive().optional(),
  /** orchestrator / subagent per-task timeout (AgentScript `task_timeout_secs`). */
  taskTimeoutSecs: z.number().int().positive().optional(),
  /** orchestrator / subagent consecutive error cap (AgentScript `max_consecutive_errors`). */
  maxConsecutiveErrors: z.number().int().positive().optional(),
  /** orchestrator / subagent: action names it may call (derived from actionBindings when imported). */
  actionRefs: z.array(z.string()).optional(),
  /** orchestrator / subagent: reasoning action map with optional with-args (import round-trip). */
  actionBindings: z.array(OrchestratorActionBindingSchema).optional(),
  outputs: z.array(OutputPropertySchema).optional(),

  /** generator: when true, emit `prompt: ->` procedure form. */
  promptProcedure: z.boolean().optional(),

  /** executor deterministic statements in the do: block. */
  executorStatements: z.array(ExecutorStatementSchema).optional(),

  /** router. */
  routes: z.array(RouterRouteSchema).optional(),
  otherwiseTargetNodeId: z.string().optional(),

  /** echo. */
  echoKind: z.enum(["a2a:status_update_event", "a2a:artifact_update_event", "a2a:response"]).optional(),
  state: z.string().optional(),
  /** Status echo: simple text, expression, or full `a2a.message({...})` (stored verbatim when imported). */
  message: z.string().optional(),
  /** Response echo: full `a2a.task({...})` expression (a2a:response kind). */
  taskExpr: z.string().optional(),
  /** When true, emit multiline `a2a.task({…})` (preserves imported formatting). */
  echoTaskMultiline: z.boolean().optional(),
  /** When true, emit multiline `a2a.message({…})` (preserves imported formatting). */
  echoMessageMultiline: z.boolean().optional(),
  /** Artifact echo: full `a2a.artifact({...})` expression. */
  artifactExpr: z.string().optional(),
  echoAppend: z.boolean().optional(),
  echoLastChunk: z.boolean().optional(),
  /** Status echo optional metadata dict expression. */
  metadataExpr: z.string().optional(),

  /**
   * Single on_exit transition target (node id) for non-router, non-echo nodes
   * and for the trigger's on_message. Router encodes targets in routes/otherwise;
   * echo is terminal.
   */
  onExitTarget: z.string().optional(),
});

export const BrokerCardProviderSchema = z.object({
  organization: z.string().optional(),
  url: z.string().optional(),
});

export const BrokerCardExtensionSchema = z.object({
  uri: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

/** OpenAPI-style security requirement: scheme name -> scope list. */
export const BrokerCardSecurityRequirementSchema = z.record(z.string(), z.array(z.string()));

export const BrokerCardSignatureSchema = z.object({
  protected: z.string().min(1),
  signature: z.string().min(1),
  header: z.string().optional(),
});

export const BrokerCardCapabilitiesSchema = z.object({
  streaming: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  extendedAgentCard: z.boolean().optional(),
  extensions: z.array(BrokerCardExtensionSchema).optional(),
  /** Capability fields not edited in UI — preserved on round-trip. */
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const BrokerCardSkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
  inputModes: z.array(z.string()).optional(),
  outputModes: z.array(z.string()).optional(),
  securityRequirements: z.array(BrokerCardSecurityRequirementSchema).optional(),
  /** Skill fields not edited in UI — preserved on round-trip. */
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const BrokerCardProtocolBindingSchema = z.enum(["JSONRPC", "GRPC", "HTTP+JSON"]);

export const BrokerCardSupportedInterfaceSchema = z.object({
  url: z.string().min(1),
  protocolVersion: z.string().min(1),
  protocolBinding: z.union([BrokerCardProtocolBindingSchema, z.string().min(1)]),
  tenant: z.string().optional(),
});

export const BrokerCardSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  version: z.string().min(1),
  documentationUrl: z.string().optional(),
  iconUrl: z.string().optional(),
  provider: BrokerCardProviderSchema.optional(),
  capabilities: BrokerCardCapabilitiesSchema.optional(),
  defaultInputModes: z.array(z.string()).optional(),
  defaultOutputModes: z.array(z.string()).optional(),
  skills: z.array(BrokerCardSkillSchema).optional(),
  /** Endpoints where clients invoke this agent (A2A Agent Interface). First entry is preferred. */
  supportedInterfaces: z.array(BrokerCardSupportedInterfaceSchema).optional(),
  /** Card-level security requirements (OpenAPI-style OR of ANDs). */
  securityRequirements: z.array(BrokerCardSecurityRequirementSchema).optional(),
  /** Declared security schemes keyed by name. */
  securitySchemes: z.record(z.string(), z.unknown()).optional(),
  /** JWS signatures for the agent card. */
  signatures: z.array(BrokerCardSignatureSchema).optional(),
  /** Top-level Agent Card fields not edited in UI — preserved on round-trip. */
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const BrokerSchema = z.object({
  id: z.string().min(1),
  /** Broker map key: yaml brokers key, .agent config.agent_name, brokers/*.agent filename. */
  name: z.string(),
  interfaceName: z.string().min(1).default("a2a"),
  card: BrokerCardSchema,
  /** Inbound/outbound policies on brokers.*.interfaces.a2a.policies. */
  interfacePolicies: ConnectionPoliciesSchema.optional(),
  systemInstructions: z.string().optional(),
  /** When true, emit root system.instructions as `->` procedure form. */
  systemInstructionsProcedure: z.boolean().optional(),
  /** Optional `config.label` in the .agent file. */
  agentConfigLabel: z.string().optional(),
  /** Optional `config.description` in the .agent file. */
  agentConfigDescription: z.string().optional(),
  /** `@dialect: AGENTFABRIC=x.y` version from the file header (preserved on round-trip). */
  agentDialectVersion: z.string().optional(),
  defaultLlmBindingName: z.string().optional(),
  llmBindings: z.array(LlmBindingSchema).default([]),
  actions: z.array(BrokerActionSchema).default([]),
  nodes: z.array(GraphNodeSchema).default([]),
});

/** Optional yaml info.* fields beyond label/version (NetworkInfoObject). */
export const YamlNetworkContactSchema = z.object({
  name: z.string().optional(),
  url: z.string().optional(),
  email: z.string().optional(),
});

export const YamlNetworkLicenseSchema = z.object({
  name: z.string().min(1),
  identifier: z.string().optional(),
  url: z.string().optional(),
});

export const YamlNetworkInfoSchema = z.object({
  /** agent-network.yaml info.version (may differ from exchange.json version, e.g. v1). */
  version: z.string().optional(),
  description: z.string().optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  termsOfService: z.string().optional(),
  contact: YamlNetworkContactSchema.optional(),
  license: YamlNetworkLicenseSchema.optional(),
});

export const ProjectIdentitySchema = z.object({
  name: z.string(),
  /** Org id == network project groupId. */
  organizationId: z.string(),
  assetId: z.string(),
  version: z.string().min(1),
  descriptorVersion: z.string().min(1).default("1.0.0"),
  /** Exchange version group for publish/deploy (not yaml info.version). */
  apiVersion: z.string().min(1).default("v1.0"),
  /** Optional Exchange project description. */
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  /** Optional agent-network.yaml info.* fields (separate from exchange.json). */
  yamlInfo: YamlNetworkInfoSchema.optional(),
});

/** Optional per-variable overrides (description/default) keyed by `${group}.${field}`. */
export const VariableOverrideSchema = z.object({
  description: z.string().optional(),
  default: z.string().optional(),
  secret: z.boolean().optional(),
});

/**
 * A user-declared deploy variable not derived from a connection/policy — e.g. a
 * `${group.field}` marker typed into instructions/prompts that must still be
 * emitted into exchange.json metadata.variables.
 *
 * When `flat: true`, `field` is the full exchange.json key (runtime system limits).
 */
export const CustomVariableSchema = z.object({
  group: z.string().min(1).optional(),
  field: z.string().min(1),
  flat: z.boolean().optional(),
  description: z.string().optional(),
  default: z.string().optional(),
  secret: z.boolean().optional(),
});

export const ComposerProjectSchema = z.object({
  version: z.literal(1).default(1),
  identity: ProjectIdentitySchema,
  assets: z.array(ImportedAssetSchema).default([]),
  brokers: z.array(BrokerSchema).default([]),
  /** Declared policy bindings keyed by context.policies map key (connection ref.name). */
  policyBindings: PolicyBindingsMapSchema,
  variableOverrides: z.record(z.string(), VariableOverrideSchema).optional(),
  /** Manually declared deploy variables (not derived from connections/policies). */
  customVariables: z.array(CustomVariableSchema).default([]),
  /** Authored / imported agent-network.yaml registry block. */
  registry: NetworkRegistrySchema.optional(),
  /**
   * Imported exchange.json dependencies that no yaml connection claimed. Everything
   * else is re-derived from `assets` on export so asset edits can't desync the two
   * files; these leftovers have no asset to derive from, so they're kept verbatim.
   */
  unmatchedDependencies: z
    .array(
      z.object({
        groupId: z.string(),
        assetId: z.string(),
        version: z.string(),
        classifier: z.string(),
        packaging: z.string().default("zip"),
      })
    )
    .optional(),
  /**
   * When false, canvas positions are not written to exchange.json metadata and
   * hierarchical layout is re-derived on import. Set false by reset-to-hierarchical.
   */
  graphLayoutPinned: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type AssetAuth = ConnectionAuth;
export type ImportedAsset = z.infer<typeof ImportedAssetSchema>;
export type ExecutorStatement = z.infer<typeof ExecutorStatementSchema>;
export type ExecutorRunStatement = z.infer<typeof ExecutorRunStatementSchema>;
export type ExecutorSetStatement = z.infer<typeof ExecutorSetStatementSchema>;
export type OrchestratorActionBinding = z.infer<typeof OrchestratorActionBindingSchema>;
export type ActionInput = z.infer<typeof ActionInputSchema>;
export type BrokerAction = z.infer<typeof BrokerActionSchema>;
export type LlmBinding = z.infer<typeof LlmBindingSchema>;
export type GraphNodeKind = z.infer<typeof GraphNodeKindSchema>;
export type RouterRoute = z.infer<typeof RouterRouteSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type BrokerCardSkill = z.infer<typeof BrokerCardSkillSchema>;
export type BrokerCardExtension = z.infer<typeof BrokerCardExtensionSchema>;
export type BrokerCardSecurityRequirement = z.infer<typeof BrokerCardSecurityRequirementSchema>;
export type BrokerCardSignature = z.infer<typeof BrokerCardSignatureSchema>;
export type BrokerCardSupportedInterface = z.infer<typeof BrokerCardSupportedInterfaceSchema>;
export type BrokerCardCapabilities = z.infer<typeof BrokerCardCapabilitiesSchema>;
export type BrokerCardProvider = z.infer<typeof BrokerCardProviderSchema>;
export type BrokerCard = z.infer<typeof BrokerCardSchema>;
export type Broker = z.infer<typeof BrokerSchema>;
export type YamlNetworkInfo = z.infer<typeof YamlNetworkInfoSchema>;
export type ProjectIdentity = z.infer<typeof ProjectIdentitySchema>;
export type VariableOverride = z.infer<typeof VariableOverrideSchema>;
export type CustomVariable = z.infer<typeof CustomVariableSchema>;
export type ComposerProject = z.infer<typeof ComposerProjectSchema>;
export type { NetworkRegistry } from "@/lib/composer/registry/types";

// ---------------------------------------------------------------------------
// Derivations (pure) — connections, dependencies and deploy variables are all
// projections of `assets`. Serializers and validation use these so the files
// and the model never drift.
// ---------------------------------------------------------------------------

export type DerivedConnection = DerivedConnectionSpec;

export interface DerivedDependency {
  groupId: string;
  assetId: string;
  version: string;
  classifier: string;
  packaging: string;
}

export interface DerivedVariable {
  group: string;
  field: string;
  /** When true, serializes as a top-level exchange.json metadata.variables key. */
  flat?: boolean;
  description?: string;
  secret: boolean;
  default?: string;
}

/** camelCase-ish identifier from arbitrary text. */
export function toIdentifier(input: string, fallback = "asset"): string {
  const cleaned = input
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    // Lowercase only the first character of the first word so the function is
    // idempotent (camelCase in -> same camelCase out) and preserves acronyms
    // like "LLM" in later words.
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
  return cleaned || fallback;
}

/** Snake_case slug for project-scoped default connection IDs (Exchange assetId, then broker key). */
export function projectConnectionSlug(project: ComposerProject): string {
  const fromAssetId = project.identity.assetId?.trim();
  if (fromAssetId) return normalizeAnfId(fromAssetId, "network");
  const broker = primaryBroker(project);
  const fromBroker = broker?.name?.trim();
  if (fromBroker) return normalizeAnfId(fromBroker, "network");
  return "network";
}

/** Default yaml connection key when composing a new asset (unique per project in deploy environments). */
export function defaultConnectionIdForProject(project: ComposerProject, baseName: string): string {
  const projectSlug = projectConnectionSlug(project);
  const assetSlug = normalizeAnfId(baseName, "asset");
  return `${projectSlug}_${assetSlug}_connection`;
}

/** Assign a project-scoped connection id when composing from Exchange (import/yaml paths keep explicit names). */
export function assignDefaultConnectionName(
  project: ComposerProject,
  asset: ImportedAsset
): ImportedAsset {
  if (asset.connectionName?.trim()) return asset;
  const baseName = asset.baseName || asset.name || asset.assetId;
  let connectionName = defaultConnectionIdForProject(project, baseName);
  const used = new Set(project.assets.map((a) => connectionNameForAsset(a)));
  if (used.has(connectionName)) {
    let i = 2;
    while (used.has(`${connectionName}_${i}`)) i += 1;
    connectionName = `${connectionName}_${i}`;
  }
  return { ...asset, connectionName };
}

export function connectionNameForAsset(asset: ImportedAsset): string {
  if (asset.connectionName?.trim()) return asset.connectionName.trim();
  return connectionIdForBaseName(asset.baseName || asset.name || asset.assetId);
}

export function registryNameForAsset(asset: ImportedAsset): string {
  // Exchange registry refs use the published assetId verbatim (may contain hyphens).
  const assetId = asset.assetId?.trim();
  if (assetId) return assetId;
  return toIdentifier(asset.baseName || asset.name);
}

/** Variable group for an asset's deploy variables. */
export function variableGroupForAsset(asset: ImportedAsset): string {
  return asset.variableGroup ?? toIdentifier(asset.baseName || asset.name || asset.assetId);
}

export function deriveDependency(asset: ImportedAsset): DerivedDependency {
  return {
    groupId: asset.namespace || asset.groupId,
    assetId: asset.assetId,
    version: asset.version,
    classifier: CLASSIFIER_BY_KIND[asset.kind],
    packaging: asset.packaging ?? "zip",
  };
}

export function deriveConnection(asset: ImportedAsset): DerivedConnection {
  return buildDerivedConnection(asset);
}

/** Deploy variables for one asset: url + auth-derived secrets/refs. */
export function deriveVariablesForAsset(asset: ImportedAsset): DerivedVariable[] {
  return deriveConnectionVariablesForAsset(asset);
}

export function deriveDependencies(project: ComposerProject): DerivedDependency[] {
  // Registry-local connections resolve against the yaml `registry:` block rather
  // than Exchange, so they contribute no exchange.json dependency.
  return exchangeDependencyAssets(project).map(deriveDependency);
}

/** Assets that serialize to exchange.json dependencies[] (not registry-local). */
export function exchangeDependencyAssets(project: ComposerProject): ImportedAsset[] {
  return project.assets.filter((a) => !a.registryLocal);
}

export function deriveConnections(project: ComposerProject): DerivedConnection[] {
  return project.assets.map(deriveConnection);
}

/** All deploy variables, de-duped by `${group}.${field}`, with overrides applied. */
export function deriveVariables(project: ComposerProject): DerivedVariable[] {
  const byKey = new Map<string, DerivedVariable>();
  for (const asset of project.assets) {
    for (const v of deriveVariablesForAsset(asset)) {
      const key = `${v.group}.${v.field}`;
      if (!byKey.has(key)) byKey.set(key, v);
    }
  }
  for (const v of derivePolicyVariableBindings(project)) {
    const key = `${v.group}.${v.field}`;
    if (!byKey.has(key)) byKey.set(key, v);
  }
  for (const cv of project.customVariables ?? []) {
    const key = variableStorageKey(cv);
    if (!byKey.has(key)) {
      byKey.set(key, {
        group: cv.group ?? "",
        field: cv.field,
        ...(cv.flat ? { flat: true } : {}),
        description: cv.description,
        default: cv.default,
        secret: cv.secret ?? false,
      });
    }
  }
  if (project.variableOverrides) {
    for (const [key, override] of Object.entries(project.variableOverrides)) {
      const existing = byKey.get(key);
      if (existing) {
        byKey.set(key, {
          ...existing,
          description: override.description ?? existing.description,
          default: override.default ?? existing.default,
          secret: override.secret ?? existing.secret,
        });
      }
    }
  }
  return Array.from(byKey.values());
}

/** Convenience: the single broker (MVP). */
export function primaryBroker(project: ComposerProject): Broker | undefined {
  return project.brokers[0];
}

/** Find the imported asset backing a connection name. */
export function assetByConnectionName(
  project: ComposerProject,
  connectionName: string
): ImportedAsset | undefined {
  return project.assets.find((a) => connectionNameForAsset(a) === connectionName);
}

/** True when any graph node references a declared @actions target. */
export function brokerGraphReferencesActions(broker: Broker): boolean {
  for (const node of broker.nodes) {
    if (node.kind === "executor" && (node.executorStatements?.some((s) => s.kind === "run") ?? false)) return true;
    if (node.kind === "orchestrator" || node.kind === "subagent") {
      if ((node.actionRefs?.length ?? 0) > 0) return true;
      if ((node.actionBindings?.length ?? 0) > 0) return true;
    }
  }
  return false;
}

/** Connection names wired into the broker via actions or LLM bindings. */
export function brokerReferencedConnectionNames(broker: Broker): Set<string> {
  const names = new Set<string>();
  for (const action of broker.actions) names.add(action.connectionName);
  for (const binding of broker.llmBindings) names.add(binding.connectionName);
  return names;
}

/** Assets the broker actually uses — not the full network registry. */
export function assetsReferencedByBroker(project: ComposerProject, broker?: Broker): ImportedAsset[] {
  if (!broker) return [];
  const referenced = brokerReferencedConnectionNames(broker);
  return project.assets.filter((asset) => referenced.has(connectionNameForAsset(asset)));
}
