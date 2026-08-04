"use client";

import { ChevronDown, Route, Check } from "lucide-react";
import { useState } from "react";
import { formatLlmProxyModelForRequest } from "@/lib/llmProxy/model-request";
import type { LlmProxyUpstream } from "@/lib/llmProxy/types";

interface ModelRoutesPanelProps {
  upstreams: LlmProxyUpstream[];
  /** Currently selected model (controls highlighted chip). */
  selectedModel: string;
  /** Fired with the route's targetModel. */
  onSelect: (model: string) => void;
}

/**
 * Routes panel for model-based LLM proxies. Each upstream carries a
 * `targetModel` and optional `provider`; the playground sends `provider/model`
 * to the gateway when multiple providers exist. Clicking a chip sets that
 * formatted value on the Model param.
 *
 * Not rendered for semantic proxies (those use PromptTopicsSidebar).
 */
export default function ModelRoutesPanel({
  upstreams,
  selectedModel,
  onSelect,
}: ModelRoutesPanelProps) {
  const [expanded, setExpanded] = useState(true);

  const routes = upstreams.filter(
    (u) => (u.targetModel && u.targetModel.length > 0) || (u.label && u.label.length > 0)
  );

  if (routes.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-gray-900">Routes</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
            {routes.length} route{routes.length === 1 ? "" : "s"}
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-gray-500 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>
      {expanded && (
        <div className="flex flex-wrap gap-1.5 border-t border-gray-100 px-3 py-3">
          {routes.map((u) => {
            const model = u.targetModel ?? "";
            const requestModel = formatLlmProxyModelForRequest(u);
            const isActive =
              requestModel.length > 0 &&
              (selectedModel === requestModel ||
                (model.length > 0 && selectedModel === model));
            const primary = requestModel || u.label || "(unnamed route)";
            const secondary =
              model && u.label && u.label !== model ? u.label : null;
            return (
              <button
                key={u.id ?? `${u.label}-${model}`}
                type="button"
                onClick={() => {
                  if (requestModel.length > 0) onSelect(requestModel);
                }}
                disabled={requestModel.length === 0}
                title={
                  [u.provider, u.format, u.uri].filter(Boolean).join(" · ") ||
                  undefined
                }
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                  isActive
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : requestModel.length === 0
                      ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {isActive && <Check className="h-3 w-3" />}
                <span className="font-mono">{primary}</span>
                {u.provider && (
                  <span className="rounded bg-gray-100 px-1 py-[1px] text-[10px] font-medium text-gray-600">
                    {u.provider}
                  </span>
                )}
                {secondary && (
                  <span className="text-[10px] text-gray-500">({secondary})</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
