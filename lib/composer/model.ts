/**
 * Agent Network Composer — intermediate model (the single source of truth).
 *
 * The whole Composer UI edits ONE `ComposerProject`. The three project files
 * (exchange.json, agent-network.yaml, brokers/<name>.agent) are pure, one-way
 * projections of this model (see lib/composer/serialize). The model owns every
 * canonical name so a single edit fans out across all three files.
 *
 * MVP rules baked in here:
 *  - Compose EXISTING Exchange assets only (never author new agent/mcp/llm assets).
 *  - Single broker per network (brokers[] kept for forward-compat).
 *  - Dependencies-only: each asset -> exchange.json dependency + yaml connection
 *    (+ deploy variable). No locally-defined `registry` cards are emitted.
 *  - The network has no a2a card; the broker's card is the public A2A front door.
 */

import { z } from "zod";
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
   * Explicit connection name from an imported file that doesn't follow the
   * derived `<base>Connection` convention. When set it wins so actions/llm
   * bindings keep resolving to the real connection. Normally undefined.
   */
  connectionName: z.string().optional(),
  /** Deploy-time default URL for the connection (becomes the variable default). */
  url: z.string().optional(),
  /** Connection authentication per agent_network_v2.json (omit when none). */
  authentication: ConnectionAuthSchema.optional(),
  /** Connection access modifier. Omit in yaml when internal (default). */
  access: ConnectionAccessSchema.optional(),
  /** Inbound/outbound policy bindings on the connection. */
  policies: ConnectionPoliciesSchema.optional(),
  /** Raw a2a card / mcp metadata / llm metadata, for detail panels only. */
  meta: z.unknown().optional(),
});

export const OutputPropertySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "integer", "boolean", "array", "object"]),
  description: z.string().optional(),
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

export const LlmBindingSchema = z.object({
  id: z.string().min(1),
  /** Key in the .agent `llm:` block, e.g. "geminiFlash". */
  name: z.string().min(1),
  /** Connection of an imported llm asset. */
  connectionName: z.string().min(1),
  provider: z.enum(["OpenAI", "Gemini"]),
  model: z.string().min(1),
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

  /** trigger: interface key (always "a2a" in MVP). */
  interfaceName: z.string().optional(),

  /** generator / orchestrator / subagent. */
  llmBindingName: z.string().optional(),
  systemInstructions: z.string().optional(),
  /** generator prompt. */
  prompt: z.string().optional(),
  /** orchestrator / subagent reasoning instructions. */
  reasoningInstructions: z.string().optional(),
  /** orchestrator / subagent: action names it may call. */
  actionRefs: z.array(z.string()).optional(),
  outputs: z.array(OutputPropertySchema).optional(),

  /** executor. */
  runActionName: z.string().optional(),
  withArgs: z.array(z.object({ name: z.string(), value: z.string() })).optional(),

  /** router. */
  routes: z.array(RouterRouteSchema).optional(),
  otherwiseTargetNodeId: z.string().optional(),

  /** echo. */
  echoKind: z.enum(["a2a:status_update_event", "a2a:artifact_update_event"]).optional(),
  state: z.string().optional(),
  message: z.string().optional(),

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

export const BrokerCardCapabilitiesSchema = z.object({
  streaming: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  extendedAgentCard: z.boolean().optional(),
  /** Capability fields not edited in UI (e.g. extensions) — preserved on round-trip. */
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
  /** Skill fields not edited in UI (e.g. securityRequirements) — preserved on round-trip. */
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
  name: z.string().min(1),
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
  /** Top-level Agent Card fields not edited in UI — preserved on round-trip. */
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const BrokerSchema = z.object({
  id: z.string().min(1),
  /** Used identically in yaml brokers key, .agent config.agent_name, trigger target. */
  name: z.string().min(1),
  interfaceName: z.string().min(1).default("a2a"),
  card: BrokerCardSchema,
  /** Inbound/outbound policies on brokers.*.interfaces.a2a.policies. */
  interfacePolicies: ConnectionPoliciesSchema.optional(),
  systemInstructions: z.string().optional(),
  defaultLlmBindingName: z.string().optional(),
  llmBindings: z.array(LlmBindingSchema).default([]),
  actions: z.array(BrokerActionSchema).default([]),
  nodes: z.array(GraphNodeSchema).default([]),
});

/** Optional yaml info.* fields beyond label/version (NetworkInfoObject). */
export const YamlNetworkInfoSchema = z.object({
  description: z.string().optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const ProjectIdentitySchema = z.object({
  name: z.string().min(1),
  /** Org id == network project groupId. */
  organizationId: z.string().min(1),
  assetId: z.string().min(1),
  version: z.string().min(1),
  descriptorVersion: z.string().min(1).default("1.0.0"),
  /** Exchange version group for publish/deploy (not yaml info.version). */
  apiVersion: z.string().min(1).default("v2.0"),
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
 */
export const CustomVariableSchema = z.object({
  group: z.string().min(1),
  field: z.string().min(1),
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
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type AssetAuth = ConnectionAuth;
export type ImportedAsset = z.infer<typeof ImportedAssetSchema>;
export type OutputProperty = z.infer<typeof OutputPropertySchema>;
export type ActionInput = z.infer<typeof ActionInputSchema>;
export type BrokerAction = z.infer<typeof BrokerActionSchema>;
export type LlmBinding = z.infer<typeof LlmBindingSchema>;
export type GraphNodeKind = z.infer<typeof GraphNodeKindSchema>;
export type RouterRoute = z.infer<typeof RouterRouteSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type BrokerCardSkill = z.infer<typeof BrokerCardSkillSchema>;
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
  packaging: "zip";
}

export interface DerivedVariable {
  group: string;
  field: string;
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

export function connectionNameForAsset(asset: ImportedAsset): string {
  return asset.connectionName || `${toIdentifier(asset.baseName || asset.name || asset.assetId)}Connection`;
}

export function registryNameForAsset(asset: ImportedAsset): string {
  return toIdentifier(asset.baseName || asset.name || asset.assetId);
}

/** Variable group for an asset's deploy variables. */
export function variableGroupForAsset(asset: ImportedAsset): string {
  return toIdentifier(asset.baseName || asset.name || asset.assetId);
}

export function deriveDependency(asset: ImportedAsset): DerivedDependency {
  return {
    groupId: asset.namespace || asset.groupId,
    assetId: asset.assetId,
    version: asset.version,
    classifier: CLASSIFIER_BY_KIND[asset.kind],
    packaging: "zip",
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
  return project.assets.map(deriveDependency);
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
    const key = `${cv.group}.${cv.field}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        group: cv.group,
        field: cv.field,
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
