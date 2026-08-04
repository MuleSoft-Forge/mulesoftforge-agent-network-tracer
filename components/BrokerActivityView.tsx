"use client";

import { useReducer, useRef, useEffect, useState, type RefObject } from "react";
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import AgentNetworkCanvas from "@/components/AgentNetworkCanvas";
import BrokerUrlBar from "@/components/invoke/BrokerUrlBar";
import ConversationPanel from "@/components/invoke/ConversationPanel";
import TaskDetails from "@/components/TaskDetails";
import {
  invokeReducer,
  INITIAL_INVOKE_STATE,
} from "@/lib/invoke/types";
import { getSkills } from "@/lib/invoke/discovery";
import { buildInvokeGraph } from "@/lib/invoke/graph-builder";
import type { CanonicalGraph } from "@/lib/agent-network-types";
import type { BrokerInEnvironment } from "@/lib/visualizer/brokers-in-environment-types";
import { urlContainsIngressPlaceholder } from "@/lib/invoke/ingress-gateway-url";
import type { EdgeStyle, NodeFilters, CanvasLayout } from "@/components/CanvasOptionsMenu";

const MIN_INVOKE_PANEL = 280;
const MAX_INVOKE_PANEL = 420;
const DEFAULT_INVOKE_PANEL = 320;
const INVOKE_PANEL_EXPANDED_KEY = "broker-activity-invoke-expanded";
const COLLAPSED_INVOKE_WIDTH = 40;

function getStoredInvokeExpanded(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(INVOKE_PANEL_EXPANDED_KEY) !== "false";
  } catch {
    return true;
  }
}

interface BrokerActivityViewProps {
  graph: CanonicalGraph | null;
  selectedBroker: BrokerInEnvironment | null;
  orgId: string;
  envId: string;
  selectedTaskId: string | null;
  tasksMode: string | null;
  edgeStyle: EdgeStyle;
  onEdgeStyleChange: (style: EdgeStyle) => void;
  layout: CanvasLayout;
  onLayoutChange: (layout: CanvasLayout) => void;
  nodeFilters: NodeFilters;
  onNodeFiltersChange: (filters: NodeFilters) => void;
  contentAreaRef: RefObject<HTMLDivElement | null>;
  canvasHeightPercent: number;
  setCanvasHeightPercent: (n: number) => void;
  handleMouseDown: (e: React.MouseEvent) => void;
  defaultCanvasHeight: number;
}

export default function BrokerActivityView({
  graph,
  selectedBroker,
  orgId,
  envId,
  selectedTaskId,
  tasksMode,
  edgeStyle,
  onEdgeStyleChange,
  layout,
  onLayoutChange,
  nodeFilters,
  onNodeFiltersChange,
  contentAreaRef,
  canvasHeightPercent,
  setCanvasHeightPercent,
  handleMouseDown,
  defaultCanvasHeight,
}: BrokerActivityViewProps) {
  const [invokeState, invokeDispatch] = useReducer(invokeReducer, INITIAL_INVOKE_STATE);
  const [suggestedUrl, setSuggestedUrl] = useState<string | null>(null);
  const [suggestedA2aVersion, setSuggestedA2aVersion] = useState<string | null>(null);
  const [invokePanelExpanded, setInvokePanelExpanded] = useState(true);

  const invokeWidthRef = useRef(DEFAULT_INVOKE_PANEL);
  const [invokePanelWidth, setInvokePanelWidth] = useReducerWidth(DEFAULT_INVOKE_PANEL);

  useEffect(() => {
    setInvokePanelExpanded(getStoredInvokeExpanded());
  }, []);

  function toggleInvokePanel() {
    setInvokePanelExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(INVOKE_PANEL_EXPANDED_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  useEffect(() => {
    if (!selectedBroker || !orgId) {
      setSuggestedUrl(null);
      setSuggestedA2aVersion(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ orgId, assetId: selectedBroker.assetId });
    if (envId) params.set("envId", envId);
    const inst = selectedBroker.instanceIds?.[0];
    if (inst) params.set("apiInstanceId", inst);
    fetch(`/api/invoke/broker-url?${params.toString()}`)
      .then((r) => r.json())
      .then((data: { url?: string | null; protocolVersion?: string | null }) => {
        if (cancelled) return;
        if (data.protocolVersion) setSuggestedA2aVersion(data.protocolVersion);
        if (!data.url) return;
        if (urlContainsIngressPlaceholder(data.url)) return;
        setSuggestedUrl(data.url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedBroker?.assetId, selectedBroker?.instanceIds, orgId, envId]);

  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const onMouseMoveRef = useRef<(e: MouseEvent) => void>(() => {});
  const onMouseUpRef = useRef<(e: MouseEvent) => void>(() => {});

  onMouseMoveRef.current = (e: MouseEvent) => {
    if (!isDragging.current) return;
    const delta = startX.current - e.clientX;
    const next = Math.min(MAX_INVOKE_PANEL, Math.max(MIN_INVOKE_PANEL, startWidth.current + delta));
    invokeWidthRef.current = next;
    setInvokePanelWidth(next);
  };

  onMouseUpRef.current = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    document.removeEventListener("mousemove", onMouseMoveRef.current);
    document.removeEventListener("mouseup", onMouseUpRef.current);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  };

  function handleInvokeResizeStart(e: React.MouseEvent) {
    if (!invokePanelExpanded) return;
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = invokeWidthRef.current;
    document.addEventListener("mousemove", onMouseMoveRef.current);
    document.addEventListener("mouseup", onMouseUpRef.current);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }

  const invokeGraph =
    invokeState.brokerLoaded && !graph
      ? buildInvokeGraph(invokeState.agentCard, invokeState.brokerUrl)
      : null;
  const displayGraph = graph ?? invokeGraph;
  const conversationGraph =
    displayGraph ??
    (invokeState.brokerLoaded
      ? buildInvokeGraph(invokeState.agentCard, invokeState.brokerUrl)
      : null);
  const skills = getSkills(invokeState.agentCard);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Activity — graph + task trace fills main area */}
      <div ref={contentAreaRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selectedBroker ? (
          <>
            <div
              className="overflow-hidden"
              style={{
                flex: selectedTaskId ? `0 0 ${canvasHeightPercent}%` : "1 1 auto",
                minHeight: selectedTaskId && canvasHeightPercent > 0 ? "0" : "0",
                display: selectedTaskId && canvasHeightPercent === 0 ? "none" : "flex",
              }}
            >
              {displayGraph ? (
                <AgentNetworkCanvas
                  graph={displayGraph}
                  edgeStyle={edgeStyle}
                  onEdgeStyleChange={onEdgeStyleChange}
                  layout={layout}
                  onLayoutChange={onLayoutChange}
                  nodeFilters={nodeFilters}
                  onNodeFiltersChange={onNodeFiltersChange}
                  nodeStatuses={invokeState.nodeStatuses}
                  activeNodeId={invokeState.activeNodeId}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center p-6">
                  <p className="text-gray-500">Loading graph...</p>
                </div>
              )}
            </div>

            {selectedTaskId && (
              <>
                <div
                  className="flex shrink-0 select-none items-center justify-center bg-gray-300 transition-colors hover:bg-primary"
                  style={{ height: "24px", userSelect: "none", touchAction: "none" }}
                  role="separator"
                  aria-label="Resize canvas and task details"
                  aria-orientation="horizontal"
                >
                  <div onMouseDown={handleMouseDown} className="h-full flex-1 cursor-ns-resize" />
                  <div className="flex items-center gap-1 px-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCanvasHeightPercent(
                          canvasHeightPercent === 0 ? defaultCanvasHeight : 0
                        )
                      }
                      className="rounded p-0.5 text-gray-600 transition-colors hover:bg-gray-400 hover:text-white"
                      title={canvasHeightPercent === 0 ? "Expand canvas" : "Collapse canvas"}
                      aria-label={canvasHeightPercent === 0 ? "Expand canvas" : "Collapse canvas"}
                    >
                      {canvasHeightPercent === 0 ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronUp className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <div onMouseDown={handleMouseDown} className="h-full flex-1 cursor-ns-resize" />
                </div>
                <div
                  className="overflow-hidden"
                  style={{
                    flex: `0 0 ${100 - canvasHeightPercent}%`,
                    minHeight: canvasHeightPercent === 0 ? "0" : "200px",
                  }}
                >
                  <TaskDetails
                    orgId={orgId}
                    taskId={selectedTaskId}
                    envId={envId}
                    apiInstanceId={selectedBroker.instanceIds?.[0]}
                    skipTraces={tasksMode === "no-entitlement"}
                  />
                </div>
              </>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-6">
            <p className="text-gray-500">
              {orgId && envId
                ? "Select a deployed broker to view activity and the network graph"
                : "Select a business group and environment to get started"}
            </p>
          </div>
        )}
      </div>

      {invokePanelExpanded && (
        <div
          onMouseDown={handleInvokeResizeStart}
          className="flex w-1 shrink-0 cursor-col-resize items-center justify-center self-stretch bg-gray-100 hover:bg-primary/20"
          title="Drag to resize invoke panel"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize invoke panel"
        />
      )}

      {/* Invoke — fixed right rail, collapsible */}
      <div
        style={{ width: invokePanelExpanded ? invokePanelWidth : COLLAPSED_INVOKE_WIDTH }}
        className="flex shrink-0 flex-col border-l border-gray-200 bg-white overflow-hidden transition-[width] duration-200 ease-out"
      >
        <div className="flex h-10 shrink-0 items-center border-b border-gray-100 px-1">
          <button
            type="button"
            onClick={toggleInvokePanel}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label={invokePanelExpanded ? "Collapse invoke panel" : "Expand invoke panel"}
            title={invokePanelExpanded ? "Collapse invoke" : "Expand invoke"}
          >
            {invokePanelExpanded ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
          {invokePanelExpanded && (
            <span className="flex-1 truncate px-2 text-sm font-semibold text-gray-900">Invoke</span>
          )}
        </div>

        {invokePanelExpanded ? (
          <>
            <BrokerUrlBar
              url={invokeState.brokerUrl}
              loaded={invokeState.brokerLoaded}
              processing={invokeState.isProcessing}
              currentStep={invokeState.currentStep}
              agentCard={invokeState.agentCard}
              suggestedUrl={suggestedUrl}
              suggestedA2aVersion={suggestedA2aVersion}
              dispatch={invokeDispatch}
              resolveContext={
                orgId && envId && selectedBroker?.instanceIds?.[0]
                  ? { orgId, envId, apiInstanceId: selectedBroker.instanceIds[0] }
                  : undefined
              }
            />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {!invokeState.brokerLoaded ? (
                <div className="flex flex-1 items-center justify-center p-4 text-center">
                  <p className="text-xs text-gray-400">
                    Enter a broker URL above and click <strong>Load</strong> to invoke, or select a
                    deployed broker to trace activity ←
                  </p>
                </div>
              ) : (
                <ConversationPanel
                  state={invokeState}
                  skills={skills}
                  displayGraph={
                    conversationGraph ??
                    buildInvokeGraph(invokeState.agentCard, invokeState.brokerUrl)
                  }
                  dispatch={invokeDispatch}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center py-4">
            <span
              className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 [writing-mode:vertical-rl]"
              aria-hidden
            >
              Invoke
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function useReducerWidth(initial: number): [number, (n: number) => void] {
  const [w, setW] = useReducer((_: number, n: number) => n, initial);
  return [w, setW];
}
