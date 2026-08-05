/** DOM ids for A2A card editor fields — used for completeness panel click-to-focus. */
export const A2A_CARD_ANCHOR = {
  brokerKey: "a2a-card-broker-key",
  name: "a2a-card-name",
  version: "a2a-card-version",
  description: "a2a-card-description",
  endpointUrl: "a2a-card-endpoint-url",
  protocolBinding: "a2a-card-protocol-binding",
  protocolVersion: "a2a-card-protocol-version",
  endpointTenant: "a2a-card-endpoint-tenant",
  moreSettings: "a2a-card-more-settings",
  providerOrganization: "a2a-card-provider-organization",
  providerUrl: "a2a-card-provider-url",
  documentationUrl: "a2a-card-documentation-url",
  iconUrl: "a2a-card-icon-url",
  defaultInputModes: "a2a-card-default-input-modes",
  defaultOutputModes: "a2a-card-default-output-modes",
  capabilities: "a2a-card-capabilities",
  primarySkill: "a2a-card-primary-skill",
  skillTags: "a2a-card-skill-tags",
  skillDescription: "a2a-card-skill-description",
  additionalEndpoints: "a2a-card-additional-endpoints",
  additionalSkills: "a2a-card-additional-skills",
} as const;

export type A2aCardFieldAnchor = (typeof A2A_CARD_ANCHOR)[keyof typeof A2A_CARD_ANCHOR];
