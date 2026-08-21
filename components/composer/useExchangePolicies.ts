"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type PolicyProvider = "mulesoft" | "organization";

export type PolicyInjectionPoint = "inbound" | "outbound";

/** Policy template row from GET /api/exchange/policies (getExchangePolicyTemplates). */
export interface ExchangePolicyOption {
  groupId: string;
  assetId: string;
  name: string;
  version: string | null;
  description?: string;
  category?: string;
  assetTypes: string[];
  provider: PolicyProvider;
  injectionPoint: PolicyInjectionPoint;
}

export interface ExchangePolicyCatalog {
  inbound: ExchangePolicyOption[];
  outbound: ExchangePolicyOption[];
}

interface UseExchangePoliciesResult {
  catalog: ExchangePolicyCatalog;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const EMPTY_CATALOG: ExchangePolicyCatalog = { inbound: [], outbound: [] };

export function useExchangePolicies(organizationId: string | undefined): UseExchangePoliciesResult {
  const [catalog, setCatalog] = useState<ExchangePolicyCatalog>(EMPTY_CATALOG);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Changing organization while a request is in flight must not let the older
  // catalog land after the newer one.
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!organizationId) {
      requestIdRef.current += 1;
      setCatalog(EMPTY_CATALOG);
      setError("Set organization id in Project identity to load Exchange policies.");
      return;
    }
    const requestId = ++requestIdRef.current;
    const isStale = () => requestIdRef.current !== requestId;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ organizationId });
      const res = await fetch(`/api/exchange/policies?${params.toString()}`);
      if (isStale()) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (isStale()) return;
        setCatalog(EMPTY_CATALOG);
        if (res.status === 401) {
          setError("Not signed in.");
        } else {
          setError(body.error ?? `Policy catalog failed (${res.status}).`);
        }
        return;
      }
      const data = (await res.json()) as ExchangePolicyCatalog;
      if (isStale()) return;
      setCatalog({
        inbound: data.inbound ?? [],
        outbound: data.outbound ?? [],
      });
    } catch {
      if (isStale()) return;
      setCatalog(EMPTY_CATALOG);
      setError("Policy catalog request failed.");
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { catalog, loading, error, refresh };
}
