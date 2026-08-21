/**
 * Field-level completeness for the A2A card editor — required vs recommended
 * vs optional slots, current values, and schema error mapping.
 */

import type { BrokerCard } from "@/lib/composer/model";
import { serializeBrokerCard } from "@/lib/composer/a2a-card";
import { validateBrokerCardDeployRequirements } from "@/lib/composer/a2a-card-deploy-requirements";
import { validateBrokerCardDoc } from "@/lib/composer/schema/a2a-card-schema";
import { A2A_CARD_ANCHOR, type A2aCardFieldAnchor } from "@/lib/composer/a2a-card-field-anchors";

export type A2aCardFieldTier = "required" | "recommended" | "optional";

export type A2aCardFieldStatus = "set" | "missing" | "error";

export interface A2aCardCompletenessItem {
  id: string;
  anchor: A2aCardFieldAnchor;
  label: string;
  jsonPath: string;
  tier: A2aCardFieldTier;
  status: A2aCardFieldStatus;
  valuePreview: string | null;
  schemaMessage?: string;
}

export interface A2aCardCompletenessGroup {
  title: string;
  items: A2aCardCompletenessItem[];
}

export interface A2aCardCompletenessSummary {
  requiredSet: number;
  requiredTotal: number;
  recommendedSet: number;
  recommendedTotal: number;
  optionalSet: number;
  optionalTotal: number;
  schemaErrorCount: number;
}

export interface A2aCardCompleteness {
  groups: A2aCardCompletenessGroup[];
  summary: A2aCardCompletenessSummary;
}

const PREVIEW_MAX = 56;

function preview(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, PREVIEW_MAX - 1)}…`;
}

function previewList(values: string[] | undefined): string | null {
  if (!values?.length) return null;
  return preview(values.join(", "));
}

function schemaIssuesByPath(card: BrokerCard): Map<string, string> {
  const doc = serializeBrokerCard(card);
  const map = new Map<string, string>();
  for (const issue of validateBrokerCardDoc(doc)) {
    const key = issue.path === "(root)" ? "" : issue.path;
    if (!map.has(key)) map.set(key, issue.message);
  }
  for (const issue of validateBrokerCardDeployRequirements(card)) {
    if (!map.has(issue.path)) map.set(issue.path, issue.message);
  }
  return map;
}

function pathHasError(schemaByPath: Map<string, string>, jsonPath: string): string | undefined {
  if (schemaByPath.has(jsonPath)) return schemaByPath.get(jsonPath);
  const prefix = `${jsonPath}.`;
  for (const [path, message] of schemaByPath) {
    if (path.startsWith(prefix) || path === jsonPath) return message;
  }
  return undefined;
}

function itemStatus(
  hasValue: boolean,
  schemaMessage: string | undefined
): A2aCardFieldStatus {
  if (schemaMessage) return "error";
  return hasValue ? "set" : "missing";
}

function countTier(items: A2aCardCompletenessItem[], tier: A2aCardFieldTier) {
  const filtered = items.filter((i) => i.tier === tier);
  return {
    total: filtered.length,
    set: filtered.filter((i) => i.status === "set").length,
  };
}

/** Build grouped completeness rows for the A2A card editor side panel. */
export function buildA2aCardCompleteness(card: BrokerCard): A2aCardCompleteness {
  const schemaByPath = schemaIssuesByPath(card);
  const interfaces = card.supportedInterfaces ?? [];
  const primary = interfaces[0];
  const provider = card.provider ?? {};
  const skills = card.skills ?? [];
  const primarySkill = skills[0];
  const capabilities = card.capabilities ?? {};
  const endpointUrl = primary?.url?.trim() ?? "";

  const hasCapabilities =
    Boolean(capabilities.streaming) ||
    Boolean(capabilities.pushNotifications) ||
    Boolean(capabilities.extendedAgentCard);

  const capabilityPreview = hasCapabilities
    ? [
        capabilities.streaming ? "streaming" : null,
        capabilities.pushNotifications ? "pushNotifications" : null,
        capabilities.extendedAgentCard ? "extendedAgentCard" : null,
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  const groups: A2aCardCompletenessGroup[] = [
    {
      title: "Identity",
      items: [
        {
          id: "name",
          anchor: A2A_CARD_ANCHOR.name,
          label: "Agent name",
          jsonPath: "name",
          tier: "required",
          status: itemStatus(Boolean(card.name?.trim()), pathHasError(schemaByPath, "name")),
          valuePreview: preview(card.name),
          schemaMessage: pathHasError(schemaByPath, "name"),
        },
        {
          id: "version",
          anchor: A2A_CARD_ANCHOR.version,
          label: "Agent version",
          jsonPath: "version",
          tier: "required",
          status: itemStatus(Boolean(card.version?.trim()), pathHasError(schemaByPath, "version")),
          valuePreview: preview(card.version),
          schemaMessage: pathHasError(schemaByPath, "version"),
        },
        {
          id: "description",
          anchor: A2A_CARD_ANCHOR.description,
          label: "Description",
          jsonPath: "description",
          tier: "required",
          status: itemStatus(Boolean(card.description?.trim()), pathHasError(schemaByPath, "description")),
          valuePreview: preview(card.description),
          schemaMessage: pathHasError(schemaByPath, "description"),
        },
      ],
    },
    {
      title: "Endpoint",
      items: [
        {
          id: "endpoint-url",
          anchor: A2A_CARD_ANCHOR.endpointUrl,
          label: "A2A endpoint URL",
          jsonPath: "supportedInterfaces[0].url",
          tier: "required",
          status: itemStatus(endpointUrl.length > 0, pathHasError(schemaByPath, "supportedInterfaces")),
          valuePreview:
            endpointUrl.length > 0
              ? endpointUrl.startsWith("https://")
                ? preview(endpointUrl)
                : `${preview(endpointUrl) ?? endpointUrl} · use HTTPS in production`
              : null,
          schemaMessage: pathHasError(schemaByPath, "supportedInterfaces"),
        },
        {
          id: "protocol-binding",
          anchor: A2A_CARD_ANCHOR.protocolBinding,
          label: "Protocol binding",
          jsonPath: "supportedInterfaces[0].protocolBinding",
          tier: "recommended",
          status: itemStatus(Boolean(primary?.protocolBinding), undefined),
          valuePreview: preview(primary?.protocolBinding),
        },
        {
          id: "protocol-version",
          anchor: A2A_CARD_ANCHOR.protocolVersion,
          label: "Protocol version",
          jsonPath: "supportedInterfaces[0].protocolVersion",
          tier: "recommended",
          status: itemStatus(Boolean(primary?.protocolVersion?.trim()), undefined),
          valuePreview: preview(primary?.protocolVersion),
        },
        {
          id: "endpoint-tenant",
          anchor: A2A_CARD_ANCHOR.endpointTenant,
          label: "Endpoint tenant",
          jsonPath: "supportedInterfaces[0].tenant",
          tier: "optional",
          status: itemStatus(Boolean(primary?.tenant?.trim()), undefined),
          valuePreview: preview(primary?.tenant),
        },
      ],
    },
    {
      title: "Provider",
      items: [
        {
          id: "provider-org",
          anchor: A2A_CARD_ANCHOR.providerOrganization,
          label: "Provider organization",
          jsonPath: "provider.organization",
          tier: "recommended",
          status: itemStatus(Boolean(provider.organization?.trim()), pathHasError(schemaByPath, "provider")),
          valuePreview: preview(provider.organization),
          schemaMessage: pathHasError(schemaByPath, "provider"),
        },
        {
          id: "provider-url",
          anchor: A2A_CARD_ANCHOR.providerUrl,
          label: "Provider URL",
          jsonPath: "provider.url",
          tier: "recommended",
          status: itemStatus(Boolean(provider.url?.trim()), undefined),
          valuePreview: preview(provider.url),
        },
      ],
    },
    {
      title: "Defaults & discovery",
      items: [
        {
          id: "default-input-modes",
          anchor: A2A_CARD_ANCHOR.defaultInputModes,
          label: "Default input modes",
          jsonPath: "defaultInputModes",
          tier: "recommended",
          status: itemStatus((card.defaultInputModes?.length ?? 0) > 0, pathHasError(schemaByPath, "defaultInputModes")),
          valuePreview: previewList(card.defaultInputModes),
          schemaMessage: pathHasError(schemaByPath, "defaultInputModes"),
        },
        {
          id: "default-output-modes",
          anchor: A2A_CARD_ANCHOR.defaultOutputModes,
          label: "Default output modes",
          jsonPath: "defaultOutputModes",
          tier: "recommended",
          status: itemStatus((card.defaultOutputModes?.length ?? 0) > 0, pathHasError(schemaByPath, "defaultOutputModes")),
          valuePreview: previewList(card.defaultOutputModes),
          schemaMessage: pathHasError(schemaByPath, "defaultOutputModes"),
        },
        {
          id: "documentation-url",
          anchor: A2A_CARD_ANCHOR.documentationUrl,
          label: "Documentation URL",
          jsonPath: "documentationUrl",
          tier: "optional",
          status: itemStatus(Boolean(card.documentationUrl?.trim()), pathHasError(schemaByPath, "documentationUrl")),
          valuePreview: preview(card.documentationUrl),
          schemaMessage: pathHasError(schemaByPath, "documentationUrl"),
        },
        {
          id: "icon-url",
          anchor: A2A_CARD_ANCHOR.iconUrl,
          label: "Icon URL",
          jsonPath: "iconUrl",
          tier: "optional",
          status: itemStatus(Boolean(card.iconUrl?.trim()), pathHasError(schemaByPath, "iconUrl")),
          valuePreview: preview(card.iconUrl),
          schemaMessage: pathHasError(schemaByPath, "iconUrl"),
        },
        {
          id: "capabilities",
          anchor: A2A_CARD_ANCHOR.capabilities,
          label: "Capabilities",
          jsonPath: "capabilities",
          tier: "optional",
          status: itemStatus(hasCapabilities, pathHasError(schemaByPath, "capabilities")),
          valuePreview: capabilityPreview,
          schemaMessage: pathHasError(schemaByPath, "capabilities"),
        },
      ],
    },
    {
      title: "Skills",
      items: [
        {
          id: "primary-skill",
          anchor: A2A_CARD_ANCHOR.primarySkill,
          label: "Primary skill name",
          jsonPath: "skills[0].name",
          tier: "recommended",
          status: itemStatus(Boolean(primarySkill?.name?.trim()), pathHasError(schemaByPath, "skills")),
          valuePreview: preview(primarySkill?.name),
          schemaMessage: pathHasError(schemaByPath, "skills"),
        },
        {
          id: "skill-tags",
          anchor: A2A_CARD_ANCHOR.skillTags,
          label: "Primary skill tags",
          jsonPath: "skills[0].tags",
          tier: "recommended",
          status: itemStatus((primarySkill?.tags?.length ?? 0) > 0, undefined),
          valuePreview: previewList(primarySkill?.tags),
        },
        {
          id: "skill-description",
          anchor: A2A_CARD_ANCHOR.skillDescription,
          label: "Primary skill description",
          jsonPath: "skills[0].description",
          tier: "optional",
          status: itemStatus(Boolean(primarySkill?.description?.trim()), undefined),
          valuePreview: preview(primarySkill?.description),
        },
        {
          id: "extra-skills",
          anchor: A2A_CARD_ANCHOR.additionalSkills,
          label: "Additional skills",
          jsonPath: "skills",
          tier: "optional",
          status: itemStatus(skills.length > 1, undefined),
          valuePreview: skills.length > 1 ? `${skills.length - 1} extra skill${skills.length === 2 ? "" : "s"}` : null,
        },
      ],
    },
  ];

  if (interfaces.length > 1) {
    groups[1].items.push({
      id: "extra-interfaces",
      anchor: A2A_CARD_ANCHOR.additionalEndpoints,
      label: "Additional endpoints",
      jsonPath: "supportedInterfaces",
      tier: "optional",
      status: "set",
      valuePreview: `${interfaces.length - 1} extra endpoint${interfaces.length === 2 ? "" : "s"}`,
    });
  }

  const flat = groups.flatMap((g) => g.items);
  const required = countTier(flat, "required");
  const recommended = countTier(flat, "recommended");
  const optional = countTier(flat, "optional");

  return {
    groups,
    summary: {
      requiredSet: required.set,
      requiredTotal: required.total,
      recommendedSet: recommended.set,
      recommendedTotal: recommended.total,
      optionalSet: optional.set,
      optionalTotal: optional.total,
      schemaErrorCount: schemaByPath.size,
    },
  };
}
