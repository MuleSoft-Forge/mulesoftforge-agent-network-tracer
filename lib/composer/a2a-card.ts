/**
 * Parse / serialize brokers.*.interfaces.a2a.card against a2a_v1 Agent Card.
 * Typed fields are edited in Composer; `extra` preserves any other schema fields
 * (securitySchemes, supportedInterfaces, …) across import → model → yaml round-trips.
 */

import type { BrokerCard, BrokerCardCapabilities, BrokerCardSkill, BrokerCardSupportedInterface } from "@/lib/composer/model";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((m): m is string => typeof m === "string");
  return items.length > 0 ? items : undefined;
}

function omitEmptyRecord(obj: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(obj).length > 0 ? obj : undefined;
}

const OWNED_CARD_KEYS = new Set([
  "name",
  "description",
  "version",
  "documentationUrl",
  "documentation_url",
  "iconUrl",
  "icon_url",
  "provider",
  "capabilities",
  "defaultInputModes",
  "default_input_modes",
  "defaultOutputModes",
  "default_output_modes",
  "skills",
  "supportedInterfaces",
  "supported_interfaces",
]);

const OWNED_SKILL_KEYS = new Set([
  "id",
  "name",
  "description",
  "tags",
  "examples",
  "inputModes",
  "input_modes",
  "outputModes",
  "output_modes",
]);

const OWNED_CAPABILITY_KEYS = new Set([
  "streaming",
  "pushNotifications",
  "push_notifications",
  "extendedAgentCard",
  "extended_agent_card",
]);

function parseSkillExtra(skillObj: Record<string, unknown>): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(skillObj)) {
    if (!OWNED_SKILL_KEYS.has(key)) extra[key] = value;
  }
  return omitEmptyRecord(extra);
}

function parseSkill(skillObj: Record<string, unknown>): BrokerCardSkill {
  const tags = stringArray(skillObj.tags);
  const examples = stringArray(skillObj.examples);
  const inputModes = stringArray(skillObj.inputModes) ?? stringArray(skillObj.input_modes);
  const outputModes = stringArray(skillObj.outputModes) ?? stringArray(skillObj.output_modes);
  const extra = parseSkillExtra(skillObj);
  return {
    id: asString(skillObj.id) ?? asString(skillObj.name) ?? "skill",
    name: asString(skillObj.name) ?? "Skill",
    ...(asString(skillObj.description) ? { description: asString(skillObj.description) } : {}),
    ...(tags ? { tags } : {}),
    ...(examples ? { examples } : {}),
    ...(inputModes ? { inputModes } : {}),
    ...(outputModes ? { outputModes } : {}),
    ...(extra ? { extra } : {}),
  };
}

function parseCapabilities(capsObj: Record<string, unknown>): BrokerCardCapabilities | undefined {
  const streaming = asBoolean(capsObj.streaming);
  const pushNotifications =
    asBoolean(capsObj.pushNotifications) ?? asBoolean(capsObj.push_notifications);
  const extendedAgentCard =
    asBoolean(capsObj.extendedAgentCard) ?? asBoolean(capsObj.extended_agent_card);

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(capsObj)) {
    if (!OWNED_CAPABILITY_KEYS.has(key)) extra[key] = value;
  }

  const capabilities: BrokerCardCapabilities = {
    ...(streaming !== undefined ? { streaming } : {}),
    ...(pushNotifications !== undefined ? { pushNotifications } : {}),
    ...(extendedAgentCard !== undefined ? { extendedAgentCard } : {}),
    ...(omitEmptyRecord(extra) ? { extra: omitEmptyRecord(extra) } : {}),
  };

  return Object.keys(capabilities).length > 0 ? capabilities : undefined;
}

function parseCardExtra(cardObj: Record<string, unknown>): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cardObj)) {
    if (!OWNED_CARD_KEYS.has(key)) extra[key] = value;
  }
  return omitEmptyRecord(extra);
}

function parseSupportedInterface(obj: Record<string, unknown>): BrokerCardSupportedInterface | null {
  const url = asString(obj.url);
  const protocolVersion =
    asString(obj.protocolVersion) ?? asString(obj.protocol_version);
  const protocolBinding =
    asString(obj.protocolBinding) ?? asString(obj.protocol_binding);
  if (!url || !protocolVersion || !protocolBinding) return null;
  const tenant = asString(obj.tenant);
  return {
    url,
    protocolVersion,
    protocolBinding,
    ...(tenant ? { tenant } : {}),
  };
}

function parseSupportedInterfaces(value: unknown): BrokerCardSupportedInterface[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map(parseSupportedInterface)
    .filter((item): item is BrokerCardSupportedInterface => item !== null);
  return items.length > 0 ? items : undefined;
}

/** Parse an Agent Card object from agent-network.yaml into the Composer model. */
export function parseBrokerCard(cardObj: Record<string, unknown>): BrokerCard {
  const caps = asRecord(cardObj.capabilities);
  const providerObj = asRecord(cardObj.provider);
  const skillsRaw = Array.isArray(cardObj.skills) ? cardObj.skills : [];

  const card: BrokerCard = {
    name: asString(cardObj.name) ?? "Broker",
    version: asString(cardObj.version) ?? "1.0.0",
  };

  const desc = asString(cardObj.description);
  if (desc) card.description = desc;

  const documentationUrl = asString(cardObj.documentationUrl) ?? asString(cardObj.documentation_url);
  if (documentationUrl) card.documentationUrl = documentationUrl;

  const iconUrl = asString(cardObj.iconUrl) ?? asString(cardObj.icon_url);
  if (iconUrl) card.iconUrl = iconUrl;

  if (providerObj) {
    const organization = asString(providerObj.organization);
    const url = asString(providerObj.url);
    if (organization || url) {
      card.provider = {
        ...(organization ? { organization } : {}),
        ...(url ? { url } : {}),
      };
    }
  }

  if (caps) {
    const capabilities = parseCapabilities(caps);
    if (capabilities) card.capabilities = capabilities;
  }

  const defaultInputModes =
    stringArray(cardObj.defaultInputModes) ?? stringArray(cardObj.default_input_modes);
  if (defaultInputModes) card.defaultInputModes = defaultInputModes;

  const defaultOutputModes =
    stringArray(cardObj.defaultOutputModes) ?? stringArray(cardObj.default_output_modes);
  if (defaultOutputModes) card.defaultOutputModes = defaultOutputModes;

  if (skillsRaw.length > 0) {
    card.skills = skillsRaw
      .map((s) => asRecord(s))
      .filter((s): s is Record<string, unknown> => Boolean(s))
      .map(parseSkill);
  }

  const supportedInterfaces =
    parseSupportedInterfaces(cardObj.supportedInterfaces) ??
    parseSupportedInterfaces(cardObj.supported_interfaces);
  if (supportedInterfaces) card.supportedInterfaces = supportedInterfaces;

  const extra = parseCardExtra(cardObj);
  if (extra) card.extra = extra;

  return card;
}

function serializeCapabilities(caps: BrokerCardCapabilities): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = { ...(caps.extra ?? {}) };
  if (caps.streaming !== undefined) out.streaming = caps.streaming;
  if (caps.pushNotifications !== undefined) out.pushNotifications = caps.pushNotifications;
  if (caps.extendedAgentCard !== undefined) out.extendedAgentCard = caps.extendedAgentCard;
  return omitEmptyRecord(out);
}

function serializeSkill(skill: BrokerCardSkill): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(skill.extra ?? {}), id: skill.id, name: skill.name };
  if (skill.description) out.description = skill.description;
  if (skill.tags && skill.tags.length > 0) out.tags = skill.tags;
  if (skill.examples && skill.examples.length > 0) out.examples = skill.examples;
  if (skill.inputModes && skill.inputModes.length > 0) out.inputModes = skill.inputModes;
  if (skill.outputModes && skill.outputModes.length > 0) out.outputModes = skill.outputModes;
  return out;
}

function serializeSupportedInterface(item: BrokerCardSupportedInterface): Record<string, unknown> {
  return {
    url: item.url,
    protocolVersion: item.protocolVersion,
    protocolBinding: item.protocolBinding,
    ...(item.tenant ? { tenant: item.tenant } : {}),
  };
}

/** Serialize the Composer broker card to an Agent Card object for agent-network.yaml. */
export function serializeBrokerCard(card: BrokerCard): Record<string, unknown> {
  const typed: Record<string, unknown> = {
    name: card.name,
    version: card.version,
  };
  if (card.description) typed.description = card.description;
  if (card.documentationUrl) typed.documentationUrl = card.documentationUrl;
  if (card.iconUrl) typed.iconUrl = card.iconUrl;
  if (card.provider && (card.provider.organization || card.provider.url)) {
    typed.provider = {
      ...(card.provider.organization ? { organization: card.provider.organization } : {}),
      ...(card.provider.url ? { url: card.provider.url } : {}),
    };
  }
  if (card.capabilities) {
    const capabilities = serializeCapabilities(card.capabilities);
    if (capabilities) typed.capabilities = capabilities;
  }
  if (card.defaultInputModes && card.defaultInputModes.length > 0) {
    typed.defaultInputModes = card.defaultInputModes;
  }
  if (card.defaultOutputModes && card.defaultOutputModes.length > 0) {
    typed.defaultOutputModes = card.defaultOutputModes;
  }
  if (card.skills && card.skills.length > 0) {
    typed.skills = card.skills.map(serializeSkill);
  }
  if (card.supportedInterfaces && card.supportedInterfaces.length > 0) {
    typed.supportedInterfaces = card.supportedInterfaces.map(serializeSupportedInterface);
  }

  return { ...(card.extra ?? {}), ...typed };
}
