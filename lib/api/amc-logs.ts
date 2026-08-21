export interface AmcLogSearch {
  afterDocId?: string;
  length?: number;
  startTime?: number;
  endTime?: number;
  regexp?: string;
  descending?: boolean;
}

export interface AmcLogsUrlParams {
  baseUrl: string;
  organizationId: string;
  environmentId: string;
  deploymentId: string;
  specificationId: string;
  search: AmcLogSearch;
}

/**
 * Build the documented AMC Log Aggregator v2 request.
 *
 * The OpenAPI operation names its query parameter `search`, but that parameter
 * is an exploded object. Its properties therefore appear as top-level query
 * fields such as `length=1000&descending=true`.
 */
export function buildAmcLogsUrl(params: AmcLogsUrlParams): string {
  const {
    baseUrl,
    organizationId,
    environmentId,
    deploymentId,
    specificationId,
    search,
  } = params;
  const path =
    `/amc/application-manager/api/v2/organizations/${encodeURIComponent(organizationId)}` +
    `/environments/${encodeURIComponent(environmentId)}` +
    `/deployments/${encodeURIComponent(deploymentId)}` +
    `/specs/${encodeURIComponent(specificationId)}/logs`;
  const url = new URL(path, baseUrl);

  if (search.afterDocId !== undefined) {
    url.searchParams.set("afterDocId", search.afterDocId);
  }
  if (search.length !== undefined) {
    url.searchParams.set("length", String(search.length));
  }
  if (search.startTime !== undefined) {
    url.searchParams.set("startTime", String(search.startTime));
  }
  if (search.endTime !== undefined) {
    url.searchParams.set("endTime", String(search.endTime));
  }
  if (search.regexp !== undefined) {
    url.searchParams.set("regexp", search.regexp);
  }
  if (search.descending !== undefined) {
    url.searchParams.set("descending", String(search.descending));
  }

  return url.toString();
}
