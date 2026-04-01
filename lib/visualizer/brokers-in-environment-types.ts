export interface BrokerInEnvironment {
  nodeId: string;
  assetId: string;
  name: string;
  organizationId: string;
  instanceIds: string[];
  /** GAV of the parent agent-network asset from API Manager metadata.source (urn:gav:groupId:assetId:version) */
  agentNetworkGav?: { groupId: string; assetId: string; version: string };
}
