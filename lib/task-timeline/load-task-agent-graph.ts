import type { Graph } from "@sf-agentscript/agentfabric-dialect";
import { extractAgentFabricGraph } from "@/lib/composer/agentscript-graph";
import { fetchComparableProjectEntries } from "@/lib/mulesoft/exchange-project-sources";
import {
  chooseVersionForTask,
  resolveAgentEntry,
  type ExchangeAssetVersion,
} from "@/lib/task-timeline/resolve-agent-source";

/**
 * Load the published AgentScript graph a task ran against.
 *
 * The graph state in the Object Store carries a runtime projection of the network
 * (`session_unified_spec`), but the `.agent` source published to Exchange is the
 * definition itself — the same thing the Composer renders — so drawing from it
 * keeps the task view and the designer in agreement instead of maintaining a
 * second, subtly different diagram.
 */


export interface TaskAgentGraph {
  graph: Graph;
  /** Which published file the diagram was drawn from. */
  agentFileName: string;
  brokerKey?: string;
  /** Asset version the diagram was drawn from. */
  version: string;
  /**
   * False when the version was inferred from the task's start time rather than
   * reported by the task, so the view can warn that the definition may have
   * changed since the run.
   */
  versionPinned: boolean;
  parseErrors: string[];
}

/** Newest version published at or before the task ran. */
async function resolveVersion(
  orgId: string,
  assetId: string,
  taskStartedAtMs?: number
): Promise<string> {
  const params = new URLSearchParams({ organizationId: orgId, assetId });
  const res = await fetch(`/api/exchange/versions?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`No published Exchange asset was found for "${assetId}" (${res.status}).`);
  }
  const data = (await res.json()) as { versions?: ExchangeAssetVersion[] };
  const chosen = chooseVersionForTask(data.versions ?? [], taskStartedAtMs);
  if (chosen === null) {
    throw new Error(`The Exchange asset "${assetId}" has no published versions.`);
  }
  return chosen;
}

/**
 * Fetch and parse the graph for one asset version. Throws with a user-facing
 * message; the Graph view surfaces it verbatim rather than falling back to a
 * different source, so an unavailable definition is visibly unavailable instead of
 * quietly replaced by an approximation.
 */
export async function loadTaskAgentGraph(params: {
  orgId: string;
  assetId: string;
  version: string;
  versionPinned: boolean;
  /** Every name this task knows its broker by. */
  candidateNames: string[];
}): Promise<TaskAgentGraph> {
  const entries = await fetchComparableProjectEntries(params.orgId, params.assetId, params.version);
  const resolved = resolveAgentEntry(entries, params.candidateNames);
  if (resolved.entry === null) {
    throw new Error(resolved.reason ?? "Could not locate the network's AgentScript source.");
  }

  const { graph, parseErrors } = await extractAgentFabricGraph(resolved.entry.content);
  if (graph === null) {
    throw new Error(
      parseErrors.length > 0
        ? `The published AgentScript source could not be parsed: ${parseErrors[0]}`
        : "The published AgentScript source could not be parsed."
    );
  }

  return {
    graph,
    agentFileName: resolved.entry.filename,
    ...(resolved.brokerKey != null ? { brokerKey: resolved.brokerKey } : {}),
    version: params.version,
    versionPinned: params.versionPinned,
    parseErrors,
  };
}

/**
 * A task knows its broker by several ids (API asset, CloudHub app) and only one of
 * them owns the published project zip, so candidates are tried in order and the
 * first that yields a graph wins. The last failure is reported when none do,
 * because that message is what the view shows the user.
 */
export async function loadFirstAvailableTaskAgentGraph(params: {
  orgId: string;
  assetIds: string[];
  /** Version the task reported, when it has one. */
  pinnedVersion?: string;
  /** Task start, used to infer the version that was live when it ran. */
  taskStartedAtMs?: number;
  candidateNames: string[];
}): Promise<TaskAgentGraph> {
  const expandedAssetIds = Array.from(
    new Set(
      [...params.assetIds, ...params.candidateNames]
        .map((value) => value.trim())
        .filter((value) => value !== "")
    )
  );

  if (expandedAssetIds.length === 0) {
    throw new Error(
      "This task does not carry an Exchange asset id, so the published graph cannot be located."
    );
  }

  let lastError: Error | null = null;
  for (const assetId of expandedAssetIds) {
    try {
      const version =
        params.pinnedVersion ?? (await resolveVersion(params.orgId, assetId, params.taskStartedAtMs));
      return await loadTaskAgentGraph({
        orgId: params.orgId,
        assetId,
        version,
        versionPinned: params.pinnedVersion != null,
        candidateNames: params.candidateNames,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("Could not load the network's AgentScript source.");
}
