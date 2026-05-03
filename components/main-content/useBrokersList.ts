import { useEffect, useState } from "react";
import { debugError, debugLog } from "@/lib/api-logger";
import type { BrokerInEnvironment } from "@/lib/visualizer/brokers-in-environment-types";

/**
 * Fetches the broker list for the selected org+env. Brokers don't depend on
 * the activity period (only tasks do), so this hook deliberately does NOT
 * re-run when that changes.
 */
export function useBrokersList(orgId: string, envId: string) {
  const [brokers, setBrokers] = useState<BrokerInEnvironment[]>([]);
  const [selectedBroker, setSelectedBroker] = useState<BrokerInEnvironment | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || !envId) {
      setBrokers([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ orgId, environmentId: envId });

    fetch(`/api/brokers-in-environment?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          const msg =
            data.error || (res.status === 401 ? "Not signed in" : `Failed: ${res.status}`);
          debugError("[BROKERS] API error:", res.status, msg, data);
          throw new Error(msg);
        }
        return data as { brokers?: BrokerInEnvironment[]; error?: string };
      })
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          setBrokers([]);
          setSelectedBroker(null);
          return;
        }
        const next = Array.isArray(data.brokers) ? data.brokers : [];
        setBrokers(next);
        debugLog("[BROKERS] Loaded brokers:", next.length);
        setSelectedBroker((prev) => {
          if (!prev) return null;
          return next.find((b) => b.nodeId === prev.nodeId) ?? null;
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        debugError("[BROKERS] Fetch error:", err);
        setBrokers([]);
        setError(err instanceof Error ? err.message : "Failed to load brokers");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, envId]);

  return { brokers, selectedBroker, setSelectedBroker, loading, error, setError, setBrokers };
}
