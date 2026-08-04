import { useEffect, useState } from "react";
import type { BrokerInEnvironment } from "@/lib/visualizer/brokers-in-environment-types";
import {
  agentNetworkFallbackLabel,
  agentNetworkGroupKey,
} from "@/lib/visualizer/agent-network-display";

/**
 * Resolve human-readable agent-network names from Exchange for brokers'
 * parent GAVs (one fetch per unique network).
 */
export function useAgentNetworkNames(orgId: string, brokers: BrokerInEnvironment[]) {
  const [namesByKey, setNamesByKey] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    if (!orgId || brokers.length === 0) {
      setNamesByKey(new Map());
      return;
    }

    const gavByKey = new Map<string, NonNullable<BrokerInEnvironment["agentNetworkGav"]>>();
    for (const broker of brokers) {
      const gav = broker.agentNetworkGav;
      if (!gav) continue;
      const key = agentNetworkGroupKey(gav);
      if (!gavByKey.has(key)) gavByKey.set(key, gav);
    }

    if (gavByKey.size === 0) {
      setNamesByKey(new Map());
      return;
    }

    let cancelled = false;

    void Promise.all(
      Array.from(gavByKey.entries()).map(async ([key, gav]) => {
        try {
          const params = new URLSearchParams({
            organizationId: gav.groupId,
            assetId: gav.assetId,
          });
          const res = await fetch(`/api/exchange/versions?${params.toString()}`);
          if (!res.ok) return [key, agentNetworkFallbackLabel(gav)] as const;
          const data = (await res.json()) as { name?: string };
          return [key, data.name?.trim() || gav.assetId] as const;
        } catch {
          return [key, agentNetworkFallbackLabel(gav)] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setNamesByKey(new Map(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [orgId, brokers]);

  return namesByKey;
}
