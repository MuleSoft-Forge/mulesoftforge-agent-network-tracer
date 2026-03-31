"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import LeftSidebar from "@/components/LeftSidebar";
import type { ViewMode } from "@/components/LeftSidebar";
import AgentNetworkCanvas from "@/components/AgentNetworkCanvas";
import TaskDetails from "@/components/TaskDetails";
import ExchangeVersionsPanel from "@/components/ExchangeVersionsPanel";
import ExchangeDiffSummary from "@/components/ExchangeDiffSummary";
import ExchangeFileDiff from "@/components/ExchangeFileDiff";
import type { VersionFiles } from "@/components/ExchangeFileDiff";
import { useDebugViewer } from "@/components/debug/useDebugViewer";
import { visualizerToCanonical } from "@/lib/adapters/visualizer-to-canonical";
import { filterVisualizerByBroker, filterVisualizerAllBrokers } from "@/lib/filters/visualizer-filter";
import { calculateTreeLayout } from "@/lib/layouts/canvas-layouts";
import { fetchAndMergeRuntimeEdges, ACTIVITY_PERIODS } from "@/lib/visualizer/runtime-edges";
import { enrichCanonicalWithLLMs } from "@/lib/adapters/enrich-with-llms";
import { debugLog, debugError } from "@/lib/api-logger";
import type { BrokerInEnvironment } from "@/lib/visualizer/brokers-in-environment-types";
import type { CanonicalGraph, CanonicalNode } from "@/lib/agent-network-types";
import type { FabricGraphResponse } from "@/lib/adapters/visualizer-to-canonical";
import type { EdgeStyle, NodeFilters, CanvasLayout } from "@/components/CanvasOptionsMenu";
import type { GraphDiff } from "@/lib/adapters/exchange-to-canonical";
import { DEFAULT_ACTIVITY_PERIOD_MINUTES } from "@/lib/constants";

const DEFAULT_CANVAS_HEIGHT = 60; // 60% of height by default

export default function MainContent() {
  const [viewMode, setViewMode] = useState<ViewMode>("activity");
  const [orgId, setOrgId] = useState<string>("");
  const [envId, setEnvId] = useState<string>("");
  const [activityPeriodMinutes, setActivityPeriodMinutes] = useState<number>(
    DEFAULT_ACTIVITY_PERIOD_MINUTES
  );
  const [brokers, setBrokers] = useState<BrokerInEnvironment[]>([]);
  const [selectedBroker, setSelectedBroker] = useState<BrokerInEnvironment | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fabricData, setFabricData] = useState<FabricGraphResponse | null>(null);
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>("straight");
  const [layout, setLayout] = useState<CanvasLayout>("tree");
  const [nodeFilters, setNodeFilters] = useState<NodeFilters>({
    showAgents: true,
    showMCPServers: true,
    showLLM: true,
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [tasksMode, setTasksMode] = useState<string | null>(null);
  const [canvasHeightPercent, setCanvasHeightPercent] = useState<number>(DEFAULT_CANVAS_HEIGHT);
  const [isResizing, setIsResizing] = useState(false);
  const { openDebugViewer } = useDebugViewer();
  const prevOrgEnvRef = useRef<{ orgId: string; envId: string }>({ orgId: "", envId: "" });
  const containerRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  // Exchange mode state
  const [exchangeGraph, setExchangeGraph] = useState<CanonicalGraph | null>(null);
  const [exchangeDiff, setExchangeDiff] = useState<GraphDiff | null>(null);
  const [exchangeDiffVersions, setExchangeDiffVersions] = useState<{ before: string; after: string }>({ before: "", after: "" });
  const [compareBeforeGraph, setCompareBeforeGraph] = useState<CanonicalGraph | null>(null);
  const [compareAfterGraph, setCompareAfterGraph] = useState<CanonicalGraph | null>(null);
  const [compareViewSide, setCompareViewSide] = useState<"before" | "after">("after");
  const [exchangeBeforeFiles, setExchangeBeforeFiles] = useState<VersionFiles | null>(null);
  const [exchangeAfterFiles, setExchangeAfterFiles] = useState<VersionFiles | null>(null);
  const [singleVersionFiles, setSingleVersionFiles] = useState<VersionFiles | null>(null);
  const [exchangeTab, setExchangeTab] = useState<"graph" | "files">("files");
  const [exchangeFilesLoading, setExchangeFilesLoading] = useState(false);

  const handleOrgAndEnvChange = useCallback((newOrgId: string, newEnvId: string) => {
    const prev = prevOrgEnvRef.current;
    const orgChanged = prev.orgId !== newOrgId;
    const envChanged = prev.envId !== newEnvId;
    // Only clear if both prev values were set and one changed (not on initial mount)
    if ((orgChanged || envChanged) && prev.orgId && prev.envId) {
      setBrokers([]);
      setSelectedBroker(null);
      setError(null);
    }
    prevOrgEnvRef.current = { orgId: newOrgId, envId: newEnvId };
    setOrgId(newOrgId);
    setEnvId(newEnvId);
  }, []);

  const handleActivityPeriodChange = useCallback((minutes: number) => {
    setActivityPeriodMinutes(minutes);
    // Don't clear selectedBroker - preserve selection when activity period changes
    // Brokers will be refetched and selection will be restored if broker still exists
    setError(null);
  }, []);

  const handleBrokerChange = useCallback((broker: BrokerInEnvironment | null) => {
    setSelectedBroker(broker);
    setSelectedTaskId(null); // Clear task selection when broker changes
    setTasksMode(null); // Clear until tasks load for new broker
  }, []);

  const handleTaskSelect = useCallback((taskId: string | null) => {
    setSelectedTaskId(taskId);
  }, []);

  const handleBrokerTasksData = useCallback((data: { mode?: string }) => {
    setTasksMode(data.mode ?? null);
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (mode === "exchange") {
      setSelectedTaskId(null);
      setTasksMode(null);
      setExchangeGraph(null);
      setExchangeDiff(null);
      setExchangeDiffVersions({ before: "", after: "" });
      setCompareBeforeGraph(null);
      setCompareAfterGraph(null);
      setExchangeBeforeFiles(null);
      setExchangeAfterFiles(null);
      setSingleVersionFiles(null);
      setExchangeFilesLoading(false);
      setExchangeTab("files");
    } else {
      setExchangeGraph(null);
      setExchangeDiff(null);
      setExchangeBeforeFiles(null);
      setExchangeAfterFiles(null);
      setSingleVersionFiles(null);
      setExchangeFilesLoading(false);
    }
  }, []);

  const handleExchangeGraphLoad = useCallback((graph: CanonicalGraph | null) => {
    if (graph) {
      const positions = calculateTreeLayout(graph);
      graph.nodes.forEach((node: CanonicalNode) => {
        const pos = positions.get(node.id);
        if (pos) node.position = pos;
      });
    }
    setExchangeGraph(graph);
    setExchangeDiff(null);
    setCompareBeforeGraph(null);
    setCompareAfterGraph(null);
    setExchangeBeforeFiles(null);
    setExchangeAfterFiles(null);
  }, []);

  const handleExchangeDiffResult = useCallback((diff: GraphDiff | null, beforeVersion: string, afterVersion: string) => {
    setExchangeDiff(diff);
    setExchangeDiffVersions({ before: beforeVersion, after: afterVersion });
    if (diff) {
      setSingleVersionFiles(null);
    }
  }, []);

  const handleFilesLoaded = useCallback((before: VersionFiles, after: VersionFiles) => {
    setExchangeBeforeFiles(before);
    setExchangeAfterFiles(after);
    setExchangeFilesLoading(false);
  }, []);

  const handleVersionFilesLoaded = useCallback((versionFiles: VersionFiles) => {
    setSingleVersionFiles(versionFiles);
    setExchangeFilesLoading(false);
  }, []);

  const handleFilesLoadingChange = useCallback((loading: boolean) => {
    setExchangeFilesLoading(loading);
  }, []);

  const handleCompareGraphs = useCallback((before: CanonicalGraph, after: CanonicalGraph) => {
    [before, after].forEach((g) => {
      const positions = calculateTreeLayout(g);
      g.nodes.forEach((node: CanonicalNode) => {
        const pos = positions.get(node.id);
        if (pos) node.position = pos;
      });
    });
    setCompareBeforeGraph(before);
    setCompareAfterGraph(after);
    setCompareViewSide("after");
    setExchangeGraph(null);
  }, []);

  // Fetch brokers list
  // Note: Brokers don't change based on activity period - only tasks do
  // So we only refetch when orgId or envId changes, not when activityPeriodMinutes changes
  useEffect(() => {
    if (!orgId || !envId) {
      setBrokers([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      orgId,
      environmentId: envId,
      // activityPeriod removed - brokers list doesn't depend on it
    });
    fetch(`/api/brokers-in-environment?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          const errorMsg = data.error || (res.status === 401 ? "Not signed in" : `Failed: ${res.status}`);
          debugError("[BROKERS] API error:", res.status, errorMsg, data);
          throw new Error(errorMsg);
        }
        return data;
      })
      .then((data: { brokers?: BrokerInEnvironment[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) {
          debugError("[BROKERS] Response contains error:", data.error);
          setError(data.error);
          setBrokers([]);
          // Clear selection if there's an error
          setSelectedBroker(null);
        } else {
          const newBrokers = Array.isArray(data.brokers) ? data.brokers : [];
          setBrokers(newBrokers);
          setError(null);
          debugLog("[BROKERS] Loaded brokers:", newBrokers.length);
          
          // Restore broker selection if previously selected broker still exists
          setSelectedBroker((prevBroker) => {
            if (!prevBroker) return null;
            const stillExists = newBrokers.find((b: BrokerInEnvironment) => b.nodeId === prevBroker.nodeId);
            return stillExists || null;
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          debugError("[BROKERS] Fetch error:", err);
          setBrokers([]);
          setError(err instanceof Error ? err.message : "Failed to load brokers");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, envId]); // Removed activityPeriodMinutes - brokers don't change with activity period

  // Fetch fabric network data
  useEffect(() => {
    if (!orgId || !envId) {
      setFabricData(null);
      return;
    }

    let cancelled = false;
    setError(null);

    const payload = {
      environmentType: null,
      orgIds: [orgId],
    };

    // First fetch fabric-network, then determine environment type and fetch runtime edges
    Promise.all([
      fetch(`/api/visualizer/v2/organizations/${encodeURIComponent(orgId)}/fabric-network`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((res) => {
        if (!res.ok) throw new Error(res.status === 401 ? "Not signed in" : `Failed: ${res.status}`);
        return res.json();
      }),
      // Fetch environment details to determine if it's production
      fetch(`/api/accounts/organizations/${encodeURIComponent(orgId)}/environments`)
        .then((res) => {
          if (!res.ok) return null;
          return res.json();
        })
        .then((data: { data?: Array<{ id: string; isProduction: boolean }> }) => {
          const env = data?.data?.find((e) => String(e.id) === envId);
          return env?.isProduction === true ? "production" : "sandbox";
        })
        .catch(() => "production" as const), // Default to production on error
    ])
      .then(async ([fabricData, environment]) => {
        if (cancelled) return;
        
        // Fetch and merge runtime edges based on selected environment
        // Use 7 days (maximum) for canvas to ensure we show as many connections as possible
        // This prevents empty canvas issues while the Visualizer API settles down
        // Tasks still use the UI activity period setting
        const enrichedData = await fetchAndMergeRuntimeEdges(
          orgId,
          fabricData as FabricGraphResponse,
          ACTIVITY_PERIODS["7d"], // Always use 7 days for canvas
          environment
        );
        
        if (cancelled) return;
        setFabricData(enrichedData);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load graph");
        }
      });

    return () => {
      cancelled = true;
    };
    // Note: Canvas uses fixed 7-day period, so we don't need activityPeriodMinutes in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, envId]);

  // State for enriched canonical graph (with LLMs)
  const [enrichedGraph, setEnrichedGraph] = useState<CanonicalGraph | null>(null);

  // Filter, convert to canonical, and enrich with LLMs - only when broker is selected
  useEffect(() => {
    if (!fabricData || !selectedBroker || !orgId) {
      setEnrichedGraph(null);
      return;
    }

    let cancelled = false;

    // Filter by selected broker
    const filteredData = filterVisualizerByBroker(fabricData, selectedBroker.assetId);

    debugLog("Filtered graph data:", {
      brokerAssetId: selectedBroker.assetId,
      filteredNodes: filteredData.nodes?.length ?? 0,
      filteredEdges: filteredData.edges?.length ?? 0,
      originalNodes: fabricData.nodes?.length ?? 0,
      originalEdges: fabricData.edges?.length ?? 0,
    });

    const canonical = visualizerToCanonical(filteredData);

    debugLog("Canonical graph (before LLM enrichment):", {
      nodes: canonical.nodes.length,
      edges: canonical.edges.length,
      nodeIds: canonical.nodes.map((n) => n.id),
      edgeSources: canonical.edges.map((e) => e.source),
      edgeTargets: canonical.edges.map((e) => e.target),
    });

    // Enrich with LLM nodes and edges from Exchange metadata
    enrichCanonicalWithLLMs(canonical, orgId)
      .then((enriched) => {
        if (cancelled) return;

        debugLog("Canonical graph (after LLM enrichment):", {
          nodes: enriched.nodes.length,
          edges: enriched.edges.length,
          llmNodes: enriched.nodes.filter((n) => n.type === "LLM").length,
          llmEdges: enriched.edges.filter((e) => {
            const sourceNode = enriched.nodes.find((n) => n.id === e.source);
            const targetNode = enriched.nodes.find((n) => n.id === e.target);
            return sourceNode?.type === "BROKER" && targetNode?.type === "LLM";
          }).length,
        });

        // Apply tree layout
        const positions = calculateTreeLayout(enriched);
        enriched.nodes.forEach((node: CanonicalNode) => {
          const pos = positions.get(node.id);
          if (pos) {
            node.position = pos;
          }
        });

        setEnrichedGraph(enriched);
      })
      .catch((error) => {
        if (!cancelled) {
          debugError("Error enriching graph with LLMs:", error);
          // Fallback to canonical without LLMs if enrichment fails
          const positions = calculateTreeLayout(canonical);
          canonical.nodes.forEach((node: CanonicalNode) => {
            const pos = positions.get(node.id);
            if (pos) {
              node.position = pos;
            }
          });
          setEnrichedGraph(canonical);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fabricData, selectedBroker, orgId]);

  const graph = enrichedGraph;

  const handleViewRaw = useCallback(() => {
    if (viewMode === "exchange") {
      const displayGraph = exchangeGraph || (compareViewSide === "before" ? compareBeforeGraph : compareAfterGraph);
      if (!displayGraph) return;
      openDebugViewer({
        data: {
          postCanonical: displayGraph,
          mode: "design",
          ...(exchangeDiff ? { diff: exchangeDiff, beforeVersion: exchangeDiffVersions.before, afterVersion: exchangeDiffVersions.after } : {}),
        },
        apiUrl: `/api/exchange/versions?organizationId=${encodeURIComponent(orgId)}&assetId=${encodeURIComponent(selectedBroker?.assetId ?? "")}`,
        title: "Canvas Data - Exchange Versions",
      });
      return;
    }
    if (!graph || !fabricData) return;
    openDebugViewer({
      data: {
        preCanonical: fabricData,
        postCanonical: graph,
        mode: "runtime",
      },
      apiUrl: `/api/visualizer/v2/organizations/${encodeURIComponent(orgId)}/fabric-network`,
      title: "Canvas Data - Activity",
    });
  }, [viewMode, graph, fabricData, orgId, openDebugViewer, exchangeGraph, compareBeforeGraph, compareAfterGraph, compareViewSide, exchangeDiff, exchangeDiffVersions, selectedBroker]);

  // Handle horizontal splitter resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!contentAreaRef.current) return;
      const contentRect = contentAreaRef.current.getBoundingClientRect();
      const y = e.clientY - contentRect.top;
      const newPercent = Math.max(0, Math.min(95, (y / contentRect.height) * 100));
      setCanvasHeightPercent(newPercent);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

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
          </div>
          {selectedBroker && (viewMode === "activity" ? graph : exchangeGraph || compareAfterGraph) && (
            <button
              type="button"
              onClick={handleViewRaw}
              className="text-xs text-gray-500 hover:text-gray-700 hover:underline focus:outline-none"
            >
              View raw
            </button>
          )}
        </div>
        
        {viewMode === "activity" ? (
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
                        ) : singleVersionFiles && singleVersionFiles.files.length > 0 ? (
                          <div className="space-y-3">
                            <h3 className="text-sm font-semibold text-gray-900">
                              Files — {singleVersionFiles.version}
                            </h3>
                            {singleVersionFiles.files.map((f) => (
                              <div key={`${f.classifier}.${f.packaging}`} className="rounded-lg border border-gray-200 overflow-hidden">
                                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
                                  <span className="text-sm font-mono font-medium text-gray-900">
                                    {f.classifier}.{f.packaging}
                                  </span>
                                </div>
                                {f.content != null ? (
                                  <pre className="p-3 text-xs font-mono text-gray-700 overflow-x-auto whitespace-pre bg-white max-h-96">{f.content}</pre>
                                ) : (
                                  <div className="p-3 text-xs text-gray-400">Unable to load file content</div>
                                )}
                              </div>
                            ))}
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
