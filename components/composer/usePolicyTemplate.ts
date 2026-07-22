"use client";

import { useCallback, useEffect, useState } from "react";

export interface PolicyTemplateDetail {
  groupId: string;
  assetId: string;
  name: string;
  version: string | null;
  description?: string;
  category?: string;
  configurationSchema: Record<string, unknown> | null;
}

interface UsePolicyTemplateArgs {
  organizationId: string | undefined;
  groupId: string | undefined;
  assetId: string | undefined;
  version: string | null | undefined;
  enabled?: boolean;
}

export function usePolicyTemplate({
  organizationId,
  groupId,
  assetId,
  version,
  enabled = true,
}: UsePolicyTemplateArgs) {
  const [detail, setDetail] = useState<PolicyTemplateDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !organizationId || !groupId || !assetId || !version) {
      setDetail(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        organizationId,
        groupId,
        assetId,
        version,
      });
      const res = await fetch(`/api/exchange/policies/template?${params.toString()}`);
      if (!res.ok) {
        setDetail(null);
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Policy template failed (${res.status}).`);
        return;
      }
      setDetail((await res.json()) as PolicyTemplateDetail);
    } catch {
      setDetail(null);
      setError("Policy template request failed.");
    } finally {
      setLoading(false);
    }
  }, [enabled, organizationId, groupId, assetId, version]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { detail, loading, error, refresh };
}
