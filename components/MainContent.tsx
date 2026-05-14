"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import LeftSidebar from "@/components/LeftSidebar";
import type { ViewMode } from "@/components/LeftSidebar";
import AgentNetworkCanvas from "@/components/AgentNetworkCanvas";
import TaskDetails from "@/components/TaskDetails";
import ExchangeVersionsPanel from "@/components/ExchangeVersionsPanel";
import ExchangeDiffSummary from "@/components/ExchangeDiffSummary";
import ExchangeFileDiff from "@/components/ExchangeFileDiff";
import type { ExchangeFileEntry } from "@/components/ExchangeFileDiff";
import LlmProxyTab from "@/components/llmProxy/LlmProxyTab";
import InvokeTab from "@/components/invoke/InvokeTab";
import { useDebugViewer } from "@/components/debug/useDebugViewer";
import { useBrokersList } from "@/components/main-content/useBrokersList";
import { useFabricGraph } from "@/components/main-content/useFabricGraph";
import { useEnrichedGraph } from "@/components/main-content/useEnrichedGraph";
import { useCanvasResize } from "@/components/main-content/useCanvasResize";
import { useExchangeMode } from "@/components/main-content/useExchangeMode";
import type { BrokerInEnvironment } from "@/lib/visualizer/brokers-in-environment-types";
import type { EdgeStyle, NodeFilters, CanvasLayout } from "@/components/CanvasOptionsMenu";
import { beautifyIfJsonPackaging } from "@/lib/json-beautify";
import LineNumberedBlock from "@/components/LineNumberedBlock";

const DEFAULT_CANVAS_HEIGHT = 60; // 60% of height by default

function ExchangeSingleFileCard({ f }: { f: ExchangeFileEntry }) {
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
        <span className="text-sm font-mono font-medium text-gray-900">
          {f.classifier}.{f.packaging}
        </span>
      </div>
      {f.content != null ? (
        f.classifier === "agent-network" && f.packaging === "yaml" ? (
          <LineNumberedBlock content={f.content} />
        ) : (
          <pre className="p-3 text-xs font-mono text-gray-700 overflow-x-auto whitespace-pre bg-white max-h-96">
            {beautifyIfJsonPackaging(f.packaging, f.content) ?? ""}
          </pre>
        )
      ) : (
        <div className="p-3 text-xs text-gray-400">Unable to load file content</div>
      )}
    </div>
  );
}

export default function MainContent() {
  const [viewMode, setViewMode] = useState<ViewMode>("activity");
  const [orgId, setOrgId] = useState<string>("");
  const [envId, setEnvId] = useState<string>("");
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>("straight");
  const [layout, setLayout] = useState<CanvasLayout>("tree");
  const [nodeFilters, setNodeFilters] = useState<NodeFilters>({
    showAgents: true,
    showMCPServers: true,
    showLLM: true,
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [tasksMode, setTasksMode] = useState<string | null>(null);

  const { openDebugViewer } = useDebugViewer();
  const prevOrgEnvRef = useRef<{ orgId: string; envId: string }>({ orgId: "", envId: "" });
  const containerRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  // Workspace data: brokers list + fabric graph + per-broker enriched canonical graph
  const {
    brokers,
    selectedBroker,
    setSelectedBroker,
    loading,
    error,
    setError,
    setBrokers,
  } = useBrokersList(orgId, envId);
  const { fabricData } = useFabricGraph(orgId, envId);
  const graph = useEnrichedGraph(fabricData, selectedBroker, orgId);

  // Canvas/tasks vertical splitter
  const { canvasHeightPercent, setCanvasHeightPercent, handleMouseDown } =
    useCanvasResize(contentAreaRef, DEFAULT_CANVAS_HEIGHT);

  // Exchange Versions mode owns its own state
  const exchange = useExchangeMode();

  const handleOrgAndEnvChange = useCallback(
    (newOrgId: string, newEnvId: string) => {
      const prev = prevOrgEnvRef.current;
      const changed =
        (prev.orgId !== newOrgId || prev.envId !== newEnvId) && prev.orgId && prev.envId;
    if (changed) {
        setBrokers([]);
        setSelectedBroker(null);
        setError(null);
      }
      prevOrgEnvRef.current = { orgId: newOrgId, envId: newEnvId };
      setOrgId(newOrgId);
      setEnvId(newEnvId);
    },
    [setBrokers, setSelectedBroker, setError]
  );
  

  // Brokers don't depend on activity period (only tasks do), so we just clear errors here.
  const handleActivityPeriodChange = useCallback(
    (_minutes: number) => {
      setError(null);
    },
    [setError]
  );

  const handleBrokerChange = useCallback(
    (broker: BrokerInEnvironment | null) => {
      setSelectedBroker(broker);
      setSelectedTaskId(null);
      setTasksMode(null);
    },
    [setSelectedBroker]
  );

  const handleTaskSelect = useCallback((taskId: string | null) => {
    setSelectedTaskId(taskId);
  }, []);

  const handleBrokerTasksData = useCallback((data: { mode?: string }) => {
    setTasksMode(data.mode ?? null);
  }, []);

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      setViewMode(mode);
      if (mode === "exchange") {
        setSelectedTaskId(null);
        setTasksMode(null);
        exchange.reset();
      } else if (mode === "llmProxy" || mode === "invoke") {
        setSelectedTaskId(null);
        setTasksMode(null);
        exchange.reset({ keepTab: true });
      } else {
        exchange.reset({ keepTab: true });
      }
    },
    [exchange]
  );

  const handleViewRaw = useCallback(() => {
    if (viewMode === "exchange") {
      const displayGraph =
        exchange.exchangeGraph ||
        (exchange.compareViewSide === "before"
          ? exchange.compareBeforeGraph
          : exchange.compareAfterGraph);
      if (!displayGraph) return;
      openDebugViewer({
        data: {
          postCanonical: displayGraph,
          mode: "design",
          ...(exchange.exchangeDiff
            ? {
                diff: exchange.exchangeDiff,
                beforeVersion: exchange.exchangeDiffVersions.before,
                afterVersion: exchange.exchangeDiffVersions.after,
              }
            : {}),
        },
        apiUrl: `/api/exchange/versions?organizationId=${encodeURIComponent(
          orgId
        )}&assetId=${encodeURIComponent(selectedBroker?.assetId ?? "")}`,
        title: "Canvas Data - Exchange Versions",
      });
      return;
    }
    if (!graph || !fabricData) return;
    openDebugViewer({
      data: { preCanonical: fabricData, postCanonical: graph, mode: "runtime" },
      apiUrl: `/api/visualizer/v2/organizations/${encodeURIComponent(orgId)}/fabric-network`,
      title: "Canvas Data - Activity",
    });
  }, [viewMode, graph, fabricData, orgId, openDebugViewer, selectedBroker, exchange]);

  // Bridge exchange-hook fields to the JSX variable names the original return uses.
  const {
    exchangeGraph,
    exchangeDiff,
    exchangeDiffVersions,
    compareBeforeGraph,
    compareAfterGraph,
    compareViewSide,
    setCompareViewSide,
    beforeFiles: exchangeBeforeFiles,
    afterFiles: exchangeAfterFiles,
    singleVersionFiles,
    tab: exchangeTab,
    setTab: setExchangeTab,
    filesLoading: exchangeFilesLoading,
    setFilesLoading: handleFilesLoadingChange,
    handleGraphLoad: handleExchangeGraphLoad,
    handleDiffResult: handleExchangeDiffResult,
    handleFilesLoaded,
    handleVersionFilesLoaded,
    handleCompareGraphs,
  } = exchange;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <LeftSidebar
        viewMode={viewMode}
        onOrgAndEnvChange={handleOrgAndEnvChange}
        onActivityPeriodChange={handleActivityPeriodChange}
        brokers={brokers}
        onBrokerChange={handleBrokerChange}
        selectedTaskId={selectedTaskId}
        onTaskSelect={handleTaskSelect}
        onBrokerTasksData={handleBrokerTasksData}
        loadingBrokers={loading}
      />
      <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden bg-gradient-to-br from-gray-50 via-white to-gray-50">
        {/* Header with Activity button and View raw */}
        <div className="flex items-center justify-between border-b border-gray-200/50 bg-white/80 backdrop-blur-sm px-4 py-2 shadow-sm">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleViewModeChange("invoke")}
              className={`rounded-anypoint-button px-3 py-1.5 text-sm font-medium transition-all duration-200 ease-[cubic-bezier(0.46,0.03,0.52,0.96)] ${
                viewMode === "invoke"
                  ? "bg-gradient-to-r from-primary to-purple-600 text-white shadow-md hover:shadow-lg"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              aria-label="Invoke broker"
              aria-pressed={viewMode === "invoke"}
            >
              Invoke
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange("activity")}
              className={`rounded-anypoint-button px-3 py-1.5 text-sm font-medium transition-all duration-200 ease-[cubic-bezier(0.46,0.03,0.52,0.96)] ${
                viewMode === "activity"
                  ? "bg-gradient-to-r from-primary to-purple-600 text-white shadow-md hover:shadow-lg"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              aria-label="Activity mode"
              aria-pressed={viewMode === "activity"}
            >
              Activity
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange("exchange")}
              className={`rounded-anypoint-button px-3 py-1.5 text-sm font-medium transition-all duration-200 ease-[cubic-bezier(0.46,0.03,0.52,0.96)] ${
                viewMode === "exchange"
                  ? "bg-gradient-to-r from-primary to-purple-600 text-white shadow-md hover:shadow-lg"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              aria-label="Exchange Versions"
              aria-pressed={viewMode === "exchange"}
            >
              Exchange Versions
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange("llmProxy")}
              className={`rounded-anypoint-button px-3 py-1.5 text-sm font-medium transition-all duration-200 ease-[cubic-bezier(0.46,0.03,0.52,0.96)] ${
                viewMode === "llmProxy"
                  ? "bg-gradient-to-r from-primary to-purple-600 text-white shadow-md hover:shadow-lg"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              aria-label="LLM Proxy"
              aria-pressed={viewMode === "llmProxy"}
            >
              LLM Proxy
            </button>
          </div>
          {viewMode !== "llmProxy" && selectedBroker && (viewMode === "activity" ? graph : exchangeGraph || compareAfterGraph) && (
            <button
              type="button"
              onClick={handleViewRaw}
              className="text-xs text-gray-500 hover:text-gray-700 hover:underline focus:outline-none"
            >
              View raw
            </button>
          )}
        </div>
        
        {viewMode === "invoke" ? (
          /* ===== INVOKE MODE ===== */
          <InvokeTab canonicalGraph={graph} selectedBroker={selectedBroker} orgId={orgId} envId={envId} />
        ) : viewMode === "llmProxy" ? (
          /* ===== LLM PROXY MODE ===== */
          <LlmProxyTab orgId={orgId} envId={envId} />
        ) : viewMode === "activity" ? (
          /* ===== ACTIVITY MODE ===== */
          selectedBroker ? (
            <div ref={contentAreaRef} className="flex flex-1 flex-col overflow-hidden">
              <div
                className="overflow-hidden"
                style={{
                  flex: selectedTaskId ? `0 0 ${canvasHeightPercent}%` : "1 1 auto",
                  minHeight: selectedTaskId && canvasHeightPercent > 0 ? "0" : "0",
                  maxHeight: selectedTaskId ? "none" : "none",
                  display: selectedTaskId && canvasHeightPercent === 0 ? "none" : "flex",
                }}
              >
                {graph ? (
                  <AgentNetworkCanvas
                    graph={graph}
                    edgeStyle={edgeStyle}
                    onEdgeStyleChange={setEdgeStyle}
                    layout={layout}
                    onLayoutChange={setLayout}
                    nodeFilters={nodeFilters}
                    onNodeFiltersChange={setNodeFilters}
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
                    className="flex shrink-0 items-center justify-center bg-gray-300 hover:bg-primary transition-colors select-none"
                    style={{ 
                      height: "24px",
                      userSelect: "none",
                      touchAction: "none",
                    }}
                    role="separator"
                    aria-label="Resize canvas and task details"
                    aria-orientation="vertical"
                  >
                    <div
                      onMouseDown={handleMouseDown}
                      className="flex-1 h-full cursor-ns-resize"
                    />
                    <div className="flex items-center gap-1 px-2">
                      <button
                        type="button"
                        onClick={() => setCanvasHeightPercent(canvasHeightPercent === 0 ? DEFAULT_CANVAS_HEIGHT : 0)}
                        className="rounded p-0.5 text-gray-600 hover:bg-gray-400 hover:text-white transition-colors"
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
                    <div
                      onMouseDown={handleMouseDown}
                      className="flex-1 h-full cursor-ns-resize"
                    />
                  </div>
                  <div
                    className="overflow-hidden"
                    style={{
                      flex: `0 0 ${100 - canvasHeightPercent}%`,
                      minHeight: canvasHeightPercent === 0 ? "0" : "200px",
                    }}
                  >
                    <TaskDetails orgId={orgId} taskId={selectedTaskId} envId={envId} apiInstanceId={selectedBroker?.instanceIds?.[0]} skipTraces={tasksMode === "no-entitlement"} />
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-6">
              <p className="text-gray-500">
                {orgId && envId
                  ? "Select a broker to view the network graph"
                  : "Select a business group and environment to view the network graph"}
              </p>
            </div>
          )
        ) : (
          /* ===== EXCHANGE VERSIONS MODE ===== */
          selectedBroker ? (
            <div ref={contentAreaRef} className="flex flex-1 overflow-hidden">
              {/* Left: versions panel */}
              <div className="w-72 shrink-0 border-r border-gray-200 bg-white overflow-hidden p-3 flex flex-col">
                <ExchangeVersionsPanel
                  orgId={orgId}
                  assetId={selectedBroker.assetId}
                  brokerName={selectedBroker.name || selectedBroker.assetId}
                  agentNetworkGav={selectedBroker.agentNetworkGav}
                  onGraphLoad={handleExchangeGraphLoad}
                  onDiffResult={handleExchangeDiffResult}
                  onCompareGraphs={handleCompareGraphs}
                  onFilesLoaded={handleFilesLoaded}
                  onVersionFilesLoaded={handleVersionFilesLoaded}
                  onFilesLoadingChange={handleFilesLoadingChange}
                />
              </div>
              {/* Right: tabs (Files / Graph) + content */}
              <div className="flex flex-1 flex-col overflow-hidden">
                {(exchangeGraph || exchangeDiff || singleVersionFiles || exchangeBeforeFiles || exchangeFilesLoading) ? (
                  <div className="flex flex-1 flex-col overflow-hidden">
                    {/* Tab bar */}
                    <div className="flex items-center gap-1 border-b border-gray-200 bg-white px-4 py-1.5">
                      <button
                        type="button"
                        onClick={() => setExchangeTab("files")}
                        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                          exchangeTab === "files"
                            ? "bg-primary text-white"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        Files
                      </button>
                      <button
                        type="button"
                        onClick={() => setExchangeTab("graph")}
                        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                          exchangeTab === "graph"
                            ? "bg-primary text-white"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        Network Graph
                      </button>
                      {exchangeDiff && (
                        <>
                          <div className="mx-2 h-4 w-px bg-gray-200" />
                          <span className="text-xs font-medium text-gray-500">Graph:</span>
                          <button
                            type="button"
                            onClick={() => { setCompareViewSide("before"); setExchangeTab("graph"); }}
                            className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                              compareViewSide === "before" && exchangeTab === "graph"
                                ? "bg-amber-100 text-amber-800 border border-amber-300"
                                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            }`}
                          >
                            {exchangeDiffVersions.before}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setCompareViewSide("after"); setExchangeTab("graph"); }}
                            className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                              compareViewSide === "after" && exchangeTab === "graph"
                                ? "bg-green-100 text-green-800 border border-green-300"
                                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            }`}
                          >
                            {exchangeDiffVersions.after}
                          </button>
                        </>
                      )}
                    </div>

                    {/* Tab content */}
                    {exchangeTab === "files" ? (
                      <div className="flex-1 overflow-y-auto p-4">
                        {exchangeDiff && exchangeBeforeFiles && exchangeAfterFiles ? (
                          <div className="space-y-4">
                            <ExchangeFileDiff before={exchangeBeforeFiles} after={exchangeAfterFiles} />
                            <ExchangeDiffSummary
                              diff={exchangeDiff}
                              beforeVersion={exchangeDiffVersions.before}
                              afterVersion={exchangeDiffVersions.after}
                            />
                          </div>
                        ) : singleVersionFiles ? (
                          <div className="space-y-6">
                            <h3 className="text-sm font-semibold text-gray-900">
                              Files — {singleVersionFiles.version}
                            </h3>

                            <section className="space-y-2">
                              <div>
                                <h4 className="text-xs font-semibold text-gray-800">
                                  Published artifact (Maven)
                                </h4>
                                <p className="text-[11px] text-gray-500 mb-2">
                                  agent-network.yaml and exchange.json from the agent-network zip
                                </p>
                                {singleVersionFiles.published.length === 0 ? (
                                  <p className="text-xs text-gray-400 rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2">
                                    No Maven files for this version (check agent-network link).
                                  </p>
                                ) : (
                                  <div className="space-y-3">
                                    {singleVersionFiles.published.map((f) => (
                                      <ExchangeSingleFileCard
                                        key={`pub-${f.classifier}.${f.packaging}`}
                                        f={f}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            </section>

                            <section className="space-y-2">
                              <div>
                                <h4 className="text-xs font-semibold text-gray-800">
                                  Exchange asset files
                                </h4>
                                <p className="text-[11px] text-gray-500 mb-2">
                                  Files on the broker asset in Exchange (e.g. a2a-card, agent-metadata)
                                </p>
                                {singleVersionFiles.exchangeAsset.length === 0 ? (
                                  <p className="text-xs text-gray-400 rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2">
                                    No matching Exchange files for this version, or the broker asset does not
                                    publish them at this version.
                                  </p>
                                ) : (
                                  <div className="space-y-3">
                                    {singleVersionFiles.exchangeAsset.map((f) => (
                                      <ExchangeSingleFileCard
                                        key={`ex-${f.classifier}.${f.packaging}`}
                                        f={f}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            </section>
                          </div>
                        ) : exchangeFilesLoading ? (
                          <div className="flex h-full flex-col items-center justify-center gap-2">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-primary" />
                            <p className="text-gray-400 text-sm">Loading files...</p>
                          </div>
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <p className="text-gray-400 text-sm">
                              Select a version to view its files, or compare two versions to see the diff.
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Graph tab */
                      <div className="flex flex-1 flex-col overflow-hidden">
                        <div className="flex-1 overflow-hidden">
                          {exchangeDiff ? (
                            (compareViewSide === "before" ? compareBeforeGraph : compareAfterGraph) ? (
                              <AgentNetworkCanvas
                                key={compareViewSide}
                                graph={(compareViewSide === "before" ? compareBeforeGraph : compareAfterGraph)!}
                                edgeStyle={edgeStyle}
                                onEdgeStyleChange={setEdgeStyle}
                                layout={layout}
                                onLayoutChange={setLayout}
                                nodeFilters={nodeFilters}
                                onNodeFiltersChange={setNodeFilters}
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center">
                                <p className="text-gray-400 text-sm">No graph data available</p>
                              </div>
                            )
                          ) : exchangeGraph ? (
                            <AgentNetworkCanvas
                              graph={exchangeGraph}
                              edgeStyle={edgeStyle}
                              onEdgeStyleChange={setEdgeStyle}
                              layout={layout}
                              onLayoutChange={setLayout}
                              nodeFilters={nodeFilters}
                              onNodeFiltersChange={setNodeFilters}
                            />
                          ) : null}
                        </div>
                        {exchangeDiff && (
                          <div className="shrink-0 border-t border-gray-200 bg-gray-50 p-3 max-h-48 overflow-y-auto">
                            <ExchangeDiffSummary
                              diff={exchangeDiff}
                              beforeVersion={exchangeDiffVersions.before}
                              afterVersion={exchangeDiffVersions.after}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center p-6">
                    <p className="text-gray-500">
                      Select a version to view its files, or compare two versions.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-6">
              <p className="text-gray-500">
                {orgId && envId
                  ? "Select a broker to view its Exchange versions"
                  : "Select a business group, environment, and broker to view Exchange versions"}
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
