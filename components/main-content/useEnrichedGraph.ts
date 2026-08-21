import { useEffect, useState } from "react";
import { visualizerToCanonical } from "@/lib/adapters/visualizer-to-canonical";
import type { FabricGraphResponse } from "@/lib/adapters/visualizer-to-canonical";
import { filterVisualizerByBroker } from "@/lib/filters/visualizer-filter";
import { calculateTreeLayout } from "@/lib/layouts/canvas-layouts";
import { enrichCanonicalWithLLMs } from "@/lib/adapters/enrich-with-llms";
import type { CanonicalGraph, CanonicalNode } from "@/lib/agent-network-types";
import type { BrokerInEnvironment } from "@/lib/visualizer/brokers-in-environment-types";
import { debugError, debugLog } from "@/lib/api-logger";

/**
 * Derive the canonical graph for the selected broker: filter the fabric graph,
 * convert to canonical, enrich with LLMs from Exchange metadata, then apply
 * tree layout. Falls back to the un-enriched graph if LLM enrichment fails.
 */
export function useEnrichedGraph(
  fabricData: FabricGraphResponse | null,
  selectedBroker: BrokerInEnvironment | null,
  orgId: string
) {
  const [enrichedGraph, setEnrichedGraph] = useState<CanonicalGraph | null>(null);

  useEffect(() => {
    if (!fabricData || !selectedBroker || !orgId) {
      setEnrichedGraph(null);
      return;
    }

    let cancelled = false;

    const filtered = filterVisualizerByBroker(fabricData, selectedBroker.assetId);
    debugLog("Filtered graph data:", {
      brokerAssetId: selectedBroker.assetId,
      filteredNodes: filtered.nodes?.length ?? 0,
      filteredEdges: filtered.edges?.length ?? 0,
    });

    const canonical = visualizerToCanonical(filtered);

    enrichCanonicalWithLLMs(canonical, orgId)
      .then((enriched) => {
        if (cancelled) return;
        applyTreeLayout(enriched);
        setEnrichedGraph(enriched);
      })
      .catch((err) => {
        if (cancelled) return;
        debugError("Error enriching graph with LLMs:", err);
        applyTreeLayout(canonical);
        setEnrichedGraph(canonical);
      });

    return () => {
      cancelled = true;
    };
  }, [fabricData, selectedBroker, orgId]);

  return enrichedGraph;
}

function applyTreeLayout(g: CanonicalGraph): void {
  const positions = calculateTreeLayout(g);
  g.nodes.forEach((node: CanonicalNode) => {
    const pos = positions.get(node.id);
    if (pos) node.position = pos;
  });
}
