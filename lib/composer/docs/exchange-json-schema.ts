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
    notes: "Exchange asset slug (GAV assetId).",
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
    composerSource: "editable",
    notes: 'Descriptor format version. Default "1.0.0". Separate from asset version and yaml agentNetwork version.',
  },
  {
    field: "apiVersion",
    type: "string",
    composerUi: "API version",
    composerSource: "editable",
    notes:
      'Exchange version group for publish/deploy (e.g. "v2.0", "v1"). Not the same as yaml info.version. ACB falls back to "v1" if missing.',
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
      notes: 'agent-metadata | mcp-metadata | llm-metadata (and policy "schema" in some projects).',
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
  "apiVersion is the Exchange version group used when resolving published dependency versions at deploy time — do not confuse it with yaml info.version or agentNetwork: 2.0.0.",
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
