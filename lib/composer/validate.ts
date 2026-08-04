/**
 * Composer validation: structural (zod) + graph-consistency + cross-reference
 * integrity. Because connections/dependencies/variables are all model-derived,
 * most cross-file checks are guards against serializer/model regressions rather
 * than user error.
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
import { serializeBrokerCard } from "@/lib/composer/a2a-card";
import { deriveA2aCardSecurityFromInterfacePolicies } from "@/lib/composer/a2a-card-security-from-policies";
import { validateAgentNetworkDoc } from "@/lib/composer/schema/network-schema";
import { validateBrokerCardDoc } from "@/lib/composer/schema/a2a-card-schema";
import { validateBrokerCardDeployRequirements } from "@/lib/composer/a2a-card-deploy-requirements";
import { mcpMetaForAsset } from "@/lib/composer/mcp-metadata";

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: IssueSeverity;
  message: string;
  /** Optional pointer for the UI to focus (broker/node/asset). */
  target?: { kind: "asset" | "broker" | "node" | "action" | "project"; id?: string };
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

function err(message: string, target?: ValidationIssue["target"]): ValidationIssue {
  return { severity: "error", message, target };
}
function warn(message: string, target?: ValidationIssue["target"]): ValidationIssue {
  return { severity: "warning", message, target };
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
    issues.push(err(`More than one node is named "${name}". Node names must be unique.`, { kind: "broker", id: broker.id }));
  }
  for (const name of duplicates(broker.actions.map((a) => a.name))) {
    issues.push(err(`More than one action is named "${name}". Action names must be unique.`, { kind: "broker", id: broker.id }));
  }
  for (const name of duplicates(broker.llmBindings.map((b) => b.name))) {
    issues.push(err(`More than one LLM binding is named "${name}". Binding names must be unique.`, { kind: "broker", id: broker.id }));
  }

  if (broker.defaultLlmBindingName && !llmNames.has(broker.defaultLlmBindingName)) {
    issues.push(
      err(`Broker default_llm references unknown LLM binding "${broker.defaultLlmBindingName}".`, {
        kind: "broker",
        id: broker.id,
      })
    );
  }

  // Exactly one trigger.
  const triggers = nodes.filter((n) => n.kind === "trigger");
  if (triggers.length === 0) {
    issues.push(err("Broker has no trigger node (needs exactly one).", { kind: "broker", id: broker.id }));
  } else if (triggers.length > 1) {
    issues.push(err("Broker has more than one trigger (exactly one per interface).", { kind: "broker", id: broker.id }));
  } else {
    const t = triggers[0];
    if (!t.onExitTarget) {
      issues.push(err("Trigger must transition to an initial node.", { kind: "node", id: t.id }));
    }
  }

  // At least one echo (terminal).
  if (!nodes.some((n) => n.kind === "echo")) {
    issues.push(err("Broker has no echo node (needs at least one terminal response).", { kind: "broker", id: broker.id }));
  }

  for (const node of nodes) {
    // Transition targets resolve.
    if (node.onExitTarget && !byId.has(node.onExitTarget)) {
      issues.push(err(`Node "${node.name}" transitions to an unknown node.`, { kind: "node", id: node.id }));
    }
    if (node.onExitTarget) {
      const target = byId.get(node.onExitTarget);
      if (target?.kind === "trigger") {
        issues.push(
          err(`Node "${node.name}" cannot transition back to the trigger.`, { kind: "node", id: node.id })
        );
      }
    }

    if (node.kind === "router") {
      if (!node.routes || node.routes.length === 0) {
        issues.push(err(`Router "${node.name}" needs at least one route.`, { kind: "node", id: node.id }));
      }
      for (const route of node.routes ?? []) {
        if (!byId.has(route.targetNodeId)) {
          issues.push(err(`Router "${node.name}" has a route to an unknown node.`, { kind: "node", id: node.id }));
        }
        if (byId.get(route.targetNodeId)?.kind === "trigger") {
          issues.push(
            err(`Router "${node.name}" cannot route back to the trigger.`, { kind: "node", id: node.id })
          );
        }
        if (!route.when || route.when.trim() === "") {
          issues.push(err(`Router "${node.name}" has a route with an empty condition.`, { kind: "node", id: node.id }));
        } else if (/\r?\n/.test(route.when)) {
          issues.push(
            warn(`Router "${node.name}" has a multi-line condition; it will be folded onto one line on export.`, {
              kind: "node",
              id: node.id,
            })
          );
        }
      }
      if (!node.otherwiseTargetNodeId || !byId.has(node.otherwiseTargetNodeId)) {
        issues.push(err(`Router "${node.name}" needs an "otherwise" target.`, { kind: "node", id: node.id }));
      } else if (byId.get(node.otherwiseTargetNodeId)?.kind === "trigger") {
        issues.push(
          err(`Router "${node.name}" cannot route back to the trigger.`, { kind: "node", id: node.id })
        );
      }
      if (node.onExitTarget) {
        issues.push(warn(`Router "${node.name}" ignores on_exit; use routes/otherwise.`, { kind: "node", id: node.id }));
      }
    }

    if (node.kind === "executor") {
      for (const statement of node.executorStatements ?? []) {
        if (statement.kind === "run" && statement.actionName && !actionNames.has(statement.actionName)) {
          issues.push(
            err(`Executor "${node.name}" references unknown action "${statement.actionName}".`, { kind: "node", id: node.id })
          );
        }
      }
    }

    if ((node.kind === "orchestrator" || node.kind === "subagent") && node.actionBindings) {
      for (const binding of node.actionBindings) {
        if (!actionNames.has(binding.actionName)) {
          issues.push(err(`Node "${node.name}" references unknown action "${binding.actionName}".`, { kind: "node", id: node.id }));
        }
      }
    } else if ((node.kind === "orchestrator" || node.kind === "subagent") && node.actionRefs) {
      for (const ref of node.actionRefs) {
        if (!actionNames.has(ref)) {
          issues.push(err(`Node "${node.name}" references unknown action "${ref}".`, { kind: "node", id: node.id }));
        }
      }
    }

    if (node.llmBindingName && !llmNames.has(node.llmBindingName)) {
      issues.push(err(`Node "${node.name}" references unknown LLM binding "${node.llmBindingName}".`, { kind: "node", id: node.id }));
    }

    if ((node.kind === "generator" || node.kind === "orchestrator" || node.kind === "subagent") && !node.llmBindingName && !broker.defaultLlmBindingName) {
      issues.push(warn(`Node "${node.name}" has no LLM and no broker default_llm.`, { kind: "node", id: node.id }));
    }
  }

  // Nodes the trigger can never reach are dead weight in the exported broker.
  if (triggers.length === 1) {
    const reached = reachableNodeIds(broker);
    for (const node of nodes) {
      if (!reached.has(node.id)) {
        issues.push(
          warn(`Node "${node.name}" is unreachable from the trigger.`, { kind: "node", id: node.id })
        );
      }
    }
  }

  // Actions reference real connections.
  for (const action of broker.actions) {
    if (!connectionNames.has(action.connectionName)) {
      issues.push(err(`Action "${action.name}" targets unknown connection "${action.connectionName}".`, { kind: "action", id: action.id }));
    }
    if (action.actionKind === "mcp:tool" && !action.toolName) {
      issues.push(err(`MCP action "${action.name}" needs a tool_name.`, { kind: "action", id: action.id }));
    }
    if (action.actionKind === "mcp:tool" && action.toolName) {
      const asset = assetByConnectionName(project, action.connectionName);
      const meta = asset ? mcpMetaForAsset(asset) : null;
      if (meta && meta.tools.length > 0 && !meta.tools.some((t) => t.name === action.toolName)) {
        issues.push(
          warn(
            `MCP action "${action.name}" uses tool_name "${action.toolName}" which is not listed for asset "${asset?.assetId}". Refresh MCP tools on the Actions tab.`,
            { kind: "action", id: action.id }
          )
        );
      }
    }
  }

  // LLM bindings reference real llm connections.
  for (const binding of broker.llmBindings) {
    if (!connectionNames.has(binding.connectionName)) {
      issues.push(
        err(`LLM binding "${binding.name}" targets unknown connection "${binding.connectionName}".`, {
          kind: "broker",
          id: binding.id,
        })
      );
    }
  }
}

export function validateProject(project: ComposerProject): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Structural.
  const parsed = ComposerProjectSchema.safeParse(project);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push(err(`${issue.path.join(".") || "project"}: ${issue.message}`, { kind: "project" }));
    }
  }

  // Identity.
  if (!project.identity.name?.trim()) issues.push(err("Project needs a name.", { kind: "project" }));
  if (!project.identity.organizationId?.trim()) issues.push(err("Project needs an organization id (groupId).", { kind: "project" }));
  if (!project.identity.assetId?.trim()) issues.push(err("Project needs an assetId.", { kind: "project" }));
  else if (!isValidExchangeAssetId(project.identity.assetId)) {
    issues.push(err(exchangeAssetIdValidationMessage(project.identity.assetId), { kind: "project" }));
  }

  // Assets.
  for (const asset of project.assets) {
    if (!asset.groupId || !asset.assetId || !asset.version) {
      issues.push(err(`Asset "${asset.name}" is missing GAV coordinates.`, { kind: "asset", id: asset.id }));
    }
    const connId = connectionNameForAsset(asset);
    if (!isValidAnfId(connId)) {
      issues.push(err(anfIdValidationMessage(connId, "Connection ID"), { kind: "asset", id: asset.id }));
    }
    const connKind = CONNECTION_KIND_BY_KIND[asset.kind];
    if (authKindRequiresAuthentication(connKind) && !asset.authentication) {
      issues.push(err(`LLM asset "${asset.name}" requires authentication.`, { kind: "asset", id: asset.id }));
    }
  }

  // Single broker (MVP).
  if (project.brokers.length === 0) {
    issues.push(warn("No broker yet — add one to expose the network over A2A.", { kind: "project" }));
  } else if (project.brokers.length > 1) {
    issues.push(err("MVP supports a single broker per network.", { kind: "project" }));
  }

  const broker = primaryBroker(project);
  if (broker) {
    if (!isValidBrokerKey(broker.name)) {
      issues.push(err(brokerKeyValidationMessage(broker.name), { kind: "broker", id: broker.id }));
    }
    validateBrokerGraph(project, broker, issues);
    const derivedSecurity = deriveA2aCardSecurityFromInterfacePolicies(broker, project) ?? null;
    for (const s of validateBrokerCardDoc(serializeBrokerCard(broker.card, derivedSecurity))) {
      issues.push(err(`Schema (A2A card) at ${s.path}: ${s.message}`, { kind: "broker", id: broker.id }));
    }
    for (const s of validateBrokerCardDeployRequirements(broker.card)) {
      issues.push(err(`Deploy (A2A card) at ${s.path}: ${s.message}`, { kind: "broker", id: broker.id }));
    }
  }

  // Schema-first check: the emitted agent-network.yaml MUST conform to the
  // official Agent Network v2 JSON Schema (the real source of truth).
  for (const s of validateAgentNetworkDoc(buildAgentNetworkDoc(project))) {
    issues.push(err(`Schema (agent-network.yaml) at ${s.path}: ${s.message}`, { kind: "project" }));
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return { ok: errors.length === 0, errors, warnings };
}
