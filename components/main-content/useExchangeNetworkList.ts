"use client";

import { useCallback, useEffect, useState } from "react";

export interface ExchangeNetworkListItem {
  groupId: string;
  assetId: string;
  name: string;
  versions: Array<{ version: string; status: string | null }>;
}

export type ExchangeNetworkSelection = Pick<
  ExchangeNetworkListItem,
  "groupId" | "assetId" | "name"
>;

function networkKey(groupId: string, assetId: string) {
  return `${groupId}:${assetId}`;
}

export function exchangeNetworkKey(network: ExchangeNetworkSelection | null | undefined) {
  return network ? networkKey(network.groupId, network.assetId) : "";
}

/** @param search optional term to narrow the Exchange query; omit for the default listing. */
export function useExchangeNetworkList(orgId: string, search?: string) {
  const [networks, setNetworks] = useState<ExchangeNetworkListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orgId) {
      setNetworks([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ organizationId: orgId });
      const term = search?.trim();
      if (term) params.set("search", term);
      const res = await fetch(`/api/exchange/networks?${params.toString()}`);
      const data = (await res.json()) as {
        networks?: ExchangeNetworkListItem[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Failed: ${res.status}`);
      setNetworks(Array.isArray(data.networks) ? data.networks : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agent networks");
      setNetworks([]);
    } finally {
      setLoading(false);
    }
  }, [orgId, search]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { networks, loading, error, refresh };
}
