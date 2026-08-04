import { useCallback, useState } from "react";
import type { VersionFiles } from "@/components/ExchangeFileDiff";
import { calculateTreeLayout } from "@/lib/layouts/canvas-layouts";
import type { CanonicalGraph, CanonicalNode } from "@/lib/agent-network-types";
import type { GraphDiff } from "@/lib/adapters/exchange-to-canonical";

/**
 * State + callbacks for the Exchange Versions view: single-version files,
 * before/after compare files, diff summaries, and which side of a compare is
 * currently rendered. Splitting this out keeps MainContent focused on
 * workspace state (org/env/broker) and mode switching.
 */
export function useExchangeMode() {
  const [exchangeGraph, setExchangeGraph] = useState<CanonicalGraph | null>(null);
  const [exchangeDiff, setExchangeDiff] = useState<GraphDiff | null>(null);
  const [exchangeDiffVersions, setExchangeDiffVersions] = useState<{ before: string; after: string }>({ before: "", after: "" });
  const [compareBeforeGraph, setCompareBeforeGraph] = useState<CanonicalGraph | null>(null);
  const [compareAfterGraph, setCompareAfterGraph] = useState<CanonicalGraph | null>(null);
  const [compareViewSide, setCompareViewSide] = useState<"before" | "after">("after");
  const [beforeFiles, setBeforeFiles] = useState<VersionFiles | null>(null);
  const [afterFiles, setAfterFiles] = useState<VersionFiles | null>(null);
  const [singleVersionFiles, setSingleVersionFiles] = useState<VersionFiles | null>(null);
  const [tab, setTab] = useState<"graph" | "files">("files");
  const [filesLoading, setFilesLoading] = useState(false);

  const handleGraphLoad = useCallback((graph: CanonicalGraph | null) => {
    if (graph) applyTreeLayout(graph);
    setExchangeGraph(graph);
    setExchangeDiff(null);
    setCompareBeforeGraph(null);
    setCompareAfterGraph(null);
    setBeforeFiles(null);
    setAfterFiles(null);
  }, []);

  const handleDiffResult = useCallback(
    (diff: GraphDiff | null, beforeVersion: string, afterVersion: string) => {
      setExchangeDiff(diff);
      setExchangeDiffVersions({ before: beforeVersion, after: afterVersion });
      if (diff) setSingleVersionFiles(null);
    },
    []
  );

  const handleFilesLoaded = useCallback((before: VersionFiles, after: VersionFiles) => {
    setBeforeFiles(before);
    setAfterFiles(after);
    setFilesLoading(false);
  }, []);

  const handleVersionFilesLoaded = useCallback((files: VersionFiles) => {
    setSingleVersionFiles(files);
    setFilesLoading(false);
  }, []);

  const handleCompareGraphs = useCallback((before: CanonicalGraph, after: CanonicalGraph) => {
    applyTreeLayout(before);
    applyTreeLayout(after);
    setCompareBeforeGraph(before);
    setCompareAfterGraph(after);
    setCompareViewSide("after");
    setExchangeGraph(null);
  }, []);

  /** Clear all state owned by this hook. Called when leaving Exchange mode. */
  const reset = useCallback(
    (opts: { keepTab?: boolean } = {}) => {
      setExchangeGraph(null);
      setExchangeDiff(null);
      setExchangeDiffVersions({ before: "", after: "" });
      setCompareBeforeGraph(null);
      setCompareAfterGraph(null);
      setBeforeFiles(null);
      setAfterFiles(null);
      setSingleVersionFiles(null);
      setFilesLoading(false);
      if (!opts.keepTab) setTab("files");
    },
    []
  );

  return {
    // state
    exchangeGraph,
    exchangeDiff,
    exchangeDiffVersions,
    compareBeforeGraph,
    compareAfterGraph,
    compareViewSide,
    beforeFiles,
    afterFiles,
    singleVersionFiles,
    tab,
    filesLoading,
    // setters used inline by the view
    setCompareViewSide,
    setTab,
    setFilesLoading,
    // callbacks passed to ExchangeVersionsPanel
    handleGraphLoad,
    handleDiffResult,
    handleFilesLoaded,
    handleVersionFilesLoaded,
    handleCompareGraphs,
    reset,
  };
}

function applyTreeLayout(g: CanonicalGraph) {
  const positions = calculateTreeLayout(g);
  g.nodes.forEach((node: CanonicalNode) => {
    const pos = positions.get(node.id);
    if (pos) node.position = pos;
  });
}
