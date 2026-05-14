"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import type { AgentCard } from "@/lib/invoke/types";
import { fetchAgentCard } from "@/lib/invoke/discovery";
import type { InvokeAction } from "@/lib/invoke/types";
import type { Dispatch } from "react";
import { urlContainsIngressPlaceholder } from "@/lib/invoke/ingress-gateway-url";

interface BrokerUrlBarProps {
  url: string;
  loaded: boolean;
  processing: boolean;
  currentStep: string;
  agentCard: AgentCard | null;
  /** URL resolved from Exchange when a broker is selected in the sidebar. */
  suggestedUrl?: string | null;
  dispatch: Dispatch<InvokeAction>;
  /** When set, `${ingressgw.url}` in the bar can be expanded via API Manager before Load. */
  resolveContext?: { orgId: string; envId: string; apiInstanceId: string };
}

export default function BrokerUrlBar({
  url,
  loaded,
  processing,
  currentStep,
  agentCard,
  suggestedUrl,
  dispatch,
  resolveContext,
}: BrokerUrlBarProps) {
  const [inputUrl, setInputUrl] = useState(url);

  // Pre-fill the input whenever a new suggestion arrives and the broker is not
  // already loaded (don't overwrite an active session).
  useEffect(() => {
    if (!loaded && suggestedUrl) setInputUrl(suggestedUrl);
  }, [suggestedUrl, loaded]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function resolveIngressUrlIfNeeded(candidate: string): Promise<string> {
    if (!urlContainsIngressPlaceholder(candidate) || !resolveContext) {
      return candidate;
    }
    const params = new URLSearchParams({
      orgId: resolveContext.orgId,
      envId: resolveContext.envId,
      apiInstanceId: resolveContext.apiInstanceId,
      resolveUrl: candidate,
    });
    const res = await fetch(`/api/invoke/broker-url?${params.toString()}`);
    const data = (await res.json()) as {
      url?: string | null;
      message?: string;
      error?: string;
    };
    if (!res.ok || !data.url) {
      throw new Error(
        data.message ?? data.error ?? "Could not resolve gateway URL from API Manager (${ingressgw.url})."
      );
    }
    return data.url;
  }

  async function handleLoad(bustCache = false) {
    let trimmed = inputUrl.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      trimmed = await resolveIngressUrlIfNeeded(trimmed);
      setInputUrl(trimmed);

      const card = await fetchAgentCard(trimmed, { bustCache });
      let resolvedUrl = card?.url?.trim() || trimmed;
      if (urlContainsIngressPlaceholder(resolvedUrl) && resolveContext) {
        resolvedUrl = await resolveIngressUrlIfNeeded(resolvedUrl);
      }
      dispatch({ type: "SET_BROKER", url: resolvedUrl, card });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load broker");
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    if (refreshing || processing) return;
    setRefreshing(true);
    setError(null);
    try {
      let fetchUrl = url;
      if (urlContainsIngressPlaceholder(fetchUrl) && resolveContext) {
        fetchUrl = await resolveIngressUrlIfNeeded(fetchUrl);
      }
      const card = await fetchAgentCard(fetchUrl, { bustCache: true });
      let resolvedUrl = card?.url?.trim() || fetchUrl;
      if (urlContainsIngressPlaceholder(resolvedUrl) && resolveContext) {
        resolvedUrl = await resolveIngressUrlIfNeeded(resolvedUrl);
      }
      dispatch({ type: "SET_BROKER", url: resolvedUrl, card });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleLoad();
  }

  if (loaded) {
    return (
      <div className="shrink-0 border-b border-gray-200 bg-white px-3 py-2.5 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          <span
            className="flex-1 text-xs text-gray-600 truncate font-medium"
            title={url}
          >
            {url.replace(/^https?:\/\//, "")}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || processing}
            title="Refresh broker metadata"
            className="text-gray-400 hover:text-gray-600 disabled:opacity-40 transition-colors"
          >
            <svg
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 3v5h-5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              <path d="M8 16H3v5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => {
              setInputUrl("");
              dispatch({ type: "RESET_BROKER" });
            }}
            className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            Change
          </button>
        </div>

        {agentCard?.description && (
          <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2">
            {agentCard.description}
          </p>
        )}

        {processing && currentStep && (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping shrink-0" />
            <span className="text-[11px] text-gray-500">{currentStep}</span>
          </div>
        )}
        {error && (
          <p className="text-[11px] text-red-500">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-gray-200 bg-white px-3 py-3 space-y-2">
      <p className="text-xs font-semibold text-gray-700">Broker URL</p>
      <div className="flex gap-1.5">
        <input
          ref={inputRef}
          type="url"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={suggestedUrl ? suggestedUrl : "https://…/broker-path/"}
          disabled={loading}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => handleLoad()}
          disabled={!inputUrl.trim() || loading}
          className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white inline-block" />
              Loading
            </span>
          ) : (
            "Load"
          )}
        </button>
      </div>
      {error && <p className="text-[11px] text-red-500">{error}</p>}
      <p className="text-[11px] text-gray-400">
        Fetches the agent card via <code className="font-mono">/.well-known/agent-card.json</code>.
        A2A calls are proxied via this app server to avoid CORS.
      </p>
    </div>
  );
}
