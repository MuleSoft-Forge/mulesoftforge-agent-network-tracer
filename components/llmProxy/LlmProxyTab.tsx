"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsLeft, GripVertical, Network } from "lucide-react";
import ChatPlayground from "@/components/llmProxy/ChatPlayground";
import LlmProxyList from "@/components/llmProxy/LlmProxyList";
import LlmProxyNetworkDiagram from "@/components/llmProxy/LlmProxyNetworkDiagram";
import type { LlmProxyListItem, LlmProxyRouteTrace } from "@/lib/llmProxy/types";

/** MuleSoft Flex Gateway — LLM Proxy overview (model-based vs semantic routing, limits, providers). */
const LLM_PROXY_DOCS_URL =
  "https://docs.mulesoft.com/gateway/latest/flex-gateway-llm-proxy";

const LLM_PROXY_LIST_EXPANDED_KEY = "llm-proxy-list-expanded";
const LLM_PROXY_DIAGRAM_EXPANDED_KEY = "llm-proxy-diagram-expanded";
const LLM_PROXY_DIAGRAM_WIDTH_PX_KEY = "llm-proxy-diagram-width-px";

/** Minimum width so the policy network stays usable. */
const DIAGRAM_WIDTH_MIN_PX = 220;
/** Keep a usable chat composer width. */
const CHAT_WIDTH_MIN_PX = 260;
const DIAGRAM_WIDTH_DEFAULT_PX = 400;

function readStoredDiagramWidthPx(): number {
  if (typeof window === "undefined") return DIAGRAM_WIDTH_DEFAULT_PX;
  try {
    const raw = localStorage.getItem(LLM_PROXY_DIAGRAM_WIDTH_PX_KEY);
    if (raw == null) return DIAGRAM_WIDTH_DEFAULT_PX;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return DIAGRAM_WIDTH_DEFAULT_PX;
    return Math.max(DIAGRAM_WIDTH_MIN_PX, Math.min(1200, n));
  } catch {
    return DIAGRAM_WIDTH_DEFAULT_PX;
  }
}

function getStoredListExpanded(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(LLM_PROXY_LIST_EXPANDED_KEY);
    return v !== "false";
  } catch {
    return true;
  }
}

function getStoredDiagramExpanded(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(LLM_PROXY_DIAGRAM_EXPANDED_KEY);
    return v !== "false";
  } catch {
    return true;
  }
}

interface LlmProxyTabProps {
  orgId: string;
  envId: string;
}

/**
 * Footer under the LLM Proxies list — same shell as LeftSidebar footer so the
 * two columns align when shown side by side (LLM Proxy tab).
 */
function LlmProxyHelpFooter() {
  return (
    <div className="shrink-0 border-t border-gray-200 bg-white px-3 py-2">
      <p className="text-xs text-gray-600">
        Flex Gateway LLM Proxy test harness.{" "}
        <a
          href={LLM_PROXY_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-indigo-700 hover:underline"
        >
          Docs
        </a>
      </p>
    </div>
  );
}

/**
 * Left pane: list of LLM Proxies for the selected org/env.
 * Main pane: live chat (calls the proxy via `/api/llm-proxy/chat`); optional diagram on the right
 * collapses to a slim rail so chat can use the full width.
 *
 * orgId/envId are stashed into sessionStorage for the chat/detail APIs.
 *
 * The list pane is collapsible (same pattern as the main left sidebar).
 */
export default function LlmProxyTab({ orgId, envId }: LlmProxyTabProps) {
  const [selected, setSelected] = useState<LlmProxyListItem | null>(null);
  const [listExpanded, setListExpanded] = useState(true);
  const [diagramExpanded, setDiagramExpanded] = useState(true);
  const [diagramWidthPx, setDiagramWidthPx] = useState(DIAGRAM_WIDTH_DEFAULT_PX);
  const [routeTrace, setRouteTrace] = useState<LlmProxyRouteTrace | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setListExpanded(getStoredListExpanded());
    setDiagramExpanded(getStoredDiagramExpanded());
    setDiagramWidthPx(readStoredDiagramWidthPx());
  }, []);

  const handleToggleList = () => {
    const next = !listExpanded;
    setListExpanded(next);
    try {
      localStorage.setItem(LLM_PROXY_LIST_EXPANDED_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  const handleSetDiagramExpanded = (next: boolean) => {
    setDiagramExpanded(next);
    try {
      localStorage.setItem(LLM_PROXY_DIAGRAM_EXPANDED_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(
        "llm-proxy-ctx",
        JSON.stringify({ orgId, envId })
      );
    }
    setSelected(null);
    setRouteTrace(null);
  }, [orgId, envId]);

  useEffect(() => {
    setRouteTrace(null);
  }, [selected?.id]);

  /** Keep diagram width within the row when the window or layout changes. */
  useEffect(() => {
    if (!diagramExpanded || !selected) return;
    function clamp() {
      const node = splitContainerRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const maxDiagram = Math.max(
        DIAGRAM_WIDTH_MIN_PX,
        rect.width - CHAT_WIDTH_MIN_PX
      );
      setDiagramWidthPx((w) => Math.min(w, maxDiagram));
    }
    clamp();
    const node = splitContainerRef.current;
    if (!node) return;
    const ro = new ResizeObserver(clamp);
    ro.observe(node);
    window.addEventListener("resize", clamp);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", clamp);
    };
  }, [diagramExpanded, selected]);

  function startDiagramResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = diagramWidthPx;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(ev: MouseEvent) {
      const el = splitContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const maxDiagram = Math.max(
        DIAGRAM_WIDTH_MIN_PX,
        rect.width - CHAT_WIDTH_MIN_PX
      );
      const delta = ev.clientX - startX;
      const next = Math.min(
        maxDiagram,
        Math.max(DIAGRAM_WIDTH_MIN_PX, startW - delta)
      );
      setDiagramWidthPx(next);
    }
    function onUp() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDiagramWidthPx((w) => {
        try {
          localStorage.setItem(LLM_PROXY_DIAGRAM_WIDTH_PX_KEY, String(w));
        } catch {
          /* ignore */
        }
        return w;
      });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  if (!orgId || !envId) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-gray-500">
            Select a business group and environment to list LLM Proxies.
          </p>
        </div>
        <LlmProxyHelpFooter />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className={`flex shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] ${
            listExpanded ? "w-72" : "w-12"
          }`}
        >
          {!listExpanded ? (
            <div className="flex h-10 shrink-0 items-center justify-center border-b border-gray-100 px-2">
              <button
                type="button"
                onClick={handleToggleList}
                className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Expand LLM Proxies list"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-hidden">
                <LlmProxyList
                  orgId={orgId}
                  envId={envId}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelected}
                  onToggleList={handleToggleList}
                />
              </div>
              <LlmProxyHelpFooter />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          {selected ? (
            <div
              ref={splitContainerRef}
              className="flex h-full min-h-0 w-full min-w-0 flex-row"
            >
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-white">
                <ChatPlayground proxy={selected} onRouteTrace={setRouteTrace} />
              </div>
              {diagramExpanded && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize chat and network diagram"
                  onMouseDown={startDiagramResize}
                  className="group flex w-3 shrink-0 cursor-col-resize items-center justify-center border-l border-r border-gray-200 bg-gray-100 hover:bg-primary/15 active:bg-primary/25"
                >
                  <GripVertical className="pointer-events-none h-4 w-4 text-gray-400 group-hover:text-gray-600" aria-hidden />
                </div>
              )}
              <div
                className={`flex shrink-0 flex-col overflow-hidden bg-gray-50 ${
                  diagramExpanded ? "min-w-0" : "w-11 transition-[width] duration-300 ease-in-out"
                }`}
                style={
                  diagramExpanded
                    ? { width: diagramWidthPx, minWidth: DIAGRAM_WIDTH_MIN_PX }
                    : undefined
                }
              >
                {diagramExpanded ? (
                  <LlmProxyNetworkDiagram
                    proxy={selected}
                    trace={routeTrace}
                    onRequestCollapse={() => handleSetDiagramExpanded(false)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSetDiagramExpanded(true)}
                    className="flex h-full w-full flex-col items-center justify-center gap-2 border-l border-gray-200 bg-gray-100 px-1 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                    title="Show proxy network diagram"
                    aria-label="Show proxy network diagram"
                  >
                    <ChevronsLeft className="h-4 w-4 shrink-0" aria-hidden />
                    <Network className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm font-medium text-gray-800">Select an LLM Proxy</p>
              <p className="max-w-md text-xs leading-relaxed text-gray-500">
                Choose a proxy from the list to open the live chat harness. After each response,
                the network diagram highlights the path Flex Gateway reports via{" "}
                <span className="font-mono text-gray-700">x-llm-proxy-*</span> headers. Drag the
                grip between chat and the diagram to resize; use the chevron on the diagram header
                to collapse it to a slim rail.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
