/**
 * Types for Visualizer node runtime details API response.
 * POST .../v2/organizations/{orgId}/fabric-network/node/{nodeId}/runtime
 */

export interface RuntimeInstanceEnvironment {
  id?: string;
  name?: string;
  type?: string;
}

export interface RuntimeInstance {
  instanceId?: string;
  instanceName?: string;
  organizationId?: string;
  environment?: RuntimeInstanceEnvironment;
  version?: string;
  [key: string]: unknown;
}

export interface NodeRuntimeDetails {
  assetId?: string;
  instances?: RuntimeInstance[];
  [key: string]: unknown;
}
