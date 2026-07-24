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
  connectionNameForAsset,
  primaryBroker,
} from "@/lib/composer/model";
import { brokerKeyValidationMessage, isValidBrokerKey } from "@/lib/composer/broker-key";
import { authKindRequiresAuthentication } from "@/lib/composer/connectivity/auth-catalog";
import { buildAgentNetworkDoc } from "@/lib/composer/serialize/agent-network-yaml";
import { serializeBrokerCard } from "@/lib/composer/a2a-card";
import { validateAgentNetworkDoc } from "@/lib/composer/schema/network-schema";
import { validateBrokerCardDoc } from "@/lib/composer/schema/a2a-card-schema";

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

    if (node.kind === "router") {
      if (!node.routes || node.routes.length === 0) {
        issues.push(err(`Router "${node.name}" needs at least one route.`, { kind: "node", id: node.id }));
      }
      for (const route of node.routes ?? []) {
        if (!byId.has(route.targetNodeId)) {
          issues.push(err(`Router "${node.name}" has a route to an unknown node.`, { kind: "node", id: node.id }));
        }
        if (!route.when || route.when.trim() === "") {
          issues.push(err(`Router "${node.name}" has a route with an empty condition.`, { kind: "node", id: node.id }));
        }
      }
      if (!node.otherwiseTargetNodeId || !byId.has(node.otherwiseTargetNodeId)) {
        issues.push(err(`Router "${node.name}" needs an "otherwise" target.`, { kind: "node", id: node.id }));
      }
      if (node.onExitTarget) {
        issues.push(warn(`Router "${node.name}" ignores on_exit; use routes/otherwise.`, { kind: "node", id: node.id }));
      }
    }

    if (node.kind === "executor" && node.runActionName && !actionNames.has(node.runActionName)) {
      issues.push(err(`Executor "${node.name}" references unknown action "${node.runActionName}".`, { kind: "node", id: node.id }));
    }

    if ((node.kind === "orchestrator" || node.kind === "subagent") && node.actionRefs) {
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

  // Actions reference real connections.
  for (const action of broker.actions) {
    if (!connectionNames.has(action.connectionName)) {
      issues.push(err(`Action "${action.name}" targets unknown connection "${action.connectionName}".`, { kind: "action", id: action.id }));
    }
    if (action.actionKind === "mcp:tool" && !action.toolName) {
      issues.push(err(`MCP action "${action.name}" needs a tool_name.`, { kind: "action", id: action.id }));
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

  // Assets.
  for (const asset of project.assets) {
    if (!asset.groupId || !asset.assetId || !asset.version) {
      issues.push(err(`Asset "${asset.name}" is missing GAV coordinates.`, { kind: "asset", id: asset.id }));
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
    for (const s of validateBrokerCardDoc(serializeBrokerCard(broker.card))) {
      issues.push(err(`Schema (A2A card) at ${s.path}: ${s.message}`, { kind: "broker", id: broker.id }));
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
