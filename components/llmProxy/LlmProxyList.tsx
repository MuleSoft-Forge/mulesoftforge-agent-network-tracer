"use client";

import { useEffect, useState } from "react";
import Spinner from "@/components/Spinner";
import type { LlmProxyListItem, LlmProxyListResponse } from "@/lib/llmProxy/types";

interface LlmProxyListProps {
  orgId: string;
  envId: string;
  selectedId: string | null;
  onSelect: (proxy: LlmProxyListItem) => void;
  /** Collapse control for the parent sidebar (top bar with loading indicator). */
  onToggleList: () => void;
}

export default function LlmProxyList({
  orgId,
  envId,
  selectedId,
  onSelect,
  onToggleList,
}: LlmProxyListProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<LlmProxyListItem[]>([]);

  useEffect(() => {
    if (!orgId || !envId) {
      setItems([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ orgId, envId });
    fetch(`/api/llm-proxy/list?${params.toString()}`)
      .then(async (res) => {
        const data = (await res.json()) as LlmProxyListResponse & { error?: string };
        if (!res.ok) throw new Error(data.error || `Failed: ${res.status}`);
        if (cancelled) return;
        setItems(data.instances ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setItems([]);
          setError(err instanceof Error ? err.message : "Failed to load LLM Proxies");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, envId]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center justify-end gap-1 border-b border-gray-200 px-1.5">
        {loading && <Spinner size="s" />}
        <button
          type="button"
          onClick={onToggleList}
          className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Collapse LLM Proxies list"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="p-3 text-xs text-red-600">{error}</div>
        ) : !loading && items.length === 0 ? (
          <div className="p-3 text-xs text-gray-500">
            No LLM Proxies found in this environment.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((item) => {
              const isActive = item.id === selectedId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <div className="font-medium truncate">{item.name}</div>
                    {item.assetId && item.assetId !== item.name && (
                      <div
                        className="truncate text-[11px] text-gray-500 font-mono"
                        title={item.assetId}
                      >
                        {item.assetId}
                      </div>
                    )}
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500">
                      <span className="font-mono">#{item.id}</span>
                      {item.deploymentStatus && (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            item.deploymentStatus.toLowerCase() === "active"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {item.deploymentStatus}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
