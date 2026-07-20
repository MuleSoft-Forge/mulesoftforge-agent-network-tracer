/**
 * Exchange version list, file fetch, and compare for v1 and v2 agent-network assets.
 * Uses agent-network-metadata when published, with v1 yaml + exchange.json fallback.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { GitCompare, Eye, Check, Loader2 } from "lucide-react";
import Spinner from "@/components/Spinner";
import type { CanonicalGraph } from "@/lib/agent-network-types";
import { exchangeNetworkToCanonical, diffGraphs } from "@/lib/adapters/exchange-to-canonical";
import type { GraphDiff } from "@/lib/adapters/exchange-to-canonical";
import type { VersionFiles, ExchangeFileEntry } from "@/components/ExchangeFileDiff";
import {
  EXCHANGE_AGENT_NETWORK_CLASSIFIERS,
  parseExchangeMetadataFile,
  type AgentNetworkMetadata,
} from "@/lib/mulesoft/exchange-asset-metadata";
import {
  projectVersionLabel,
  type AgentNetworkProjectVersion,
} from "@/lib/mulesoft/agent-network-project-version";
import {
  collectTopologyRefs,
  findProjectSourcesInFiles,
  resolveNetworkTopology,
  type NetworkTopology,
} from "@/lib/mulesoft/exchange-network-topology";

interface ExchangeVersion {
  version: string;
  createdAt: string | null;
  status: string | null;
}

interface ExchangeVersionsPanelProps {
  /** Published agent-network asset on Exchange (BG-scoped, not per-environment). */
  networkGav: { groupId: string; assetId: string; name: string };
  onGraphLoad: (graph: CanonicalGraph | null) => void;
  onDiffResult: (diff: GraphDiff | null, beforeVersion: string, afterVersion: string) => void;
  onCompareGraphs: (before: CanonicalGraph, after: CanonicalGraph) => void;
  onFilesLoaded?: (before: VersionFiles, after: VersionFiles) => void;
  onVersionFilesLoaded?: (versionFiles: VersionFiles) => void;
  onFilesLoadingChange?: (loading: boolean) => void;
}

type CompareSlot = "before" | "after";

interface ResolvedExchangeAsset {
  groupId: string;
  assetId: string;
  name: string;
  versions: ExchangeVersion[];
}

async function fetchNetworkVersions(network: {
  groupId: string;
  assetId: string;
  name: string;
}): Promise<ResolvedExchangeAsset> {
  const res = await fetch(
    `/api/exchange/versions?organizationId=${encodeURIComponent(network.groupId)}&assetId=${encodeURIComponent(network.assetId)}`
  );
  if (!res.ok) {
    throw new Error(`Failed to load Exchange versions (${res.status})`);
  }
  const data = (await res.json()) as {
    name?: string;
    versions?: ExchangeVersion[];
  };
  return {
    groupId: network.groupId,
    assetId: network.assetId,
    name: data.name ?? network.name,
    versions: data.versions ?? [],
  };
}

/**
 * `files[]` entry as returned by `GET /api/exchange/asset` (a passthrough of
 * Exchange's real `GET /exchange/api/v2/assets/{groupId}/{assetId}/{version}`).
 * Ground-truthed against a real published agent-network asset: every version
 * carries a non-fat project zip (classifier `agent-network` on legacy v1
 * projects, `agentic-network` on current ones), a `fat-*` self-contained
 * duplicate of that same zip, a `pom`, and an `agent-network-metadata.json`
 * topology file listing every broker/registry asset this version references
 * (each with its own exact groupId/assetId/version) — that reference list is
 * what drives fetching the per-broker/MCP/LLM metadata files below, instead of
 * guessing that a broker's own asset shares the network's version.
 */
interface ExchangeAssetFile {
  classifier?: string | null;
  packaging?: string;
  downloadURL?: string;
}

async function fetchAssetFiles(
  groupId: string,
  assetId: string,
  version: string
): Promise<ExchangeAssetFile[]> {
  try {
    const params = new URLSearchParams({ organizationId: groupId, assetId, version });
    const res = await fetch(`/api/exchange/asset?${params.toString()}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { files?: ExchangeAssetFile[] };
    return data.files ?? [];
  } catch {
    return [];
  }
}

function isFatClassifier(classifier: string | null | undefined): boolean {
  return (classifier ?? "").toLowerCase().startsWith("fat-");
}

/** The one non-fat zip holding the real project sources (agent-network.yaml, exchange.json, brokers/*.agent). */
function findProjectZip(files: ExchangeAssetFile[]): ExchangeAssetFile | undefined {
  return files.find(
    (f) =>
      f.packaging === "zip" &&
      !isFatClassifier(f.classifier) &&
      (f.classifier === "agent-network" || f.classifier === "agentic-network" || f.classifier === "broker-group")
  );
}

/** All classifiers with connections/card content worth surfacing — see lib/mulesoft/exchange-asset-metadata.ts. */
const BROKER_FILE_CLASSIFIERS = new Set<string>(
  EXCHANGE_AGENT_NETWORK_CLASSIFIERS.filter(
    (c) => c !== "agent-network" && c !== "agentic-network" && c !== "mcp" && c !== "broker-group"
  )
);

function isBrokerExchangeListFile(f: {
  classifier?: string | null;
  packaging?: string;
}): boolean {
  const c = (f.classifier ?? "").toLowerCase();
  const p = (f.packaging ?? "").toLowerCase();
  if (!["json", "yaml", "yml"].includes(p)) return false;
  return BROKER_FILE_CLASSIFIERS.has(c);
}

/** The non-fat metadata JSON files on an asset (a2a-card, agent-metadata, mcp-metadata, llm-metadata, agent-network-metadata, ...). */
function findMetadataJsonFiles(files: ExchangeAssetFile[]): ExchangeAssetFile[] {
  return files.filter((f) => !isFatClassifier(f.classifier) && isBrokerExchangeListFile(f));
}

async function downloadAssetFile(f: ExchangeAssetFile): Promise<ExchangeFileEntry | null> {
  if (!f.downloadURL || !f.classifier || !f.packaging) return null;
  try {
    const params = new URLSearchParams({
      downloadURL: f.downloadURL,
      classifier: f.classifier,
      packaging: f.packaging,
    });
    const res = await fetch(`/api/exchange/file?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string };
    return { classifier: f.classifier, packaging: f.packaging, content: data.content ?? null };
  } catch {
    return null;
  }
}

/** Downloads and unzips the project zip, returning each entry (agent-network.yaml, exchange.json, brokers/*.agent) as a file. */
async function downloadProjectZipFiles(f: ExchangeAssetFile): Promise<ExchangeFileEntry[]> {
  if (!f.downloadURL) return [];
  try {
    const params = new URLSearchParams({ downloadURL: f.downloadURL, classifier: f.classifier ?? "project" });
    const res = await fetch(`/api/exchange/extract-zip?${params.toString()}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { files?: Array<{ filename: string; content: string }> };
    return (data.files ?? []).map((entry) => {
      const dot = entry.filename.lastIndexOf(".");
      return {
        classifier: dot > 0 ? entry.filename.slice(0, dot) : entry.filename,
        packaging: dot > 0 ? entry.filename.slice(dot + 1) : "txt",
        content: entry.content,
      };
    });
  } catch {
    return [];
  }
}

async function fetchNetworkOwnFiles(
  agentNetworkInfo: { assetId: string; groupId: string } | null | undefined,
  version: string
): Promise<{
  files: ExchangeFileEntry[];
  networkMetadata: AgentNetworkMetadata | null;
  topology: NetworkTopology;
  projectVersion: AgentNetworkProjectVersion;
}> {
  if (!agentNetworkInfo) {
    return {
      files: [],
      networkMetadata: null,
      topology: { projectVersion: "unknown", brokers: [], registry: [] },
      projectVersion: "unknown",
    };
  }

  const assetFiles = await fetchAssetFiles(agentNetworkInfo.groupId, agentNetworkInfo.assetId, version);
  const projectZip = findProjectZip(assetFiles);
  const metadataFiles = findMetadataJsonFiles(assetFiles);

  const [zipFiles, metadataEntries] = await Promise.all([
    projectZip ? downloadProjectZipFiles(projectZip) : Promise.resolve([]),
    Promise.all(metadataFiles.map(downloadAssetFile)),
  ]);

  const resolvedMetadataEntries = metadataEntries.filter((e): e is ExchangeFileEntry => e !== null);
  const networkMetadataEntry = resolvedMetadataEntries.find((e) => e.classifier === "agent-network-metadata");
  const parsedMetadata = networkMetadataEntry
    ? parseExchangeMetadataFile("agent-network-metadata", networkMetadataEntry.content)
    : null;
  const networkMetadata =
    parsedMetadata?.fileKind === "agent-network-metadata" ? parsedMetadata : null;

  const sources = findProjectSourcesInFiles(zipFiles, projectZip?.classifier ?? null);
  const topology = resolveNetworkTopology({ networkMetadata, sources });

  return {
    files: [...zipFiles, ...resolvedMetadataEntries],
    networkMetadata,
    topology,
    projectVersion: topology.projectVersion,
  };
}

/**
 * Metadata files from every broker/MCP/LLM asset the resolved topology references.
 */
async function fetchReferencedAssetFiles(topology: NetworkTopology): Promise<ExchangeFileEntry[]> {
  const refs = collectTopologyRefs(topology);

  const perAsset = await Promise.all(
    refs.map(async (ref) => {
      const files = await fetchAssetFiles(ref.groupId, ref.assetId, ref.version);
      const downloaded = await Promise.all(findMetadataJsonFiles(files).map(downloadAssetFile));
      return downloaded
        .filter((e): e is ExchangeFileEntry => e !== null)
        .map((entry) => ({
          ...entry,
          sourceRef: {
            groupId: ref.groupId,
            assetId: ref.assetId,
            version: ref.version,
          },
        }));
    })
  );

  return perAsset.flat();
}

async function loadVersionContext(
  version: string,
  agentNetworkInfo: { assetId: string; groupId: string; name: string }
): Promise<{
  topology: NetworkTopology;
  projectVersion: AgentNetworkProjectVersion;
  versionFiles: VersionFiles;
}> {
  const { files: published, topology, projectVersion } = await fetchNetworkOwnFiles(
    agentNetworkInfo,
    version
  );
  const exchangeAsset = await fetchReferencedAssetFiles(topology);
  return {
    topology,
    projectVersion,
    versionFiles: { version, published, exchangeAsset },
  };
}

async function loadVersionGraph(
  version: string,
  agentNetworkInfo: { groupId: string; assetId: string; name: string },
  topology: NetworkTopology
): Promise<CanonicalGraph | null> {
  try {
    return await exchangeNetworkToCanonical(topology, {
      groupId: agentNetworkInfo.groupId,
      assetId: agentNetworkInfo.assetId,
      name: agentNetworkInfo.name,
      version,
    });
  } catch {
    return null;
  }
}

export default function ExchangeVersionsPanel({
  networkGav,
  onGraphLoad,
  onDiffResult,
  onCompareGraphs,
  onFilesLoaded,
  onVersionFilesLoaded,
  onFilesLoadingChange,
}: ExchangeVersionsPanelProps) {
  const [versions, setVersions] = useState<ExchangeVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [beforeVersion, setBeforeVersion] = useState<string | null>(null);
  const [afterVersion, setAfterVersion] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [resolvedNetworkAsset, setResolvedNetworkAsset] = useState<{
    assetId: string;
    groupId: string;
    name: string;
  } | null>(null);
  const [viewingProjectVersion, setViewingProjectVersion] =
    useState<AgentNetworkProjectVersion | null>(null);

  useEffect(() => {
    if (!networkGav.groupId || !networkGav.assetId) {
      setVersions([]);
      setLoading(false);
      setError("No agent-network asset selected");
      setResolvedNetworkAsset(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setVersions([]);
    setSelectedVersion(null);
    setBeforeVersion(null);
    setAfterVersion(null);
    setCompareMode(false);
    setResolvedNetworkAsset(null);
    setViewingProjectVersion(null);
    onGraphLoad(null);

    fetchNetworkVersions(networkGav)
      .then((resolved) => {
        if (cancelled) return;
        setVersions(resolved.versions);
        setResolvedNetworkAsset({
          assetId: resolved.assetId,
          groupId: resolved.groupId,
          name: resolved.name,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load versions");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkGav.groupId, networkGav.assetId, networkGav.name]);

  const agentNetworkAsset = resolvedNetworkAsset;

  const handleViewVersion = useCallback(
    async (version: string) => {
      if (!agentNetworkAsset) return;
      setSelectedVersion(version);
      setCompareMode(false);
      setBeforeVersion(null);
      setAfterVersion(null);
      onDiffResult(null, "", "");
      onFilesLoadingChange?.(true);
      setLoadingGraph(true);

      try {
        const ctx = await loadVersionContext(version, agentNetworkAsset);
        setViewingProjectVersion(ctx.projectVersion);
        const graph = await loadVersionGraph(version, agentNetworkAsset, ctx.topology);
        onGraphLoad(graph);
        if (onVersionFilesLoaded) {
          onVersionFilesLoaded(ctx.versionFiles);
        } else {
          onFilesLoadingChange?.(false);
        }
      } catch {
        onGraphLoad(null);
        onFilesLoadingChange?.(false);
      } finally {
        setLoadingGraph(false);
      }
    },
    [
      agentNetworkAsset,
      onDiffResult,
      onVersionFilesLoaded,
      onFilesLoadingChange,
      onGraphLoad,
    ]
  );

  const handleCompareSelect = useCallback(
    (version: string, slot: CompareSlot) => {
      if (slot === "before") {
        setBeforeVersion(version);
      } else {
        setAfterVersion(version);
      }
    },
    []
  );

  const runComparison = useCallback(async () => {
    if (!beforeVersion || !afterVersion || !agentNetworkAsset) return;
    setComparing(true);
    onFilesLoadingChange?.(true);
    try {
      const [beforeCtx, afterCtx] = await Promise.all([
        loadVersionContext(beforeVersion, agentNetworkAsset),
        loadVersionContext(afterVersion, agentNetworkAsset),
      ]);
      const [beforeGraph, afterGraph] = await Promise.all([
        loadVersionGraph(beforeVersion, agentNetworkAsset, beforeCtx.topology),
        loadVersionGraph(afterVersion, agentNetworkAsset, afterCtx.topology),
      ]);
      if (!beforeGraph || !afterGraph) {
        onDiffResult(null, beforeVersion, afterVersion);
        onFilesLoadingChange?.(false);
        return;
      }
      const diff = diffGraphs(beforeGraph, afterGraph);
      onDiffResult(diff, beforeVersion, afterVersion);
      onCompareGraphs(beforeGraph, afterGraph);
      onFilesLoaded?.(beforeCtx.versionFiles, afterCtx.versionFiles);
      setViewingProjectVersion(afterCtx.projectVersion);
    } catch {
      onDiffResult(null, beforeVersion, afterVersion);
      onFilesLoadingChange?.(false);
    } finally {
      setComparing(false);
    }
  }, [
    beforeVersion,
    afterVersion,
    agentNetworkAsset,
    onDiffResult,
    onCompareGraphs,
    onFilesLoaded,
    onFilesLoadingChange,
  ]);

  const toggleCompareMode = useCallback(() => {
    const next = !compareMode;
    setCompareMode(next);
    if (next) {
      setSelectedVersion(null);
      onGraphLoad(null);
    } else {
      setBeforeVersion(null);
      setAfterVersion(null);
      onDiffResult(null, "", "");
    }
  }, [compareMode, onGraphLoad, onDiffResult]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4">
        <Spinner size="s" />
        <span className="text-sm text-gray-500">Loading versions...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="p-4">
        <p className="text-sm text-gray-500">No versions found for this asset.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {agentNetworkAsset && (
        <div className="shrink-0 rounded-md bg-indigo-50 border border-indigo-200 px-2.5 py-1.5">
          <p className="text-[10px] text-indigo-600 font-medium">Agent Network</p>
          <p className="text-xs text-indigo-900 font-semibold truncate">{agentNetworkAsset.name}</p>
          <p className="text-[10px] text-indigo-400 truncate">{agentNetworkAsset.assetId}</p>
          {viewingProjectVersion && viewingProjectVersion !== "unknown" && (
            <p className="mt-1 text-[10px] font-medium text-indigo-700">
              {projectVersionLabel(viewingProjectVersion)}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center justify-between shrink-0">
        <h3 className="text-sm font-semibold text-gray-900">
          Versions ({versions.length})
        </h3>
        <button
          type="button"
          onClick={toggleCompareMode}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            compareMode
              ? "bg-primary text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          <GitCompare className="h-3.5 w-3.5" />
          Compare
        </button>
      </div>

      {compareMode && (
        <div className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-indigo-700 w-12">Before:</span>
            <select
              value={beforeVersion ?? ""}
              onChange={(e) => handleCompareSelect(e.target.value, "before")}
              className="flex-1 rounded border border-indigo-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select version</option>
              {versions.map((v) => (
                <option key={v.version} value={v.version} disabled={v.version === afterVersion}>
                  {v.version}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-indigo-700 w-12">After:</span>
            <select
              value={afterVersion ?? ""}
              onChange={(e) => handleCompareSelect(e.target.value, "after")}
              className="flex-1 rounded border border-indigo-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select version</option>
              {versions.map((v) => (
                <option key={v.version} value={v.version} disabled={v.version === beforeVersion}>
                  {v.version}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={runComparison}
            disabled={!beforeVersion || !afterVersion || comparing}
            className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1.5"
          >
            {comparing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Comparing...
              </>
            ) : (
              <>
                <GitCompare className="h-3.5 w-3.5" />
                Compare Versions
              </>
            )}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
        {versions.map((v) => {
          const isSelected = selectedVersion === v.version;
          const isBefore = beforeVersion === v.version;
          const isAfter = afterVersion === v.version;

          return (
            <div
              key={v.version}
              className={`group flex items-center justify-between rounded-lg border px-3 py-2 transition-all ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : isBefore
                    ? "border-amber-400 bg-amber-50"
                    : isAfter
                      ? "border-green-400 bg-green-50"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {v.version}
                  </span>
                  {v.status && (
                    <span
                      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        v.status === "published"
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {v.status}
                    </span>
                  )}
                  {(isBefore || isAfter) && (
                    <span
                      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        isBefore
                          ? "bg-amber-100 text-amber-700"
                          : "bg-green-100 text-green-700"
                      }`}
                    >
                      {isBefore ? "before" : "after"}
                    </span>
                  )}
                </div>
                {v.createdAt && (
                  <span className="text-[10px] text-gray-400 truncate">
                    {new Date(v.createdAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                )}
              </div>
              {!compareMode && (
                <button
                  type="button"
                  onClick={() => handleViewVersion(v.version)}
                  disabled={loadingGraph}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    isSelected
                      ? "bg-primary text-white"
                      : "bg-gray-100 text-gray-600 opacity-0 group-hover:opacity-100 hover:bg-gray-200"
                  }`}
                >
                  {isSelected ? (
                    loadingGraph ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  {isSelected ? "Viewing" : "View"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
