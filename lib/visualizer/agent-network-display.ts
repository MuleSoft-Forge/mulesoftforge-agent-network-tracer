import type { BrokerInEnvironment } from "@/lib/visualizer/brokers-in-environment-types";

/** Stable key for grouping brokers that share the same parent agent-network GAV. */
export function agentNetworkGroupKey(
  gav: BrokerInEnvironment["agentNetworkGav"]
): string {
  if (!gav) return "__unknown__";
  return `${gav.groupId}:${gav.assetId}`;
}

/** Fallback label when Exchange name is not yet resolved. */
export function agentNetworkFallbackLabel(
  gav: BrokerInEnvironment["agentNetworkGav"]
): string {
  if (!gav) return "Unknown agent network";
  return gav.assetId;
}

export function groupBrokersByAgentNetwork(
  brokers: BrokerInEnvironment[]
): Map<string, BrokerInEnvironment[]> {
  const groups = new Map<string, BrokerInEnvironment[]>();
  for (const broker of brokers) {
    const key = agentNetworkGroupKey(broker.agentNetworkGav);
    const existing = groups.get(key);
    if (existing) {
      existing.push(broker);
    } else {
      groups.set(key, [broker]);
    }
  }
  return groups;
}
