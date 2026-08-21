"use client";

import { useEffect, useState } from "react";
import {
  fetchEnvironments,
  readCachedEnvironments,
  type AnypointEnvironment,
} from "@/lib/anypoint/environments-client";

export type { AnypointEnvironment };

const ENV_NONE = "";

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

    const cached = readCachedEnvironments(orgId);
    if (cached && cached.length > 0) {
      setEnvironments(cached);
      setLoading(false);
      const currentInList = value && cached.find((e) => e.id === value);
      onSelect(currentInList ? value : ENV_NONE, currentInList || null);
    } else {
      setLoading(true);
    }

    let cancelled = false;
    fetchEnvironments(orgId)
      .then((list) => {
        if (cancelled) return;
        setEnvironments(list);
        const currentInList = value && list.find((e) => e.id === value);
        onSelect(currentInList ? value : ENV_NONE, currentInList || null);
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
