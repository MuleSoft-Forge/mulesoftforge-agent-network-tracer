/**
 * Reference content for agent-network.yaml — validated against the official
 * Agent Network v2 JSON Schema bundle in lib/composer/schema/anf/
 * (manifest.json tracks git provenance; npm run sync:anf-schemas refreshes).
 */

import { ANF_SCHEMA_MANIFEST, formatAnfSchemaProvenance } from "@/lib/composer/schema/anf/index";
import type { ExchangeJsonFieldDoc, ExchangeJsonNestedDoc } from "@/lib/composer/docs/exchange-json-schema";

export const AGENT_NETWORK_YAML_INTRO =
  "agent-network.yaml is the Agent Network v2 specification document. It declares network metadata (info), shared connections to external agents/MCP servers/LLMs (context.connections), and broker front doors (brokers). Composer bundles the official JSON Schemas from agent-fabric-specification (see manifest provenance below) and validates every emitted document with Ajv. Pair with exchange.json (Exchange descriptor + dependencies) and brokers/*.agent (broker graph).";

export const AGENT_NETWORK_YAML_SOURCES = [
  formatAnfSchemaProvenance(),
  `Upstream: ${ANF_SCHEMA_MANIFEST.source.remoteUrl} (${ANF_SCHEMA_MANIFEST.source.subpath})`,
  "Human reference: docs-agent-network agent-network/2.0 YAML reference (af-agent-network-yaml-reference.adoc)",
  "Central bundle API: lib/composer/schema/anf/index.ts (validate + display + manifest)",
];

export const AGENT_NETWORK_YAML_SCHEMA_FILES = ANF_SCHEMA_MANIFEST.files.map((f) => f.filename);

export const AGENT_NETWORK_YAML_TOP_LEVEL: ExchangeJsonFieldDoc[] = [
  {
    field: "agentNetwork",
    type: "string",
    composerUi: "—",
    composerSource: "hardcoded",
    notes: 'Required. Must be exactly "2.0.0". Spec version — not info.version or exchange.json apiVersion.',
  },
  {
    field: "info",
    type: "object",
    composerUi: "Project tab",
    composerSource: "editable",
    notes: "NetworkInfoObject. label + version required. See info.* below.",
  },
  {
    field: "context",
    type: "object?",
    composerUi: "Assets tab",
    composerSource: "derived",
    notes: "Reusable document-scoped entities. Composer emits context.connections from composed assets.",
  },
  {
    field: "registry",
    type: "object?",
    composerUi: "—",
    composerSource: "not-in-composer",
    notes: "Alternative to context for inline agent/MCP/LLM definitions. Composer uses context.connections + exchange.json dependencies instead.",
  },
  {
    field: "brokers",
    type: "object?",
    composerUi: "Broker tabs (A2A card, Access, LLM bindings, Actions, Behavior)",
    composerSource: "editable",
    notes: "Map of broker key → BrokerEntity (AgentScript + A2A card). See brokers.* below.",
  },
];

export const AGENT_NETWORK_YAML_INFO: ExchangeJsonNestedDoc = {
  title: "info.* (NetworkInfoObject)",
  fields: [
    {
      field: "label",
      type: "string",
      composerUi: "Network name",
      composerSource: "editable",
      notes: "Required. Human-readable network label.",
    },
    {
      field: "version",
      type: "string",
      composerUi: "Version",
      composerSource: "editable",
      notes: "Required. Network element version (Composer mirrors exchange.json asset version).",
    },
    {
      field: "description",
      type: "string?",
      composerUi: "Project tab (YAML info)",
      composerSource: "editable",
      notes: "Optional CommonMark description on the network info object (separate from exchange.json description).",
    },
    {
      field: "summary",
      type: "string?",
      composerUi: "Project tab (YAML info)",
      composerSource: "editable",
      notes: "Short summary per schema.",
    },
    {
      field: "tags",
      type: "string[]?",
      composerUi: "Project tab (YAML info)",
      composerSource: "editable",
      notes: "Network-level tags in yaml (exchange.json tags are edited separately on the Project tab).",
    },
  ],
};

export const AGENT_NETWORK_YAML_CONNECTION: ExchangeJsonNestedDoc = {
  title: "context.connections.{connectionName}.*",
  fields: [
    {
      field: "(key)",
      type: "string",
      composerUi: "Assets (Base name)",
      composerSource: "derived",
      notes: 'Connection map key. Pattern: identifier ending in letter/digit. Default "{baseName}Connection".',
    },
    {
      field: "kind",
      type: "a2a | mcp | llm",
      composerUi: "Assets (kind)",
      composerSource: "derived",
      notes: "agent → a2a, mcp → mcp, llm → llm.",
    },
    {
      field: "ref.name",
      type: "string",
      composerUi: "Assets (Base name)",
      composerSource: "derived",
      notes: "Registry reference name (identifier from base name).",
    },
    {
      field: "ref.namespace",
      type: "string?",
      composerUi: "Assets (GAV)",
      composerSource: "derived",
      notes: "Scopes the reference — asset.namespace or groupId.",
    },
    {
      field: "url",
      type: "string?",
      composerUi: "Assets (Default URL)",
      composerSource: "derived",
      notes: "Deploy-time URL. Composer emits ${group.url} referencing exchange.json metadata.variables.",
    },
    {
      field: "authentication",
      type: "object?",
      composerUi: "Assets (Authentication)",
      composerSource: "derived",
      notes:
        "a2a/mcp: full Authentication anyOf (apiKey, basic, oauth2, obo, in-task, …). llm: LLMAuthentication (apiKey only). Schema requires authentication on llm connections.",
    },
    {
      field: "authentication.kind",
      type: "string",
      composerUi: "Assets (Authentication)",
      composerSource: "derived",
      notes: 'apiKey | basic | apikey-client-credentials | oauth2-client-credentials | oauth2-obo | in-task-authorization-code (a2a/mcp). apiKey only for llm.',
    },
    {
      field: "authentication.apiKey",
      type: "string",
      composerUi: "Variables tab",
      composerSource: "derived",
      notes: "Token reference, e.g. ${group.apiKey}.",
    },
    {
      field: "authentication.headerName",
      type: "string?",
      composerUi: "Assets (Authentication)",
      composerSource: "editable",
      notes: "Optional header for apiKey/basic auth. Defaults to Authorization when omitted.",
    },
    {
      field: "access",
      type: "internal | shared?",
      composerUi: "Assets panel",
      composerSource: "editable",
      notes: "Access modifier per schema. Default internal (omitted from yaml).",
    },
    {
      field: "policies",
      type: "object?",
      composerUi: "Assets panel",
      composerSource: "editable",
      notes:
        "Connection inbound/outbound ref bindings. Declarations + configuration emit under context.policies when parameters are set.",
    },
    {
      field: "context.policies",
      type: "object?",
      composerUi: "Assets panel (policy configuration)",
      composerSource: "editable",
      notes: "Declared policy bindings: ref (Exchange GAV), required configuration, optional access.",
    },
  ],
};

export const AGENT_NETWORK_YAML_BROKER: ExchangeJsonNestedDoc = {
  title: "brokers.{brokerKey}.* (BrokerEntity)",
  fields: [
    {
      field: "(key)",
      type: "string",
      composerUi: "Broker name",
      composerSource: "derived",
      notes: "Broker map key derived from broker name (yaml-safe identifier).",
    },
    {
      field: "kind",
      type: "string",
      composerUi: "—",
      composerSource: "hardcoded",
      notes: 'Required. Must be "AgentScript".',
    },
    {
      field: "implementation",
      type: "string",
      composerUi: "—",
      composerSource: "derived",
      notes: 'Path to .agent file, e.g. "./brokers/my-broker.agent".',
    },
    {
      field: "interfaces.a2a.card",
      type: "object",
      composerUi: "A2A card tab",
      composerSource: "editable",
      notes: "A2A v1 agent card: name, description, version, capabilities, skills, defaultInput/OutputModes.",
    },
    {
      field: "interfaces.a2a.policies",
      type: "object?",
      composerUi: "Access tab",
      composerSource: "editable",
      notes: "Inbound/outbound policy bindings on the broker A2A interface (ref + inline). Uses same PolicyBindings shape as connections.",
    },
  ],
};

export const AGENT_NETWORK_YAML_COMPOSER_NOTES = [
  "Each composed Exchange asset produces one context.connections entry and one exchange.json dependencies[] entry — edit assets only on the Assets tab.",
  "Connection URLs and secrets are deploy variables in exchange.json; yaml uses ${group.field} placeholders.",
  "Composer emits context.connections, not registry — both satisfy the schema anyOf (registry | context | brokers).",
  "LLM connections require authentication in the official schema; set API key auth on LLM assets or validation may fail.",
  "agentNetwork: 2.0.0 is the spec version. info.version is the network element version. exchange.json apiVersion is the Exchange version group — three different version fields.",
  "Live schema validation runs on the current project whenever you edit; issues appear in the composer header and in this dialog.",
  "When agent-fabric-specification updates, run npm run sync:anf-schemas — manifest.json records commit + syncedAt so you can see if Composer is stale.",
];
