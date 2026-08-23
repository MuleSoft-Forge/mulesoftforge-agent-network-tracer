"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LeftSidebar from "@/components/LeftSidebar";
import type { ViewMode } from "@/components/LeftSidebar";
import AgentNetworkCanvas from "@/components/AgentNetworkCanvas";
import ExchangeVersionsPanel from "@/components/ExchangeVersionsPanel";
import ExchangeDiffSummary from "@/components/ExchangeDiffSummary";
import ExchangeFileDiff from "@/components/ExchangeFileDiff";
import type { ExchangeFileEntry } from "@/components/ExchangeFileDiff";
import { exchangeFileEntryKey } from "@/components/ExchangeFileDiff";
import LlmProxyTab from "@/components/llmProxy/LlmProxyTab";
import { AlertTriangle } from "lucide-react";
import BrokerActivityView from "@/components/BrokerActivityView";
import type { TaskQueryHints } from "@/components/TasksList";
import { useBrokersList } from "@/components/main-content/useBrokersList";
import { useFabricGraph } from "@/components/main-content/useFabricGraph";
import { useEnrichedGraph } from "@/components/main-content/useEnrichedGraph";
import { useCanvasResize } from "@/components/main-content/useCanvasResize";
import { useExchangeMode } from "@/components/main-content/useExchangeMode";
import type { ExchangeNetworkSelection } from "@/components/main-content/useExchangeNetworkList";
import type { BrokerInEnvironment } from "@/lib/visualizer/brokers-in-environment-types";
import type { EdgeStyle, NodeFilters, CanvasLayout } from "@/components/CanvasOptionsMenu";
import { beautifyIfJsonPackaging } from "@/lib/json-beautify";
import LineNumberedBlock from "@/components/LineNumberedBlock";
import ExchangeMetadataView from "@/components/ExchangeMetadataView";
import { parseExchangeMetadataFile } from "@/lib/mulesoft/exchange-asset-metadata";
import { writeAnypointUiContext } from "@/lib/anypoint/ui-context";
import HelpButton from "@/components/help/HelpButton";

const DEFAULT_CANVAS_HEIGHT = 60; // 60% of height by default

// Deep-link the "?" to the Tracer help section matching the current view mode.
const HELP_ANCHOR_BY_VIEW: Record<ViewMode, string | undefined> = {
  brokerActivity: undefined,
  exchange: "exchange-versions",
  llmProxy: "llm-proxy",
};

function parseViewModeParam(value: string | null): ViewMode | null {
  if (value === "brokerActivity" || value === "exchange" || value === "llmProxy") return value;
  return null;
}

function ExchangeSingleFileCard({ f }: { f: ExchangeFileEntry }) {
  const metadata = f.content != null ? parseExchangeMetadataFile(f.classifier, f.content) : null;

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
        <span className="text-sm font-mono font-medium text-gray-900">
          {f.classifier}.{f.packaging}
        </span>
      </div>
      {f.content != null ? (
        metadata ? (
          <ExchangeMetadataView metadata={metadata} />
        ) : f.classifier === "agent-network" && f.packaging === "yaml" ? (
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>("brokerActivity");
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
  const [selectedTaskHints, setSelectedTaskHints] = useState<TaskQueryHints | null>(null);
  const [selectedExchangeNetwork, setSelectedExchangeNetwork] =
    useState<ExchangeNetworkSelection | null>(null);
  const [tasksMode, setTasksMode] = useState<string | null>(null);

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
  const { fabricData, error: graphError } = useFabricGraph(orgId, envId);
  const graph = useEnrichedGraph(fabricData, selectedBroker, orgId);
  // Without this, a failed load is indistinguishable from "nothing selected".
  const activityError = error ?? graphError;

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
      writeAnypointUiContext(
        newOrgId ? { orgId: newOrgId, ...(newEnvId ? { envId: newEnvId } : {}) } : null
      );
      if (newOrgId !== prev.orgId) {
        setSelectedExchangeNetwork(null);
      }
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

  const handleTaskSelect = useCallback((taskId: string | null, hints?: TaskQueryHints) => {
    setSelectedTaskId(taskId);
    setSelectedTaskHints(hints ?? null);
  }, []);

  const handleBrokerTasksData = useCallback((data: { mode?: string }) => {
    setTasksMode(data.mode ?? null);
  }, []);

  const handleExchangeNetworkChange = useCallback(
    (network: ExchangeNetworkSelection | null) => {
      setSelectedExchangeNetwork(network);
      exchange.reset({ keepTab: true });
    },
    [exchange]
  );

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      setViewMode(mode);
      if (mode === "brokerActivity") {
        exchange.reset({ keepTab: true });
      } else if (mode === "exchange") {
        setSelectedTaskId(null);
        setTasksMode(null);
        exchange.reset();
        if (selectedBroker?.agentNetworkGav) {
          setSelectedExchangeNetwork((prev) => {
            if (prev) return prev;
            const gav = selectedBroker.agentNetworkGav!;
            return {
              groupId: gav.groupId,
              assetId: gav.assetId,
              name: gav.assetId,
            };
          });
        }
      } else if (mode === "llmProxy") {
        setSelectedTaskId(null);
        setTasksMode(null);
        exchange.reset({ keepTab: true });
      }
      const params = new URLSearchParams(searchParams.toString());
      if (mode === "brokerActivity") {
        params.delete("view");
      } else {
        params.set("view", mode);
      }
      const qs = params.toString();
      router.replace(qs ? `/agent-network?${qs}` : "/agent-network", { scroll: false });
    },
    [exchange, router, searchParams, selectedBroker]
  );

  const initialViewApplied = useRef(false);
  useEffect(() => {
    if (initialViewApplied.current) return;
    const fromUrl = parseViewModeParam(searchParams.get("view"));
    if (!fromUrl || fromUrl === "brokerActivity") {
      initialViewApplied.current = true;
      return;
    }
    initialViewApplied.current = true;
    handleViewModeChange(fromUrl);
  }, [searchParams, handleViewModeChange]);


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
        selectedExchangeNetwork={selectedExchangeNetwork}
        onExchangeNetworkChange={handleExchangeNetworkChange}
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
              onClick={() => handleViewModeChange("brokerActivity")}
              className={`rounded-anypoint-button px-3 py-1.5 text-sm font-medium transition-all duration-200 ease-[cubic-bezier(0.46,0.03,0.52,0.96)] ${
                viewMode === "brokerActivity"
                  ? "bg-gradient-to-r from-primary to-purple-600 text-white shadow-md hover:shadow-lg"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
              aria-label="Broker Activity"
              aria-pressed={viewMode === "brokerActivity"}
            >
              Broker Activity
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
          <HelpButton page="tracer" anchor={HELP_ANCHOR_BY_VIEW[viewMode]} label="Tracer help" />
        </div>

        {viewMode === "brokerActivity" && activityError ? (
          <div
            role="alert"
            className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{activityError}</span>
          </div>
        ) : null}

        {viewMode === "brokerActivity" ? (
          <BrokerActivityView
            graph={graph}
            selectedBroker={selectedBroker}
            orgId={orgId}
            envId={envId}
            selectedTaskId={selectedTaskId}
            selectedTaskHints={selectedTaskHints}
            tasksMode={tasksMode}
            edgeStyle={edgeStyle}
            onEdgeStyleChange={setEdgeStyle}
            layout={layout}
            onLayoutChange={setLayout}
            nodeFilters={nodeFilters}
            onNodeFiltersChange={setNodeFilters}
            contentAreaRef={contentAreaRef}
            canvasHeightPercent={canvasHeightPercent}
            setCanvasHeightPercent={setCanvasHeightPercent}
            handleMouseDown={handleMouseDown}
            defaultCanvasHeight={DEFAULT_CANVAS_HEIGHT}
          />
        ) : viewMode === "llmProxy" ? (
          <LlmProxyTab orgId={orgId} envId={envId} />
        ) : (
          /* ===== EXCHANGE VERSIONS MODE ===== */
          selectedExchangeNetwork ? (
            <div ref={contentAreaRef} className="flex flex-1 overflow-hidden">
              {/* Left: versions panel */}
              <div className="w-72 shrink-0 border-r border-gray-200 bg-white overflow-hidden p-3 flex flex-col">
                <ExchangeVersionsPanel
                  networkGav={selectedExchangeNetwork}
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
                                  Network project files
                                </h4>
                                <p className="text-[11px] text-gray-500 mb-2">
                                  agent-network.yaml, exchange.json and brokers/*.agent from the published project zip, plus agent-network-metadata.json
                                </p>
                                {singleVersionFiles.published.length === 0 ? (
                                  <p className="text-xs text-gray-400 rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2">
                                    No project files found for this version of the agent-network asset.
                                  </p>
                                ) : (
                                  <div className="space-y-3">
                                    {singleVersionFiles.published.map((f, index) => (
                                      <ExchangeSingleFileCard
                                        key={`pub-${exchangeFileEntryKey(f, index)}`}
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
                                  Referenced asset files
                                </h4>
                                <p className="text-[11px] text-gray-500 mb-2">
                                  agent-metadata, mcp-metadata, llm-metadata and a2a-card files from every broker/MCP/LLM asset this network version&apos;s topology references, each at its own referenced version
                                </p>
                                {singleVersionFiles.exchangeAsset.length === 0 ? (
                                  <p className="text-xs text-gray-400 rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2">
                                    No referenced asset files found — this network version may have no
                                    agent-network-metadata.json topology, or its referenced assets publish none.
                                  </p>
                                ) : (
                                  <div className="space-y-3">
                                    {singleVersionFiles.exchangeAsset.map((f, index) => (
                                      <ExchangeSingleFileCard
                                        key={`ex-${exchangeFileEntryKey(f, index)}`}
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
                {orgId
                  ? "Select an agent network to view its Exchange versions"
                  : "Select a business group and agent network to view Exchange versions"}
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
