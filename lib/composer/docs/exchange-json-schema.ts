/**
 * Reference content for exchange.json — the Exchange project descriptor for
 * agent-network v2 projects. There is no standalone JSON Schema file like
 * agent_network_v2.json; this documents the shape from ACB ExchangeDescriptor,
 * v2 templates, and real fixtures.
 */

export type ComposerFieldSource =
  | "editable"
  | "model-default"
  | "derived"
  | "derived-from-interface-policies"
  | "hardcoded"
  | "not-in-composer";

export interface ExchangeJsonFieldDoc {
  field: string;
  type: string;
  composerUi: string;
  composerSource: ComposerFieldSource;
  notes: string;
}

export interface ExchangeJsonNestedDoc {
  title: string;
  fields: ExchangeJsonFieldDoc[];
}

export const EXCHANGE_JSON_INTRO =
  "exchange.json is the MuleSoft Exchange project descriptor for this agent network. It defines project identity, the Exchange version group used at publish/deploy, composed dependencies, and deploy-time variables. It is not the same file as agent-network.yaml (network spec) or brokers/*.agent (broker graph).";

export const EXCHANGE_JSON_SOURCES = [
  "ACB ExchangeDescriptor type (anypoint-cli-agent-fabric-plugin)",
  "v2 template: templates/agentic-network/exchange.json.template",
  "Real v2 project fixtures under agent-fabric-automation and agent-fabric-schema tests",
];

export const EXCHANGE_JSON_TOP_LEVEL: ExchangeJsonFieldDoc[] = [
  {
    field: "main",
    type: "string",
    composerUi: "—",
    composerSource: "hardcoded",
    notes: 'Entry file. Always "agent-network.yaml" for v2 agentic-network projects.',
  },
  {
    field: "name",
    type: "string",
    composerUi: "Network name",
    composerSource: "editable",
    notes: "Human-readable project label. Also used as yaml info.label.",
  },
  {
    field: "classifier",
    type: "string",
    composerUi: "—",
    composerSource: "hardcoded",
    notes: 'Always "agentic-network" for v2 (v1 projects used "agent-network").',
  },
  {
    field: "organizationId",
    type: "string",
    composerUi: "Organization id",
    composerSource: "editable",
    notes: "Org UUID that owns the project.",
  },
  {
    field: "groupId",
    type: "string",
    composerUi: "Organization id (same field)",
    composerSource: "derived",
    notes: "Exchange GAV groupId. Builder sets groupId = organizationId.",
  },
  {
    field: "assetId",
    type: "string",
    composerUi: "Asset id",
    composerSource: "editable",
    notes: "Exchange asset slug (GAV assetId). [letters, digits, hyphens, and underscores; start with a letter; end with a letter or digit]",
  },
  {
    field: "version",
    type: "string",
    composerUi: "Version",
    composerSource: "editable",
    notes: "Asset semver published to Exchange. Same value as yaml info.version in Builder today.",
  },
  {
    field: "descriptorVersion",
    type: "string",
    composerUi: "Descriptor version",
    composerSource: "model-default",
    notes: 'Descriptor format version. Default "1.0.0". Separate from asset version and yaml agentNetwork version. Protected in Builder — set from import or factory default.',
  },
  {
    field: "apiVersion",
    type: "string",
    composerUi: "Version group",
    composerSource: "editable",
    notes:
      'Exchange version group for publish/deploy (ACB/CLI default "v1.0"). Not yaml info.version or agentNetwork: 2.0.0. CLI falls back to "v1.0" if missing.',
  },
  {
    field: "tags",
    type: "string[]",
    composerUi: "Tags",
    composerSource: "editable",
    notes: "Comma-separated in Builder; emitted as a JSON string array.",
  },
  {
    field: "description",
    type: "string?",
    composerUi: "Description",
    composerSource: "editable",
    notes: "Optional project description on ExchangeDescriptor.",
  },
  {
    field: "dependencies",
    type: "array",
    composerUi: "Exchange Assets tab",
    composerSource: "derived",
    notes: "One entry per composed Exchange asset. See dependency shape below.",
  },
  {
    field: "metadata",
    type: "object",
    composerUi: "Variables tab",
    composerSource: "derived",
    notes: "Deploy metadata. Builder emits metadata.variables from connections.",
  },
];

/** Always-visible Project tab copy for the asset version (GAV) field. */
export const EXCHANGE_ASSET_VERSION_UI_DETAIL = {
  title: "Exchange release identity",
  summary:
    "This is your Exchange release version — leave 0.0.0 and Build will bump itself to the next in line.",
  points: [
    "Together with organization id and asset id, it forms the GAV coordinate Exchange uses to identify each publication (groupId:assetId:version).",
    "MuleSoft advises against hand-picking a semver for each publish — Exchange manages the semantic version and auto-increments it (patch for changes; minor increments happen automatically and can't be set by hand).",
    "Changing it creates a new Exchange version entry. Republishing the same version may conflict with an existing release.",
    "Republishing an asset before its hard delete reuses the next available patch (for example, 1.0.x).",
    "Also written to agent-network.yaml info.version, unless the project has a yaml-only version override from import.",
  ],
} as const;

/** Project tab copy for the protected descriptorVersion field. */
export const EXCHANGE_DESCRIPTOR_VERSION_UI_DETAIL = {
  title: "Exchange descriptor format",
  summary: "Mostly MuleSoft-controlled — usually leave at 1.0.0.",
  points: [
    "Describes the exchange.json descriptor format, not your asset release.",
    'Documented as: "Descriptor format version. Default 1.0.0. Separate from asset version and yaml agentNetwork version."',
    "Sourced from MuleSoft's ExchangeDescriptor type / ACB templates.",
    "Only affects exchange.json — if the CLI/ACB does not recognize the value, publish/build may fail or misinterpret the project.",
    "Builder does not validate this field — treat as read-only unless MuleSoft documents a new descriptor version.",
  ],
} as const;

/** Always-visible Project tab hint for exchange.json apiVersion (Exchange version group). */
export const EXCHANGE_API_VERSION_FIELD_HINT =
  'Exchange version group for publish and deploy. ACB and CLI default to "v1.0" for new agentic-network projects — normal even when yaml uses agentNetwork: 2.0.0.';

/** Expanded Project tab copy for the version group field. */
export const EXCHANGE_API_VERSION_UI_DETAIL = {
  title: "Exchange version group",
  summary: EXCHANGE_API_VERSION_FIELD_HINT,
  points: [
    'Maps to Exchange asset versionGroup (e.g. "v1", "v2") — must match exactly at deploy time.',
    "Names are free-form: any string works. A v# pattern is MuleSoft's convention, not a requirement.",
    "At publish, Exchange auto-increments semver within this group; keep the same group for the life of a project line.",
    "Renaming it — or publishing under a new group — bumps the major version (x.0.0) for every associated asset (e.g. 1.x.x to 2.x.x); changes unrelated to the group bump only the patch.",
    "Not your asset semver (Version field), not descriptorVersion, and not yaml agentNetwork: 2.0.0.",
    "Deploy resolves the latest published semver for each connection/asset inside this group.",
  ],
} as const;

export const EXCHANGE_JSON_DEPENDENCY: ExchangeJsonNestedDoc = {
  title: "dependencies[]",
  fields: [
    {
      field: "groupId",
      type: "string",
      composerUi: "Assets (GAV)",
      composerSource: "derived",
      notes: "Dependency org / namespace (asset.namespace or groupId).",
    },
    {
      field: "assetId",
      type: "string",
      composerUi: "Assets (GAV)",
      composerSource: "derived",
      notes: "Published dependency asset id.",
    },
    {
      field: "version",
      type: "string",
      composerUi: "Assets (GAV)",
      composerSource: "derived",
      notes: "Pinned dependency version from Exchange.",
    },
    {
      field: "classifier",
      type: "string",
      composerUi: "Assets (kind)",
      composerSource: "derived",
      notes:
        'agent-metadata | mcp-metadata | llm-metadata, and "policy" for policy templates (the asset type ACB writes; older projects wrote the "schema" file classifier instead).',
    },
    {
      field: "packaging",
      type: "string",
      composerUi: "—",
      composerSource: "hardcoded",
      notes: 'Always "zip" for composed agentic assets in Builder.',
    },
  ],
};

export const EXCHANGE_JSON_VARIABLE: ExchangeJsonNestedDoc = {
  title: "metadata.variables.{group}.{field}",
  fields: [
    {
      field: "description",
      type: "string?",
      composerUi: "Variables tab",
      composerSource: "editable",
      notes: "Human description for deploy UI.",
    },
    {
      field: "default",
      type: "string",
      composerUi: "Variables tab",
      composerSource: "editable",
      notes: "Default deploy value (often a URL default from Assets).",
    },
    {
      field: "secret",
      type: "boolean",
      composerUi: "Variables tab / Assets auth",
      composerSource: "derived",
      notes: "true for API keys and other secrets.",
    },
  ],
};

export const EXCHANGE_JSON_COMPOSER_NOTES = [
  "No formal exchange.json JSON Schema ships with agent_network_v2.json — validate agent-network.yaml against that schema; exchange.json follows the Exchange project descriptor convention.",
  "apiVersion is the Exchange version group used when resolving published dependency versions at deploy time — ACB/CLI default is v1.0; do not confuse it with yaml info.version or agentNetwork: 2.0.0.",
  "groupId and organizationId are the same value in Builder output.",
  "Dependencies are never typed manually — compose assets on the Exchange Assets tab and they appear here automatically.",
  "Deploy variables are derived from connection URLs and auth; edit descriptions/defaults on the Variables tab.",
  "See the live projection in the file preview (exchange.json) or use Edit mode to paste a real project.",
];

export function composerSourceLabel(source: ComposerFieldSource): string {
  switch (source) {
    case "editable":
      return "Editable in Builder";
    case "model-default":
      return "In model (default)";
    case "derived":
      return "Derived";
    case "derived-from-interface-policies":
      return "Derived from A2A Interface policies";
    case "hardcoded":
      return "Fixed in serializer";
    case "not-in-composer":
      return "Not in Builder";
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}
