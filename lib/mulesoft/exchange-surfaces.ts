/**
 * Exchange API surfaces used by this app — v2 Experience API vs legacy v1 file/Maven facades.
 *
 * @see https://dev-portal.mulesoft.com/apis/exchange-experience.html
 */

/** Documented asset types on GET /exchange/api/v2/assets (types query param). */
export const EXCHANGE_V2_DOCUMENTED_TYPES = [
  "rest-api",
  "soap-api",
  "http-api",
  "raml-fragment",
  "connector",
  "template",
  "example",
  "custom",
  "mcp",
  "agent",
] as const;

/** Types observed in Exchange UI / agent-network flows but not in the public v2 types enum. */
export const EXCHANGE_V2_OBSERVED_TYPES = [
  "agent-network",
  "app",
] as const;

export type ExchangeV2DocumentedType = (typeof EXCHANGE_V2_DOCUMENTED_TYPES)[number];
export type ExchangeV2ObservedType = (typeof EXCHANGE_V2_OBSERVED_TYPES)[number];

export interface ExchangeSurfaceSummary {
  api: "v2-experience" | "v2-files" | "v1-files" | "maven-facade";
  purpose: string;
  basePath: string;
}

export const EXCHANGE_SURFACES: readonly ExchangeSurfaceSummary[] = [
  {
    api: "v2-experience",
    purpose: "Asset catalog search, version list, metadata, agent/metadata, file download URLs",
    basePath: "/exchange/api/v2/assets",
  },
  {
    api: "v1-files",
    purpose: "Binary file download (icons, RAML zips) via downloadURL from v2 asset detail",
    basePath: "/exchange/files/api/v1/organizations/{orgId}/assets/{groupId}/{assetId}/{version}/{classifier}/{packaging}",
  },
  {
    api: "maven-facade",
    purpose: "Maven-published agent-network zip (agent-network.yaml, exchange.json)",
    basePath: "https://maven.{region}.anypoint.mulesoft.com/api/v1/organizations/{orgId}/maven/{groupId}/{assetId}/{version}/{assetId}-{version}-agent-network.zip",
  },
] as const;
