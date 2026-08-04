"use client";

import { useMemo } from "react";
import { ChevronsRight } from "lucide-react";
import LlmProxyNodeCanvas from "@/components/llmProxy/LlmProxyNodeCanvas";
import { buildLlmProxyDiagram } from "@/lib/llmProxy/proxy-diagram";
import type { LlmProxyListItem, LlmProxyRouteTrace } from "@/lib/llmProxy/types";

interface LlmProxyNetworkDiagramProps {
  proxy: LlmProxyListItem;
  trace?: LlmProxyRouteTrace | null;
  /** Collapses the diagram panel to the right rail so the chat pane can expand. */
  onRequestCollapse?: () => void;
}

/**
 * LLM Proxy request path as a dedicated node diagram (pan, zoom, drag).
 * Not the Agent Network canvas — domain-specific nodes and legend only.
 */
export default function LlmProxyNetworkDiagram({
  proxy,
  trace = null,
  onRequestCollapse,
}: LlmProxyNetworkDiagramProps) {
  const graph = useMemo(() => buildLlmProxyDiagram(proxy, trace), [proxy, trace]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">Proxy network</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
            Drag nodes, scroll to zoom, double-click the background to fit, F to fit.             Highlighted arrows follow the last request: green for the traced path, red only when the
            deny list matched.
          </p>
        </div>
        {onRequestCollapse && (
          <button
            type="button"
            onClick={onRequestCollapse}
            className="shrink-0 rounded-md border border-gray-200 bg-white p-1.5 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            title="Hide diagram"
            aria-label="Hide diagram"
          >
            <ChevronsRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <LlmProxyNodeCanvas graph={graph} className="h-full" />
      </div>
    </div>
  );
}
