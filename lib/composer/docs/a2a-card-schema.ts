/**
 * Reference content for the broker A2A card — validated against
 * a2a_v1.json#/definitions/Agent Card in lib/composer/schema/anf/
 */

import { formatAnfSchemaProvenance } from "@/lib/composer/schema/anf/index";
import type { ExchangeJsonFieldDoc, ExchangeJsonNestedDoc } from "@/lib/composer/docs/exchange-json-schema";

export const A2A_CARD_INTRO =
  "The broker A2A card is the network's public front door. It lives at brokers.{brokerKey}.interfaces.a2a.card in agent-network.yaml and must conform to the A2A v1 Agent Card definition in a2a_v1.json (referenced from agent_network_v2.json). Builder validates the emitted card with Ajv and preserves schema fields not yet exposed in the UI under card.extra / capabilities.extra / skill.extra.";

export const A2A_CARD_SOURCES = [
  formatAnfSchemaProvenance(),
  "Schema: lib/composer/schema/anf/a2a_v1.json → definitions.Agent Card",
  "Referenced from: agent_network_v2.json → BrokerEntity.interfaces.a2a.card",
  "Human reference: A2A protocol v1 agent card (proto-derived JSON Schema bundle)",
];

export const A2A_CARD_TOP_LEVEL: ExchangeJsonFieldDoc[] = [
  {
    field: "name",
    type: "string",
    composerUi: "A2A card tab · Card name",
    composerSource: "editable",
    notes: "Human-readable agent name on the card.",
  },
  {
    field: "description",
    type: "string?",
    composerUi: "A2A card tab · Card description",
    composerSource: "editable",
    notes: "Purpose of the broker agent for clients and other agents. Required at deploy by Agent Graph runtime (Pydantic A2ACard) even though a2a_v1 JSON Schema marks it optional.",
  },
  {
    field: "version",
    type: "string",
    composerUi: "A2A card tab · Card version",
    composerSource: "editable",
    notes: 'Semver-style card version (e.g. "1.0.0").',
  },
  {
    field: "documentationUrl",
    type: "string?",
    composerUi: "A2A card tab · Documentation URL",
    composerSource: "editable",
    notes: "HTTPS URL to extended documentation.",
  },
  {
    field: "iconUrl",
    type: "string?",
    composerUi: "A2A card tab · Icon URL",
    composerSource: "editable",
    notes: "Optional icon URL for UIs listing this agent.",
  },
  {
    field: "provider",
    type: "object?",
    composerUi: "A2A card tab · Provider",
    composerSource: "editable",
    notes: "organization + url — who publishes/operates the agent.",
  },
  {
    field: "capabilities",
    type: "object?",
    composerUi: "A2A card tab · Capabilities",
    composerSource: "editable",
    notes: "streaming, pushNotifications, extendedAgentCard; extensions preserved in capabilities.extra.",
  },
  {
    field: "defaultInputModes",
    type: "string[]?",
    composerUi: "A2A card tab · Default input modes",
    composerSource: "editable",
    notes: "Media types (e.g. text/plain). Overridable per skill.",
  },
  {
    field: "defaultOutputModes",
    type: "string[]?",
    composerUi: "A2A card tab · Default output modes",
    composerSource: "editable",
    notes: "Output media types supported by the agent.",
  },
  {
    field: "skills",
    type: "Agent Skill[]?",
    composerUi: "A2A card tab · Skills",
    composerSource: "editable",
    notes: "Named capabilities the agent advertises to clients.",
  },
  {
    field: "supportedInterfaces",
    type: "Agent Interface[]?",
    composerUi: "A2A card tab · Supported interfaces",
    composerSource: "editable",
    notes: "Ordered list of invocation endpoints. First entry is preferred. Fields: url, protocolBinding (JSONRPC | GRPC | HTTP+JSON), protocolVersion, optional tenant.",
  },
  {
    field: "securitySchemes",
    type: "object?",
    composerUi: "—",
    composerSource: "not-in-composer",
    notes: "OpenAPI-style security scheme map (apiKey, http, oauth2, oidc, mTLS). Preserved in card.extra.",
  },
  {
    field: "securityRequirements",
    type: "Security Requirement[]?",
    composerUi: "—",
    composerSource: "not-in-composer",
    notes: "Which schemes/scopes callers need. Preserved in card.extra.",
  },
  {
    field: "signatures",
    type: "Agent Card Signature[]?",
    composerUi: "—",
    composerSource: "not-in-composer",
    notes: "JWS signatures of the card. Preserved in card.extra.",
  },
];

export const A2A_CARD_CAPABILITIES: ExchangeJsonNestedDoc = {
  title: "capabilities.* (Agent Capabilities)",
  fields: [
    {
      field: "streaming",
      type: "boolean?",
      composerUi: "A2A card tab",
      composerSource: "editable",
      notes: "Agent supports streaming responses.",
    },
    {
      field: "pushNotifications",
      type: "boolean?",
      composerUi: "A2A card tab",
      composerSource: "editable",
      notes: "Agent supports async push notification updates.",
    },
    {
      field: "extendedAgentCard",
      type: "boolean?",
      composerUi: "A2A card tab",
      composerSource: "editable",
      notes: "Authenticated clients may fetch an extended card.",
    },
    {
      field: "extensions",
      type: "Agent Extension[]?",
      composerUi: "—",
      composerSource: "not-in-composer",
      notes: "uri, description, required, params. Preserved in capabilities.extra.",
    },
  ],
};

export const A2A_CARD_SKILL: ExchangeJsonNestedDoc = {
  title: "skills[] (Agent Skill)",
  fields: [
    {
      field: "id",
      type: "string",
      composerUi: "A2A card tab · Skill id",
      composerSource: "editable",
      notes: "Unique skill identifier.",
    },
    {
      field: "name",
      type: "string",
      composerUi: "A2A card tab · Skill name",
      composerSource: "editable",
      notes: "Human-readable skill label.",
    },
    {
      field: "description",
      type: "string?",
      composerUi: "A2A card tab",
      composerSource: "editable",
      notes: "What this skill does.",
    },
    {
      field: "inputModes",
      type: "string[]?",
      composerUi: "A2A card tab · Skill input modes",
      composerSource: "editable",
      notes: "Overrides card defaultInputModes for this skill.",
    },
    {
      field: "outputModes",
      type: "string[]?",
      composerUi: "A2A card tab · Skill output modes",
      composerSource: "editable",
      notes: "Overrides card defaultOutputModes for this skill.",
    },
    {
      field: "tags",
      type: "string[]?",
      composerUi: "A2A card tab",
      composerSource: "editable",
      notes: "Keywords for discovery/routing.",
    },
    {
      field: "examples",
      type: "string[]?",
      composerUi: "A2A card tab · Examples list (add/remove rows)",
      composerSource: "editable",
      notes: "Example prompts for this skill — one string per array element.",
    },
    {
      field: "securityRequirements",
      type: "Security Requirement[]?",
      composerUi: "—",
      composerSource: "not-in-composer",
      notes: "Per-skill auth requirements. Preserved in skill.extra.",
    },
  ],
};

export const A2A_CARD_COMPOSER_NOTES = [
  "Builder serializes camelCase fields only (a2a_v1 snake_case aliases are normalized on import).",
  "Fields not in the A2A card tab UI are stored in card.extra, capabilities.extra, or skill.extra and round-trip through yaml unchanged.",
  "Live validation runs on serializeBrokerCard(broker.card) against a2a_v1.json#/definitions/Agent Card.",
  "The full a2a_v1.json bundle also defines protocol messages (tasks, artifacts, …) — only Agent Card applies to the yaml card block.",
  "agent_network_v2.json validates the whole yaml document including the card ref; this dialog validates the card in isolation for faster feedback while editing the A2A card tab.",
  "Refresh bundled schemas with npm run sync:anf-schemas when agent-fabric-specification updates.",
];
