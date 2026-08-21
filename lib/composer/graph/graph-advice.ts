import { helpForNodeKind } from "@/lib/composer/help/help-catalog";
import { connectionNameForAsset } from "@/lib/composer/model";
import type { Broker, ComposerProject, GraphNode } from "@/lib/composer/model";
import { NODE_FIELD } from "@/lib/composer/node-field-issues";
import type { ValidationIssue, ValidationResult } from "@/lib/composer/validation/issue";

export type GraphAdviceTier = "required" | "recommended" | "optional";

export interface GraphAdvice {
  id: string;
  tier: GraphAdviceTier;
  title: string;
  why: string;
  nodeId?: string;
  field?: string;
  focus: {
    tab: "graph";
    nodeId?: string;
    anchor?: string;
  };
}

const CODE_PRIORITY: Record<string, number> = {
  "graph.no-trigger": 100,
  "graph.no-echo": 95,
  "graph.non-terminal-path": 90,
  "graph.node.unreachable": 80,
  "graph.trigger.no-transition": 75,
  "graph.router.no-route": 74,
  "graph.router.no-otherwise": 73,
  "graph.generator.empty-prompt": 72,
  "graph.agent.empty-reasoning": 71,
  "graph.executor.empty-do": 70,
  "graph.echo.empty-message": 69,
  "graph.echo.empty-artifact": 68,
  "graph.echo.progress-no-transition": 67,
  "graph.echo.artifact-no-transition": 66,
  "graph.outputs.unstructured": 60,
};

/** Node kinds whose reasoning result can be shaped into named output fields. */
const STRUCTURED_OUTPUT_KINDS = new Set<GraphNode["kind"]>([
  "generator",
  "orchestrator",
  "subagent",
]);

function tierForIssue(issue: ValidationIssue): GraphAdviceTier {
  if (issue.severity === "error") return "required";
  if (issue.severity === "warning") return "recommended";
  return "optional";
}

function nodeById(broker: Broker, nodeId?: string): GraphNode | undefined {
  if (!nodeId) return undefined;
  return broker.nodes.find((node) => node.id === nodeId);
}

function issueWhy(broker: Broker, issue: ValidationIssue): string {
  const node = nodeById(broker, issue.location.nodeId);
  if (!node) return issue.message;
  return helpForNodeKind(node.kind).whatItDoes;
}

function graphIssues(result: ValidationResult): ValidationIssue[] {
  return result.issues.filter((issue) => issue.location.tab === "graph");
}

function actionUsageCount(broker: Broker, actionName: string): number {
  let count = 0;
  for (const node of broker.nodes) {
    if (node.kind === "executor") {
      for (const statement of node.executorStatements ?? []) {
        if (statement.kind === "run" && statement.actionName === actionName) count += 1;
      }
    }
    for (const binding of node.actionBindings ?? []) {
      if (binding.actionName === actionName) count += 1;
    }
    for (const ref of node.actionRefs ?? []) {
      if (ref === actionName) count += 1;
    }
  }
  return count;
}

export function graphAdvice(
  project: ComposerProject,
  broker: Broker,
  result: ValidationResult
): GraphAdvice[] {
  const advice: GraphAdvice[] = [];
  const seen = new Set<string>();

  for (const issue of graphIssues(result)) {
    const id = `${issue.code}:${issue.location.nodeId ?? "_"}:${issue.location.fieldAnchor ?? "_"}`;
    if (seen.has(id)) continue;
    seen.add(id);
    advice.push({
      id,
      tier: tierForIssue(issue),
      title: issue.message,
      why: issueWhy(broker, issue),
      nodeId: issue.location.nodeId,
      field: issue.location.fieldAnchor,
      focus: {
        tab: "graph",
        ...(issue.location.nodeId ? { nodeId: issue.location.nodeId } : {}),
        ...(issue.location.fieldAnchor ? { anchor: issue.location.fieldAnchor } : {}),
      },
    });
  }

  const trigger = broker.nodes.find((node) => node.kind === "trigger");
  for (const node of broker.nodes) {
    if (!STRUCTURED_OUTPUT_KINDS.has(node.kind)) continue;
    if ((node.outputs?.length ?? 0) > 0) continue;
    const feedsRouter = nodeById(broker, node.onExitTarget)?.kind === "router";
    const firstAfterTrigger = trigger?.onExitTarget === node.id;
    if (!feedsRouter && !firstAfterTrigger) continue;
    advice.push({
      id: `graph.outputs.unstructured:${node.id}`,
      tier: "recommended",
      title: `"${node.name}" returns free text — declare structured outputs.`,
      why: feedsRouter
        ? "Router conditions test named output fields; without them the branch has to parse prose."
        : "Named output fields let a downstream router branch on the classification deterministically.",
      nodeId: node.id,
      focus: { tab: "graph", nodeId: node.id },
    });
  }

  for (const asset of project.assets) {
    if (asset.kind !== "mcp") continue;
    const hasAction = broker.actions.some(
      (action) => action.connectionName === connectionNameForAsset(asset)
    );
    if (!hasAction) {
      advice.push({
        id: `inventory:mcp-action:${asset.id}`,
        tier: "recommended",
        title: `No action targets MCP connection "${asset.name}" yet.`,
        why: "Graph nodes can only call tools through actions.",
        focus: { tab: "graph" },
      });
    }
  }

  for (const action of broker.actions) {
    if (actionUsageCount(broker, action.name) > 0) continue;
    advice.push({
      id: `inventory:unused-action:${action.id}`,
      tier: "optional",
      title: `Action "${action.name}" is configured but unused by graph nodes.`,
      why: "Unused actions increase cognitive load for new builders.",
      focus: { tab: "graph", anchor: NODE_FIELD.actions },
    });
  }

  const score = (item: GraphAdvice): number => {
    const code = item.id.split(":")[0];
    return CODE_PRIORITY[code] ?? 10;
  };
  advice.sort((a, b) => score(b) - score(a));
  return advice;
}
