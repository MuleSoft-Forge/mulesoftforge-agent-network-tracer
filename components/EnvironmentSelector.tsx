"use client";

import { useEffect, useState } from "react";

export interface AnypointEnvironment {
  id: string;
  name: string;
  organizationId: string;
  isProduction: boolean;
  type: "production" | "sandbox" | "design";
  clientId?: string;
  arcNamespace?: string | null;
}

interface EnvironmentsResponse {
  data?: AnypointEnvironment[];
  total?: number;
}

const ENV_NONE = "";

const ENVS_CACHE_PREFIX = "agent-network-envs-";

function getCachedEnvironments(orgId: string): AnypointEnvironment[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ENVS_CACHE_PREFIX + orgId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AnypointEnvironment[]) : null;
  } catch {
    return null;
  }
}

function setCachedEnvironments(orgId: string, list: AnypointEnvironment[]): void {
  try {
    sessionStorage.setItem(ENVS_CACHE_PREFIX + orgId, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

interface EnvironmentSelectorProps {
  orgId: string | null;
  value: string;
  onSelect: (envId: string, env: AnypointEnvironment | null) => void;
  disabled?: boolean;
}

export default function EnvironmentSelector({
  orgId,
  value,
  onSelect,
  disabled = false,
}: EnvironmentSelectorProps) {
  const [environments, setEnvironments] = useState<AnypointEnvironment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orgId) {
      setEnvironments([]);
      onSelect(ENV_NONE, null);
      return;
    }

    const cached = getCachedEnvironments(orgId);
    if (cached && cached.length > 0) {
      // Filter out design environments from cache
      const filteredCached = cached.filter((e: AnypointEnvironment) => e.type !== "design");
      setEnvironments(filteredCached);
      setLoading(false);
      const currentInList = value && filteredCached.find((e: AnypointEnvironment) => e.id === value);
      if (currentInList) {
        onSelect(value, currentInList);
      } else {
        onSelect(ENV_NONE, null);
      }
    } else {
      setLoading(true);
    }

    let cancelled = false;
    fetch(`/api/accounts/organizations/${encodeURIComponent(orgId)}/environments`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: EnvironmentsResponse) => {
        if (cancelled) return;
        const allEnvs = Array.isArray(body.data) ? body.data : [];
        // Filter out design environments
        const list = allEnvs.filter((e: AnypointEnvironment) => e.type !== "design");
        setEnvironments(list);
        setCachedEnvironments(orgId, list);
        const currentInList = value && list.find((e: AnypointEnvironment) => e.id === value);
        if (currentInList) {
          onSelect(value, currentInList);
        } else {
          onSelect(ENV_NONE, null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEnvironments([]);
          onSelect(ENV_NONE, null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Only re-fetch when orgId changes; value/onSelect used only when response arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const envId = e.target.value;
    const env =
      envId === ENV_NONE
        ? null
        : environments.find((env: AnypointEnvironment) => env.id === envId) ?? null;
    onSelect(envId, env);
  };

  const isDisabled = disabled || !orgId || loading;

  return (
    <div className="space-y-2">
      <label
        htmlFor="environment-select"
        className="text-sm font-semibold text-gray-900"
      >
        Environment Name
      </label>
      <select
        id="environment-select"
        value={value}
        onChange={handleChange}
        disabled={isDisabled}
        className="w-full rounded-anypoint border border-gray-300 bg-white px-3 py-2 pr-8 text-sm text-gray-900 transition-all duration-150 ease-[cubic-bezier(0.46,0.03,0.52,0.96)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-70"
      >
        <option value={ENV_NONE}>
          {!orgId
            ? "Select a single Business Group first"
            : loading
              ? "Loading…"
              : "Select Environment"}
        </option>
        {environments.map((env: AnypointEnvironment) => (
          <option key={env.id} value={env.id}>
            {env.name} ({env.type})
          </option>
        ))}
      </select>
    </div>
  );
}
