"use client";

import { useReducer, useRef, useEffect, useState } from "react";
import AgentNetworkCanvas from "@/components/AgentNetworkCanvas";
import BrokerUrlBar from "@/components/invoke/BrokerUrlBar";
import ConversationPanel from "@/components/invoke/ConversationPanel";
import {
  invokeReducer,
  INITIAL_INVOKE_STATE,
} from "@/lib/invoke/types";
import { getSkills } from "@/lib/invoke/discovery";
import { buildInvokeGraph } from "@/lib/invoke/graph-builder";
import type { CanonicalGraph } from "@/lib/agent-network-types";
import type { BrokerInEnvironment } from "@/lib/visualizer/brokers-in-environment-types";
import { urlContainsIngressPlaceholder } from "@/lib/invoke/ingress-gateway-url";

const MIN_SIDEBAR = 280;
const MAX_SIDEBAR = 580;
const DEFAULT_SIDEBAR = 380;

interface InvokeTabProps {
  /** Canonical graph from the current platform broker selection (if any). */
  canonicalGraph?: CanonicalGraph | null;
  /** Broker selected in the left sidebar — used to auto-populate the URL bar. */
  selectedBroker?: BrokerInEnvironment | null;
  orgId?: string;
  /** Required with selected broker to resolve `${ingressgw.url}` from API Manager. */
  envId?: string;
}

export default function InvokeTab({ canonicalGraph, selectedBroker, orgId, envId }: InvokeTabProps) {
  const [state, dispatch] = useReducer(invokeReducer, INITIAL_INVOKE_STATE);
  const [suggestedUrl, setSuggestedUrl] = useState<string | null>(null);
  const [suggestedA2aVersion, setSuggestedA2aVersion] = useState<string | null>(null);

  // When the sidebar broker changes, resolve its A2A URL from Exchange.
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
        // Don't pre-fill unresolved Exchange placeholders (needs env + instance for substitution).
        if (urlContainsIngressPlaceholder(data.url)) return;
        setSuggestedUrl(data.url);
      })
      .catch(() => {/* best-effort */});
    return () => { cancelled = true; };
  }, [selectedBroker?.assetId, selectedBroker?.instanceIds, orgId, envId]);

  // Drag-to-resize sidebar
  const sidebarWidthRef = useRef(DEFAULT_SIDEBAR);
  const [sidebarWidth, setSidebarWidth] = useReducerWidth(DEFAULT_SIDEBAR);

  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseMoveRef = useRef<(e: MouseEvent) => void>(() => {});
  const onMouseUpRef = useRef<(e: MouseEvent) => void>(() => {});

  onMouseMoveRef.current = (e: MouseEvent) => {
    if (!isDragging.current) return;
    const delta = startX.current - e.clientX;
    const next = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidth.current + delta));
    sidebarWidthRef.current = next;
    setSidebarWidth(next);
  };

  onMouseUpRef.current = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    document.removeEventListener("mousemove", onMouseMoveRef.current);
    document.removeEventListener("mouseup", onMouseUpRef.current);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  };

  function handleDragStart(e: React.MouseEvent) {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = sidebarWidthRef.current;
    document.addEventListener("mousemove", onMouseMoveRef.current);
    document.addEventListener("mouseup", onMouseUpRef.current);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }

  // Display graph: prefer canonical platform graph; fall back to synthetic from agent card
  const displayGraph: CanonicalGraph | null =
    canonicalGraph ??
    (state.brokerLoaded
      ? buildInvokeGraph(state.agentCard, state.brokerUrl)
      : null);

  const skills = getSkills(state.agentCard);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Canvas */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {displayGraph ? (
          <AgentNetworkCanvas
            graph={displayGraph}
            nodeStatuses={state.nodeStatuses}
            activeNodeId={state.activeNodeId}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center p-8">
            <svg className="h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
            </svg>
            <div>
              <p className="text-sm font-medium text-gray-600">No agent network loaded</p>
              <p className="text-xs text-gray-400 mt-1">
                Select a broker in the left sidebar, or load one by URL →
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        className="w-4 shrink-0 cursor-col-resize self-stretch flex items-center justify-center group"
        title="Drag to resize"
      >
        <div className="w-1 h-full rounded-full bg-gray-200 group-hover:bg-primary group-active:bg-primary/80 transition-colors" />
      </div>

      {/* Right sidebar */}
      <div
        style={{ width: sidebarWidth }}
        className="shrink-0 flex flex-col border-l border-gray-200 bg-white overflow-hidden"
      >
        <BrokerUrlBar
          url={state.brokerUrl}
          loaded={state.brokerLoaded}
          processing={state.isProcessing}
          currentStep={state.currentStep}
          agentCard={state.agentCard}
          suggestedUrl={suggestedUrl}
          suggestedA2aVersion={suggestedA2aVersion}
          dispatch={dispatch}
          resolveContext={
            orgId && envId && selectedBroker?.instanceIds?.[0]
              ? { orgId, envId, apiInstanceId: selectedBroker.instanceIds[0] }
              : undefined
          }
        />

        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {!state.brokerLoaded ? (
            <div className="flex flex-1 items-center justify-center p-4 text-center">
              <p className="text-xs text-gray-400">
                Enter a broker URL above and click <strong>Load</strong> to begin.
              </p>
            </div>
          ) : (
            <ConversationPanel
              state={state}
              skills={skills}
              displayGraph={displayGraph ?? buildInvokeGraph(state.agentCard, state.brokerUrl)}
              dispatch={dispatch}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Tiny hook to avoid useState<number> inside the component while still
// triggering re-renders for the sidebar width.
function useReducerWidth(initial: number): [number, (n: number) => void] {
  const [w, setW] = useReducer((_: number, n: number) => n, initial);
  return [w, setW];
}
