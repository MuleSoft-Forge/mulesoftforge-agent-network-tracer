/**
 * Composer validation: the single issue producer. Structural (zod) +
 * graph-consistency + cross-reference integrity + schema (yaml, A2A card) +
 * field-completeness are all emitted here as one ValidationIssue[] with stable
 * codes and explicit locations, so every UI surface reads one reconciled set.
 */

import type { Broker, ComposerProject, GraphNode } from "@/lib/composer/model";
import {
  ComposerProjectSchema,
  CONNECTION_KIND_BY_KIND,
  assetByConnectionName,
  connectionNameForAsset,
  primaryBroker,
} from "@/lib/composer/model";
import { brokerKeyValidationMessage, isValidBrokerKey } from "@/lib/composer/broker-key";
import { anfIdValidationMessage, isValidAnfId } from "@/lib/composer/anf-id";
import {
  exchangeAssetIdValidationMessage,
  isValidExchangeAssetId,
} from "@/lib/composer/exchange-asset-id";
import { authKindRequiresAuthentication } from "@/lib/composer/connectivity/auth-catalog";
import { buildAgentNetworkDoc } from "@/lib/composer/serialize/agent-network-yaml";
import { validateAgentNetworkDoc } from "@/lib/composer/schema/network-schema";
import { mcpMetaForAsset } from "@/lib/composer/mcp-metadata";
import { PROJECT_ANCHOR } from "@/lib/composer/project-field-anchors";
import { A2A_CARD_ANCHOR } from "@/lib/composer/a2a-card-field-anchors";
import {
  buildResult,
  type CompletenessTier,
  type IssueLocation,
  type ValidationIssue,
  type ValidationResult,
} from "@/lib/composer/validation/issue";
import { yamlPathToLocation } from "@/lib/composer/validation/schema-location";
import { a2aCardIssues } from "@/lib/composer/validation/a2a-card-issues";
import { NODE_FIELD } from "@/lib/composer/node-field-issues";

// Re-exported for existing importers (components import these from validate).
export type {
  IssueSeverity,
  ValidationIssue,
  ValidationResult,
} from "@/lib/composer/validation/issue";

function err(
  code: string,
  message: string,
  location: IssueLocation,
  tier?: CompletenessTier
): ValidationIssue {
  return { code, message, location, severity: "error", origin: "consistency", tier };
}
function warn(code: string, message: string, location: IssueLocation): ValidationIssue {
  return { code, message, location, severity: "warning", origin: "consistency" };
}

/** Names appearing more than once, in first-seen order. */
function duplicates(names: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) dupes.add(name);
    else seen.add(name);
  }
  return [...dupes];
}

/** Node ids reachable from the trigger via on_exit, routes, and otherwise. */
function reachableNodeIds(broker: Broker): Set<string> {
  const trigger = broker.nodes.find((n) => n.kind === "trigger");
  const reached = new Set<string>();
  if (!trigger) return reached;
  const byId = new Map(broker.nodes.map((n) => [n.id, n]));
  const queue = [trigger.id];
  while (queue.length > 0) {
    const id = queue.pop() as string;
    if (reached.has(id)) continue;
    reached.add(id);
    const node = byId.get(id);
    if (!node) continue;
    const targets = [
      node.onExitTarget,
      node.otherwiseTargetNodeId,
      ...(node.routes ?? []).map((r) => r.targetNodeId),
    ];
    for (const target of targets) {
      if (target && byId.has(target) && !reached.has(target)) queue.push(target);
    }
  }
  return reached;
}

function validateBrokerGraph(
  project: ComposerProject,
  broker: Broker,
  issues: ValidationIssue[]
): void {
  const nodes = broker.nodes;
  const byId = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));
  const connectionNames = new Set(project.assets.map((a) => connectionNameForAsset(a)));
  const actionNames = new Set(broker.actions.map((a) => a.name));
  const llmNames = new Set(broker.llmBindings.map((b) => b.name));

  // Names are the keys in the emitted .agent file, so duplicates silently
  // collapse — the last definition wins and references resolve to the wrong one.
  for (const name of duplicates(nodes.map((n) => n.name))) {
    issues.push(
      err("graph.node.duplicate-name", `More than one node is named "${name}". Node names must be unique.`, {
        tab: "graph",
      })
    );
  }
  for (const name of duplicates(broker.actions.map((a) => a.name))) {
    issues.push(
      err("actions.duplicate-name", `More than one action is named "${name}". Action names must be unique.`, {
        tab: "actions",
      })
    );
  }
  for (const name of duplicates(broker.llmBindings.map((b) => b.name))) {
    issues.push(
      err("llms.duplicate-name", `More than one LLM binding is named "${name}". Binding names must be unique.`, {
        tab: "llms",
      })
    );
  }

  if (broker.defaultLlmBindingName && !llmNames.has(broker.defaultLlmBindingName)) {
    issues.push(
      err(
        "llms.default-unknown",
        `Broker default_llm references unknown LLM binding "${broker.defaultLlmBindingName}".`,
        { tab: "llms" }
      )
    );
  }

  // Exactly one trigger.
  const triggers = nodes.filter((n) => n.kind === "trigger");
  if (triggers.length === 0) {
    issues.push(err("graph.no-trigger", "Broker has no trigger node (needs exactly one).", { tab: "graph" }));
  } else if (triggers.length > 1) {
    issues.push(
      err("graph.multiple-triggers", "Broker has more than one trigger (exactly one per interface).", {
        tab: "graph",
      })
    );
  } else {
    const t = triggers[0];
    if (!t.onExitTarget) {
      issues.push(
        err("graph.trigger.no-transition", "Trigger must transition to an initial node.", {
          tab: "graph",
          nodeId: t.id,
          fieldAnchor: NODE_FIELD.onExit,
        })
      );
    }
  }

  // At least one echo (terminal).
  if (!nodes.some((n) => n.kind === "echo")) {
    issues.push(
      err("graph.no-echo", "Broker has no echo node (needs at least one terminal response).", { tab: "graph" })
    );
  }

  for (const node of nodes) {
    const nodeLoc = (fieldAnchor?: string): IssueLocation => ({ tab: "graph", nodeId: node.id, fieldAnchor });

    // Transition targets resolve.
    if (node.onExitTarget && !byId.has(node.onExitTarget)) {
      issues.push(err("graph.node.unknown-transition", `Node "${node.name}" transitions to an unknown node.`, nodeLoc(NODE_FIELD.onExit)));
    }
    if (node.onExitTarget) {
      const target = byId.get(node.onExitTarget);
      if (target?.kind === "trigger") {
        issues.push(err("graph.node.transition-to-trigger", `Node "${node.name}" cannot transition back to the trigger.`, nodeLoc(NODE_FIELD.onExit)));
      }
    }

    if (node.kind === "router") {
      if (!node.routes || node.routes.length === 0) {
        issues.push(err("graph.router.no-route", `Router "${node.name}" needs at least one route.`, nodeLoc(NODE_FIELD.routes)));
      }
      for (const route of node.routes ?? []) {
        if (!byId.has(route.targetNodeId)) {
          issues.push(err("graph.router.unknown-route", `Router "${node.name}" has a route to an unknown node.`, nodeLoc(NODE_FIELD.routes)));
        }
        if (byId.get(route.targetNodeId)?.kind === "trigger") {
          issues.push(err("graph.router.route-to-trigger", `Router "${node.name}" cannot route back to the trigger.`, nodeLoc(NODE_FIELD.routes)));
        }
        if (!route.when || route.when.trim() === "") {
          issues.push(err("graph.router.empty-condition", `Router "${node.name}" has a route with an empty condition.`, nodeLoc(NODE_FIELD.routes)));
        } else if (/\r?\n/.test(route.when)) {
          issues.push(
            warn(
              "graph.router.multiline-condition",
              `Router "${node.name}" has a multi-line condition; it will be folded onto one line on export.`,
              nodeLoc(NODE_FIELD.routes)
            )
          );
        }
      }
      if (!node.otherwiseTargetNodeId || !byId.has(node.otherwiseTargetNodeId)) {
        issues.push(err("graph.router.no-otherwise", `Router "${node.name}" needs an "otherwise" target.`, nodeLoc(NODE_FIELD.otherwise)));
      } else if (byId.get(node.otherwiseTargetNodeId)?.kind === "trigger") {
        issues.push(err("graph.router.otherwise-to-trigger", `Router "${node.name}" cannot route back to the trigger.`, nodeLoc(NODE_FIELD.otherwise)));
      }
      if (node.onExitTarget) {
        issues.push(warn("graph.router.ignores-on-exit", `Router "${node.name}" ignores on_exit; use routes/otherwise.`, nodeLoc(NODE_FIELD.onExit)));
      }
    }

    if (node.kind === "executor") {
      for (const statement of node.executorStatements ?? []) {
        if (statement.kind === "run" && statement.actionName && !actionNames.has(statement.actionName)) {
          issues.push(err("graph.node.unknown-action", `Executor "${node.name}" references unknown action "${statement.actionName}".`, nodeLoc(NODE_FIELD.actions)));
        }
      }
    }

    if ((node.kind === "orchestrator" || node.kind === "subagent") && node.actionBindings) {
      for (const binding of node.actionBindings) {
        if (!actionNames.has(binding.actionName)) {
          issues.push(err("graph.node.unknown-action", `Node "${node.name}" references unknown action "${binding.actionName}".`, nodeLoc(NODE_FIELD.actions)));
        }
      }
    } else if ((node.kind === "orchestrator" || node.kind === "subagent") && node.actionRefs) {
      for (const ref of node.actionRefs) {
        if (!actionNames.has(ref)) {
          issues.push(err("graph.node.unknown-action", `Node "${node.name}" references unknown action "${ref}".`, nodeLoc(NODE_FIELD.actions)));
        }
      }
    }

    if (node.llmBindingName && !llmNames.has(node.llmBindingName)) {
      issues.push(err("graph.node.unknown-llm", `Node "${node.name}" references unknown LLM binding "${node.llmBindingName}".`, nodeLoc(NODE_FIELD.llm)));
    }

    if ((node.kind === "generator" || node.kind === "orchestrator" || node.kind === "subagent") && !node.llmBindingName && !broker.defaultLlmBindingName) {
      issues.push(warn("graph.node.no-llm", `Node "${node.name}" has no LLM and no broker default_llm.`, nodeLoc(NODE_FIELD.llm)));
    }
  }

  // Nodes the trigger can never reach are dead weight in the exported broker.
  if (triggers.length === 1) {
    const reached = reachableNodeIds(broker);
    for (const node of nodes) {
      if (!reached.has(node.id)) {
        issues.push(warn("graph.node.unreachable", `Node "${node.name}" is unreachable from the trigger.`, { tab: "graph", nodeId: node.id }));
      }
    }
  }

  // Actions reference real connections.
  for (const action of broker.actions) {
    const actionLoc: IssueLocation = { tab: "actions", actionId: action.id };
    if (!connectionNames.has(action.connectionName)) {
      issues.push(err("actions.unknown-connection", `Action "${action.name}" targets unknown connection "${action.connectionName}".`, actionLoc));
    }
    if (action.actionKind === "mcp:tool" && !action.toolName) {
      issues.push(err("actions.mcp.no-tool-name", `MCP action "${action.name}" needs a tool_name.`, actionLoc));
    }
    if (action.actionKind === "mcp:tool" && action.toolName) {
      const asset = assetByConnectionName(project, action.connectionName);
      const meta = asset ? mcpMetaForAsset(asset) : null;
      if (meta && meta.tools.length > 0 && !meta.tools.some((t) => t.name === action.toolName)) {
        issues.push(
          warn(
            "actions.mcp.unknown-tool",
            `MCP action "${action.name}" uses tool_name "${action.toolName}" which is not listed for asset "${asset?.assetId}". Refresh MCP tools on the Actions tab.`,
            actionLoc
          )
        );
      }
    }
  }

  // LLM bindings reference real llm connections.
  for (const binding of broker.llmBindings) {
    if (!connectionNames.has(binding.connectionName)) {
      issues.push(err("llms.unknown-connection", `LLM binding "${binding.name}" targets unknown connection "${binding.connectionName}".`, { tab: "llms" }));
    }
  }
}

export function validateProject(project: ComposerProject): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Structural.
  const parsed = ComposerProjectSchema.safeParse(project);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        code: "schema.model",
        severity: "error",
        origin: "schema",
        message: `${issue.path.join(".") || "project"}: ${issue.message}`,
        location: { tab: "identity" },
      });
    }
  }

  // Identity.
  if (!project.identity.name?.trim()) {
    issues.push(err("identity.name.required", "Project needs a name.", { tab: "identity", fieldAnchor: PROJECT_ANCHOR.name }));
  }
  if (!project.identity.organizationId?.trim()) {
    issues.push(err("identity.org.required", "Project needs an organization id (groupId).", { tab: "identity", fieldAnchor: PROJECT_ANCHOR.organizationId }));
  }
  if (!project.identity.assetId?.trim()) {
    issues.push(err("identity.assetId.required", "Project needs an assetId.", { tab: "identity", fieldAnchor: PROJECT_ANCHOR.assetId }));
  } else if (!isValidExchangeAssetId(project.identity.assetId)) {
    issues.push(err("identity.assetId.invalid", exchangeAssetIdValidationMessage(project.identity.assetId), { tab: "identity", fieldAnchor: PROJECT_ANCHOR.assetId }));
  }

  // Assets.
  for (const asset of project.assets) {
    const assetLoc: IssueLocation = { tab: "assets", assetId: asset.id, fieldAnchor: `asset-${asset.id}` };
    if (!asset.groupId || !asset.assetId || !asset.version) {
      issues.push(err("assets.gav.required", `Asset "${asset.name}" is missing GAV coordinates.`, assetLoc));
    }
    const connId = connectionNameForAsset(asset);
    if (!isValidAnfId(connId)) {
      issues.push(err("assets.connection-id.invalid", anfIdValidationMessage(connId, "Connection ID"), assetLoc));
    }
    const connKind = CONNECTION_KIND_BY_KIND[asset.kind];
    if (authKindRequiresAuthentication(connKind) && !asset.authentication) {
      issues.push(err("assets.auth.required", `LLM asset "${asset.name}" requires authentication.`, assetLoc));
    }
  }

  // Single broker (MVP).
  if (project.brokers.length === 0) {
    issues.push(warn("broker.missing", "No broker yet — add one to expose the network over A2A.", { tab: "a2a-card" }));
  } else if (project.brokers.length > 1) {
    issues.push(err("broker.too-many", "MVP supports a single broker per network.", { tab: "a2a-card" }));
  }

  const broker = primaryBroker(project);
  if (broker) {
    if (!isValidBrokerKey(broker.name)) {
      issues.push(
        err("broker.key.invalid", brokerKeyValidationMessage(broker.name), {
          tab: "a2a-card",
          fieldAnchor: A2A_CARD_ANCHOR.brokerKey,
        })
      );
    }
    validateBrokerGraph(project, broker, issues);
    for (const cardIssue of a2aCardIssues(broker, project)) {
      issues.push(cardIssue);
    }
  }

  // Schema-first check: the emitted agent-network.yaml MUST conform to the
  // official Agent Network v2 JSON Schema (the real source of truth).
  for (const s of validateAgentNetworkDoc(buildAgentNetworkDoc(project))) {
    issues.push({
      code: "schema.yaml",
      severity: "error",
      origin: "schema",
      message: `Schema (agent-network.yaml) at ${s.path}: ${s.message}`,
      location: yamlPathToLocation(s.path, s.message),
    });
  }

  return buildResult(issues);
}
