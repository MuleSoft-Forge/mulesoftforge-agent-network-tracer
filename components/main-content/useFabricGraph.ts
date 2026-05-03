import { useEffect, useState } from "react";
import type { FabricGraphResponse } from "@/lib/adapters/visualizer-to-canonical";
import { fetchAndMergeRuntimeEdges, ACTIVITY_PERIODS } from "@/lib/visualizer/runtime-edges";

/**
 * Fetches the fabric graph for the selected org+env and merges in runtime
 * edges. Canvas intentionally uses a fixed 7-day window — the UI's activity
 * period only scopes the tasks list, not the graph.
 */
export function useFabricGraph(orgId: string, envId: string) {
  const [fabricData, setFabricData] = useState<FabricGraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || !envId) {
      setFabricData(null);
      return;
    }

    let cancelled = false;
    setError(null);

    const payload = { environmentType: null, orgIds: [orgId] };

    Promise.all([
      fetch(`/api/visualizer/v2/organizations/${encodeURIComponent(orgId)}/fabric-network`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((res) => {
        if (!res.ok) {
          throw new Error(res.status === 401 ? "Not signed in" : `Failed: ${res.status}`);
        }
        return res.json();
      }),
      fetch(`/api/accounts/organizations/${encodeURIComponent(orgId)}/environments`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { data?: Array<{ id: string; isProduction: boolean }> } | null) => {
          const env = data?.data?.find((e) => String(e.id) === envId);
          return env?.isProduction === true ? "production" : "sandbox";
        })
        .catch(() => "production" as const),
    ])
      .then(async ([fabric, environment]) => {
        if (cancelled) return;
        const enriched = await fetchAndMergeRuntimeEdges(
          orgId,
          fabric as FabricGraphResponse,
          ACTIVITY_PERIODS["7d"],
          environment
        );
        if (cancelled) return;
        setFabricData(enriched);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load graph");
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, envId]);

  return { fabricData, error, setError };
}
