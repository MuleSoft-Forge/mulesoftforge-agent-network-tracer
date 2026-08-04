import type { CompletenessResult } from "@/lib/composer/completeness-types";
import type { A2aCardCompleteness } from "@/lib/composer/a2a-card-completeness";
import type { A2aCardFieldAnchor } from "@/lib/composer/a2a-card-field-anchors";

const A2A_FIELD_DOCS: Record<string, { why: string; mapsTo: string }> = {
  name: {
    why: "Human-readable agent name clients see when discovering this broker.",
    mapsTo: "card.name",
  },
  version: {
    why: "Semver for the agent card — tracks contract evolution independently of the network asset version.",
    mapsTo: "card.version",
  },
  description: {
    why: "Explains what this agent does — helps humans and routers choose the right skill.",
    mapsTo: "card.description",
  },
  "endpoint-url": {
    why: "Where A2A clients invoke this broker — the public HTTPS entry point.",
    mapsTo: "card.supportedInterfaces[0].url",
  },
  "protocol-binding": {
    why: "Transport binding at the endpoint (HTTP+JSON, JSONRPC, or GRPC).",
    mapsTo: "card.supportedInterfaces[0].protocolBinding",
  },
  "protocol-version": {
    why: "A2A protocol version exposed at this interface (e.g. 1.0).",
    mapsTo: "card.supportedInterfaces[0].protocolVersion",
  },
  "endpoint-tenant": {
    why: "Optional tenant id sent on requests to multi-tenant broker deployments.",
    mapsTo: "card.supportedInterfaces[0].tenant",
  },
  "provider-org": {
    why: "Organization publishing or operating this agent.",
    mapsTo: "card.provider.organization",
  },
  "provider-url": {
    why: "Homepage or support URL for the provider.",
    mapsTo: "card.provider.url",
  },
  "default-input-modes": {
    why: "Default MIME types the agent accepts (e.g. text/plain).",
    mapsTo: "card.defaultInputModes",
  },
  "default-output-modes": {
    why: "Default MIME types the agent returns.",
    mapsTo: "card.defaultOutputModes",
  },
  "documentation-url": {
    why: "Extended documentation for integrators.",
    mapsTo: "card.documentationUrl",
  },
  "icon-url": {
    why: "Icon shown in agent directories and UIs.",
    mapsTo: "card.iconUrl",
  },
  capabilities: {
    why: "Declared protocol features (streaming, push notifications) the server actually supports.",
    mapsTo: "card.capabilities",
  },
  "primary-skill": {
    why: "Main advertised capability — how clients know what to ask for.",
    mapsTo: "card.skills[0].name",
  },
  "skill-tags": {
    why: "Keywords for discovery and routing to this skill.",
    mapsTo: "card.skills[0].tags",
  },
  "skill-description": {
    why: "Detailed description of the primary skill.",
    mapsTo: "card.skills[0].description",
  },
  "extra-skills": {
    why: "Additional skills beyond the primary entry.",
    mapsTo: "card.skills[]",
  },
  "extra-interfaces": {
    why: "Alternate endpoints exposing the same agent capabilities.",
    mapsTo: "card.supportedInterfaces[]",
  },
};

/** Adapt legacy A2A completeness rows for the shared CompletenessPanel UI. */
export function adaptA2aCardCompleteness(
  completeness: A2aCardCompleteness
): CompletenessResult<A2aCardFieldAnchor> {
  return {
    groups: completeness.groups.map((group) => ({
      title: group.title,
      items: group.items.map((item) => {
        const docs = A2A_FIELD_DOCS[item.id] ?? {
          why: "Agent card field validated against a2a_v1.json.",
          mapsTo: item.jsonPath,
        };
        return {
          id: item.id,
          label: item.label,
          mapsTo: docs.mapsTo,
          why: docs.why,
          tier: item.tier,
          status: item.status,
          valuePreview: item.valuePreview,
          schemaMessage: item.schemaMessage,
          focus: item.anchor,
        };
      }),
    })),
    summary: completeness.summary,
  };
}
