/**
 * Parse / serialize brokers.*.interfaces.a2a.card against a2a_v1 Agent Card.
 * Typed fields are edited in Composer; `extra` preserves any other schema fields
 * (securitySchemes, supportedInterfaces, …) across import → model → yaml round-trips.
 */

import type {
  BrokerCard,
  BrokerCardCapabilities,
  BrokerCardExtension,
  BrokerCardSecurityRequirement,
  BrokerCardSignature,
  BrokerCardSkill,
  BrokerCardSupportedInterface,
} from "@/lib/composer/model";
import type { DerivedA2aCardSecurity } from "@/lib/composer/a2a-card-security-from-policies";

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
  return normalizeStringArray(value);
}

/** Normalize A2A string[] fields (tags, examples, inputModes, …). */
export function normalizeStringArray(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : undefined;
  }
  if (!Array.isArray(value)) return undefined;
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed) items.push(trimmed);
    } else if (Array.isArray(entry)) {
      for (const nested of entry) {
        if (typeof nested === "string") {
          const trimmed = nested.trim();
          if (trimmed) items.push(trimmed);
        }
      }
    }
  }
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
  "security",
  "securityRequirements",
  "security_requirements",
  "securitySchemes",
  "security_schemes",
  "signatures",
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
  "securityRequirements",
  "security_requirements",
]);

const OWNED_CAPABILITY_KEYS = new Set([
  "streaming",
  "pushNotifications",
  "push_notifications",
  "extendedAgentCard",
  "extended_agent_card",
  "extensions",
]);

function parseSecurityRequirements(value: unknown): BrokerCardSecurityRequirement[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: BrokerCardSecurityRequirement[] = [];
  for (const entry of value) {
    const obj = asRecord(entry);
    if (!obj) continue;
    const req: BrokerCardSecurityRequirement = {};
    for (const [key, scopes] of Object.entries(obj)) {
      const scopeList = stringArray(scopes);
      if (scopeList) req[key] = scopeList;
      else if (Array.isArray(scopes) && scopes.length === 0) req[key] = [];
    }
    if (Object.keys(req).length > 0) items.push(req);
  }
  return items.length > 0 ? items : undefined;
}

function parseExtensions(value: unknown): BrokerCardExtension[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: BrokerCardExtension[] = [];
  for (const entry of value) {
    const obj = asRecord(entry);
    const uri = asString(obj?.uri);
    if (!uri) continue;
    items.push({
      uri,
      ...(asString(obj?.description) ? { description: asString(obj?.description) } : {}),
      ...(asBoolean(obj?.required) !== undefined ? { required: asBoolean(obj?.required) } : {}),
      ...(asRecord(obj?.params) ? { params: asRecord(obj?.params) } : {}),
    });
  }
  return items.length > 0 ? items : undefined;
}

function parseSignatures(value: unknown): BrokerCardSignature[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: BrokerCardSignature[] = [];
  for (const entry of value) {
    const obj = asRecord(entry);
    const protectedVal = asString(obj?.protected);
    const signature = asString(obj?.signature);
    if (!protectedVal || !signature) continue;
    items.push({
      protected: protectedVal,
      signature,
      ...(asString(obj?.header) ? { header: asString(obj?.header) } : {}),
    });
  }
  return items.length > 0 ? items : undefined;
}

function parseSecuritySchemes(value: unknown): Record<string, unknown> | undefined {
  const obj = asRecord(value);
  return obj && Object.keys(obj).length > 0 ? obj : undefined;
}

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
  const securityRequirements =
    parseSecurityRequirements(skillObj.securityRequirements) ??
    parseSecurityRequirements(skillObj.security_requirements);
  const extra = parseSkillExtra(skillObj);
  return {
    id: asString(skillObj.id) ?? asString(skillObj.name) ?? "skill",
    name: asString(skillObj.name) ?? "Skill",
    ...(asString(skillObj.description) ? { description: asString(skillObj.description) } : {}),
    ...(tags ? { tags } : {}),
    ...(examples ? { examples } : {}),
    ...(inputModes ? { inputModes } : {}),
    ...(outputModes ? { outputModes } : {}),
    ...(securityRequirements ? { securityRequirements } : {}),
    ...(extra ? { extra } : {}),
  };
}

function parseCapabilities(capsObj: Record<string, unknown>): BrokerCardCapabilities | undefined {
  const streaming = asBoolean(capsObj.streaming);
  const pushNotifications =
    asBoolean(capsObj.pushNotifications) ?? asBoolean(capsObj.push_notifications);
  const extendedAgentCard =
    asBoolean(capsObj.extendedAgentCard) ?? asBoolean(capsObj.extended_agent_card);
  const extensions = parseExtensions(capsObj.extensions);

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(capsObj)) {
    if (!OWNED_CAPABILITY_KEYS.has(key)) extra[key] = value;
  }

  const capabilities: BrokerCardCapabilities = {
    ...(streaming !== undefined ? { streaming } : {}),
    ...(pushNotifications !== undefined ? { pushNotifications } : {}),
    ...(extendedAgentCard !== undefined ? { extendedAgentCard } : {}),
    ...(extensions ? { extensions } : {}),
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

  const security =
    parseSecurityRequirements(cardObj.securityRequirements) ??
    parseSecurityRequirements(cardObj.security_requirements) ??
    parseSecurityRequirements(cardObj.security);
  if (security) card.securityRequirements = security;

  const securitySchemes =
    parseSecuritySchemes(cardObj.securitySchemes) ?? parseSecuritySchemes(cardObj.security_schemes);
  if (securitySchemes) card.securitySchemes = securitySchemes;

  const signatures = parseSignatures(cardObj.signatures);
  if (signatures) card.signatures = signatures;

  const extra = parseCardExtra(cardObj);
  if (extra) card.extra = extra;

  return card;
}

function serializeCapabilities(caps: BrokerCardCapabilities): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = { ...(caps.extra ?? {}) };
  if (caps.streaming !== undefined) out.streaming = caps.streaming;
  if (caps.pushNotifications !== undefined) out.pushNotifications = caps.pushNotifications;
  if (caps.extendedAgentCard !== undefined) out.extendedAgentCard = caps.extendedAgentCard;
  if (caps.extensions && caps.extensions.length > 0) {
    out.extensions = caps.extensions.map((ext) => ({
      uri: ext.uri,
      ...(ext.description ? { description: ext.description } : {}),
      ...(ext.required !== undefined ? { required: ext.required } : {}),
      ...(ext.params ? { params: ext.params } : {}),
    }));
  }
  return omitEmptyRecord(out);
}

function serializeSkill(
  skill: BrokerCardSkill,
  derivedSecurity?: DerivedA2aCardSecurity | null
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(skill.extra ?? {}), id: skill.id, name: skill.name };
  const fallbackDescription = skill.name?.trim() || skill.id?.trim() || "Skill";
  out.description = skill.description?.trim() || fallbackDescription;
  if (skill.tags && skill.tags.length > 0) out.tags = skill.tags;
  const examples = skill.examples?.map((s) => s.trim()).filter(Boolean);
  if (examples && examples.length > 0) out.examples = examples;
  if (skill.inputModes && skill.inputModes.length > 0) out.inputModes = skill.inputModes;
  if (skill.outputModes && skill.outputModes.length > 0) out.outputModes = skill.outputModes;
  if (derivedSecurity !== undefined) {
    if (derivedSecurity?.securityRequirements?.length) {
      out.securityRequirements = derivedSecurity.securityRequirements;
    }
  } else if (skill.securityRequirements && skill.securityRequirements.length > 0) {
    out.securityRequirements = skill.securityRequirements;
  }
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
export function serializeBrokerCard(
  card: BrokerCard,
  derivedSecurity?: DerivedA2aCardSecurity | null
): Record<string, unknown> {
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
    typed.skills = card.skills.map((skill) => serializeSkill(skill, derivedSecurity));
  }
  if (card.supportedInterfaces && card.supportedInterfaces.length > 0) {
    typed.supportedInterfaces = card.supportedInterfaces.map(serializeSupportedInterface);
  }
  if (derivedSecurity !== undefined) {
    if (derivedSecurity?.securityRequirements?.length) {
      typed.securityRequirements = derivedSecurity.securityRequirements;
    }
    if (derivedSecurity?.securitySchemes && Object.keys(derivedSecurity.securitySchemes).length > 0) {
      typed.securitySchemes = derivedSecurity.securitySchemes;
    }
  } else {
    if (card.securityRequirements && card.securityRequirements.length > 0) {
      typed.securityRequirements = card.securityRequirements;
    }
    if (card.securitySchemes && Object.keys(card.securitySchemes).length > 0) {
      typed.securitySchemes = card.securitySchemes;
    }
  }
  if (card.signatures && card.signatures.length > 0) typed.signatures = card.signatures;

  return { ...(card.extra ?? {}), ...typed };
}
