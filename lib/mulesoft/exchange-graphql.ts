/**
 * Exchange asset metadata via the Graph API — ported from MuleSoft's own
 * `anypoint-cli-agent-fabric-plugin` (`src/utils/exchange.ts` `getAssetMetadata`).
 *
 * The documented REST op `GET /assets/{groupId}/{assetId}` (no version) does not
 * exist — that path only supports DELETE/PATCH. The real, working way to list
 * every version of an asset is this GraphQL query's `otherVersions` field.
 *
 * @see https://docs.mulesoft.com/exchange/to-search-with-graph-api
 */

export interface ExchangeGraphQLFile {
  classifier?: string;
  packaging?: string;
  downloadURL?: string;
  externalLink?: string;
  md5?: string;
  sha1?: string;
  createdDate?: string;
  mainFile?: boolean;
  isGenerated?: boolean;
}

export interface ExchangeGraphQLAsset {
  organizationId: string;
  groupId: string;
  assetId: string;
  version: string;
  minorVersion: string;
  versionGroup: string;
  name: string;
  description: string;
  type: string;
  status: string;
  isPublic: boolean;
  files: ExchangeGraphQLFile[];
  dependencies: Array<{ organizationId: string; groupId: string; assetId: string; version: string; minorVersion: string }>;
  otherVersions: Array<{ version: string; versionGroup: string }>;
}

interface ExchangeGraphQLResponse {
  data?: { asset?: ExchangeGraphQLAsset | null };
  errors?: Array<{ message: string }>;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const ASSET_QUERY_FIELDS = `organizationId groupId assetId version minorVersion versionGroup name description type status isPublic contactEmail contactName labels files { classifier packaging downloadURL externalLink md5 sha1 createdDate mainFile isGenerated } dependencies { organizationId groupId assetId version minorVersion } otherVersions { version versionGroup }`;

/**
 * Fetches full asset metadata (including every other published version) via
 * the Exchange Graph API. When `version` is omitted, Exchange returns the
 * latest version's detail plus `otherVersions` for every other release.
 */
export async function fetchExchangeAssetViaGraphQL(
  baseUrl: string,
  groupId: string,
  assetId: string,
  accessToken: string,
  version?: string,
  fetchFn: FetchFn = fetch
): Promise<ExchangeGraphQLAsset | null> {
  const versionArg = version ? ", version: $version" : "";
  const queryParams = version
    ? "($groupId: String!, $assetId: String!, $version: String!)"
    : "($groupId: String!, $assetId: String!)";
  const query = `query${queryParams} { asset(groupId: $groupId, assetId: $assetId${versionArg}) { ${ASSET_QUERY_FIELDS} } }`;

  const variables: Record<string, string> = { groupId, assetId };
  if (version) variables.version = version;

  const res = await fetchFn(`${baseUrl}/graph/api/v2/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) return null;

  const body = (await res.json()) as ExchangeGraphQLResponse;
  if (body.errors && body.errors.length > 0) {
    const isNotFound = body.errors.every((e) => /no asset matching/i.test(e.message));
    if (isNotFound) return null;
    throw new Error(`Exchange GraphQL error: ${body.errors.map((e) => e.message).join("; ")}`);
  }

  return body.data?.asset ?? null;
}
