"use client";

import { useState, useEffect, useCallback } from "react";
import { GitCompare, Eye, Check, Loader2 } from "lucide-react";
import Spinner from "@/components/Spinner";
import type { CanonicalGraph } from "@/lib/agent-network-types";
import { exchangeVersionToCanonical, diffGraphs } from "@/lib/adapters/exchange-to-canonical";
import type { GraphDiff } from "@/lib/adapters/exchange-to-canonical";
import type { VersionFiles, ExchangeFileEntry } from "@/components/ExchangeFileDiff";

interface ExchangeVersion {
  version: string;
  createdAt: string | null;
  status: string | null;
}

interface ExchangeVersionsPanelProps {
  orgId: string;
  assetId: string;
  brokerName: string;
  onGraphLoad: (graph: CanonicalGraph | null) => void;
  onDiffResult: (diff: GraphDiff | null, beforeVersion: string, afterVersion: string) => void;
  onCompareGraphs: (before: CanonicalGraph, after: CanonicalGraph) => void;
  onFilesLoaded?: (before: VersionFiles, after: VersionFiles) => void;
  onVersionFilesLoaded?: (versionFiles: VersionFiles) => void;
  onFilesLoadingChange?: (loading: boolean) => void;
}

type CompareSlot = "before" | "after";

const TEXT_PACKAGINGS = new Set(["yaml", "yml", "json", "txt", "xml", "raml"]);
const SKIP_CLASSIFIERS = new Set(["icon"]);

interface AssetFileDescriptor {
  classifier?: string;
  packaging?: string;
  mainFile?: string;
  downloadURL?: string;
  isGenerated?: boolean;
  [key: string]: unknown;
}

async function fetchExchangeFiles(
  orgId: string,
  assetId: string,
  version: string,
  assetData: { organizationId?: string; groupId?: string; files?: AssetFileDescriptor[] }
): Promise<ExchangeFileEntry[]> {
  const textFiles = (assetData.files ?? []).filter(
    (f) =>
      f.classifier &&
      f.packaging &&
      TEXT_PACKAGINGS.has(f.packaging.toLowerCase()) &&
      !SKIP_CLASSIFIERS.has(f.classifier.toLowerCase())
  );

  if (textFiles.length === 0) return [];

  return Promise.all(
    textFiles.map(async (f) => {
      try {
        const params = new URLSearchParams();
        if (f.downloadURL) {
          params.set("downloadURL", f.downloadURL);
        } else {
          const fileOrgId = assetData.groupId || assetData.organizationId || orgId;
          params.set("organizationId", fileOrgId);
          params.set("assetId", assetId);
          params.set("version", version);
          params.set("classifier", f.classifier!);
          params.set("packaging", f.packaging!);
        }

        const res = await fetch(`/api/exchange/file?${params.toString()}`);
        if (!res.ok) return { classifier: f.classifier!, packaging: f.packaging!, content: null };

        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("json")) {
          const data = (await res.json()) as { content?: string };
          return { classifier: f.classifier!, packaging: f.packaging!, content: data.content ?? null };
        }
        const text = await res.text();
        return { classifier: f.classifier!, packaging: f.packaging!, content: text };
      } catch {
        return { classifier: f.classifier!, packaging: f.packaging!, content: null };
      }
    })
  );
}

async function fetchMavenFiles(
  orgId: string,
  assetId: string,
  version: string,
  groupId?: string
): Promise<ExchangeFileEntry[]> {
  try {
    const params = new URLSearchParams({
      organizationId: orgId,
      assetId,
      version,
    });
    if (groupId) params.set("groupId", groupId);

    const res = await fetch(`/api/exchange/maven-files?${params.toString()}`);
    if (!res.ok) return [];

    const data = (await res.json()) as {
      files?: Array<{ classifier: string; packaging: string; content: string | null }>;
    };
    return (data.files ?? []).map((f) => ({
      classifier: f.classifier,
      packaging: f.packaging,
      content: f.content,
    }));
  } catch {
    return [];
  }
}

async function fetchVersionFiles(
  orgId: string,
  assetId: string,
  version: string
): Promise<ExchangeFileEntry[]> {
  const assetRes = await fetch(
    `/api/exchange/asset?organizationId=${encodeURIComponent(orgId)}&assetId=${encodeURIComponent(assetId)}&version=${encodeURIComponent(version)}`
  );
  if (!assetRes.ok) return [];

  const assetData = (await assetRes.json()) as {
    organizationId?: string;
    groupId?: string;
    files?: AssetFileDescriptor[];
  };

  // Fetch Exchange metadata files and Maven agent-network zip in parallel
  const [exchangeFiles, mavenFiles] = await Promise.all([
    fetchExchangeFiles(orgId, assetId, version, assetData),
    fetchMavenFiles(orgId, assetId, version, assetData.groupId || assetData.organizationId),
  ]);

  // Merge: Maven files first (the real network definitions), then Exchange files
  // Deduplicate by classifier name
  const seen = new Set<string>();
  const merged: ExchangeFileEntry[] = [];

  for (const f of mavenFiles) {
    const key = f.classifier;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(f);
    }
  }
  for (const f of exchangeFiles) {
    const key = `${f.classifier}.${f.packaging}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(f);
    }
  }

  return merged;
}

export default function ExchangeVersionsPanel({
  orgId,
  assetId,
  brokerName,
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setVersions([]);
    setSelectedVersion(null);
    setBeforeVersion(null);
    setAfterVersion(null);
    setCompareMode(false);
    onGraphLoad(null);

    fetch(
      `/api/exchange/versions?organizationId=${encodeURIComponent(orgId)}&assetId=${encodeURIComponent(assetId)}`
    )
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string }).error || `Failed: ${res.status}`
          );
        }
        return res.json();
      })
      .then((data: { versions?: ExchangeVersion[] }) => {
        if (cancelled) return;
        setVersions(data.versions ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load versions");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, assetId]);

  const loadVersionGraph = useCallback(
    async (version: string) => {
      setLoadingGraph(true);
      try {
        const graph = await exchangeVersionToCanonical(orgId, assetId, version, brokerName);
        onGraphLoad(graph);
      } catch {
        onGraphLoad(null);
      } finally {
        setLoadingGraph(false);
      }
    },
    [orgId, assetId, brokerName, onGraphLoad]
  );

  const handleViewVersion = useCallback(
    async (version: string) => {
      setSelectedVersion(version);
      setCompareMode(false);
      setBeforeVersion(null);
      setAfterVersion(null);
      onDiffResult(null, "", "");
      onFilesLoadingChange?.(true);
      loadVersionGraph(version);

      if (onVersionFilesLoaded) {
        const files = await fetchVersionFiles(orgId, assetId, version);
        onVersionFilesLoaded({ version, files });
      } else {
        onFilesLoadingChange?.(false);
      }
    },
    [loadVersionGraph, onDiffResult, onVersionFilesLoaded, onFilesLoadingChange, orgId, assetId]
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
    if (!beforeVersion || !afterVersion) return;
    setComparing(true);
    onFilesLoadingChange?.(true);
    try {
      const [beforeGraph, afterGraph, beforeFiles, afterFiles] = await Promise.all([
        exchangeVersionToCanonical(orgId, assetId, beforeVersion, brokerName),
        exchangeVersionToCanonical(orgId, assetId, afterVersion, brokerName),
        fetchVersionFiles(orgId, assetId, beforeVersion),
        fetchVersionFiles(orgId, assetId, afterVersion),
      ]);
      const diff = diffGraphs(beforeGraph, afterGraph);
      onDiffResult(diff, beforeVersion, afterVersion);
      onCompareGraphs(beforeGraph, afterGraph);
      onFilesLoaded?.(
        { version: beforeVersion, files: beforeFiles },
        { version: afterVersion, files: afterFiles }
      );
    } catch {
      onDiffResult(null, beforeVersion, afterVersion);
      onFilesLoadingChange?.(false);
    } finally {
      setComparing(false);
    }
  }, [beforeVersion, afterVersion, orgId, assetId, brokerName, onDiffResult, onCompareGraphs, onFilesLoaded, onFilesLoadingChange]);

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
