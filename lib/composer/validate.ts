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
import { governanceIssues } from "@/lib/composer/validation/governance-issues";
import { NODE_FIELD } from "@/lib/composer/node-field-issues";
import { NODE_NAME_PATTERN } from "@/lib/composer/node-name";
import { AGENTSCRIPT_ACTION_INPUT_TYPES } from "@/lib/composer/agentscript-contract";
import {
  everyPathReachesTerminalEcho,
  reachableNodeIds,
} from "@/lib/composer/graph/reachability";
import { isTerminalEchoNode } from "@/lib/composer/graph-transitions";
const ACTION_INPUT_TYPES = new Set<string>(AGENTSCRIPT_ACTION_INPUT_TYPES);

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
  const agentScriptVariables = broker.agentScriptVariables ?? [];
  const variableByName = new Map(agentScriptVariables.map((variable) => [variable.name, variable]));

  // AgentScript references are namespace-qualified (`@generator.foo`,
  // `@echo.foo`), so names only need to be unique within a node kind.
  for (const reference of duplicates(nodes.map((node) => `${node.kind}:${node.name}`))) {
    const [kind, name] = reference.split(":");
    issues.push(
      err(
        "graph.node.duplicate-name",
        `More than one ${kind} node is named "${name}". Names must be unique within each node kind.`,
        { tab: "graph" }
      )
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
  for (const name of duplicates(agentScriptVariables.map((variable) => variable.name))) {
    issues.push(
      err(
        "variables.duplicate-name",
        `More than one AgentScript variable is named "${name}".`,
        { tab: "behavior" }
      )
    );
  }
  for (const variable of agentScriptVariables) {
    if (!NODE_NAME_PATTERN.test(variable.name)) {
      issues.push(
        err(
          "variables.invalid-name",
          `AgentScript variable "${variable.name}" is not a valid identifier.`,
          { tab: "behavior" }
        )
      );
    }
    if (!ACTION_INPUT_TYPES.has(variable.type)) {
      issues.push(
        err(
          "variables.invalid-type",
          `AgentScript variable "${variable.name}" uses unsupported type "${variable.type}".`,
          { tab: "behavior" }
        )
      );
    }
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

    if (!NODE_NAME_PATTERN.test(node.name)) {
      issues.push(
        err(
          "graph.node.invalid-name",
          `Node "${node.name}" must start with a letter and contain only letters, digits, or underscores.`,
          nodeLoc(NODE_FIELD.name)
        )
      );
    }

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
      const validateAssignment = (statement: {
        variable: string;
      }) => {
        const variable = variableByName.get(statement.variable);
        if (!variable) {
          issues.push(
            err(
              "graph.executor.set-undeclared-variable",
              `Executor "${node.name}" cannot set undeclared variable "${statement.variable}". Add it to AgentScript variables first.`,
              nodeLoc(NODE_FIELD.actions)
            )
          );
        } else if (variable.modifier === "linked") {
          issues.push(
            err(
              "graph.executor.set-linked-variable",
              `Executor "${node.name}" cannot set linked variable "${statement.variable}".`,
              nodeLoc(NODE_FIELD.actions)
            )
          );
        }
      };
      if (!node.executorStatements?.length) {
        issues.push(
          err(
            "graph.executor.empty-do",
            `Executor "${node.name}" needs at least one run or set statement.`,
            nodeLoc(NODE_FIELD.actions)
          )
        );
      }
      for (const statement of node.executorStatements ?? []) {
        if (statement.kind === "run" && statement.actionName && !actionNames.has(statement.actionName)) {
          issues.push(err("graph.node.unknown-action", `Executor "${node.name}" references unknown action "${statement.actionName}".`, nodeLoc(NODE_FIELD.actions)));
        }
        if (
          statement.kind === "run" &&
          statement.withArgs?.some((argument) => /^(?:\.\.\.|…)$/.test(argument.value.trim()))
        ) {
          issues.push(
            err(
              "graph.executor.slot-filling",
              `Executor "${node.name}" cannot use slot filling; every action argument must be fully resolved.`,
              nodeLoc(NODE_FIELD.actions)
            )
          );
        }
        if (statement.kind === "set") {
          validateAssignment(statement);
        } else {
          for (const capture of statement.captures ?? []) {
            validateAssignment(capture);
          }
        }
      }
    }

    if (node.kind === "generator" && !node.prompt?.trim()) {
      issues.push(
        err(
          "graph.generator.empty-prompt",
          `Generator "${node.name}" needs a non-empty prompt.`,
          nodeLoc(NODE_FIELD.prompt)
        )
      );
    }

    if (
      (node.kind === "orchestrator" || node.kind === "subagent") &&
      !node.reasoningInstructions?.trim()
    ) {
      issues.push(
        err(
          "graph.agent.empty-reasoning",
          `${node.kind === "orchestrator" ? "Orchestrator" : "Subagent"} "${node.name}" needs reasoning instructions.`,
          nodeLoc(NODE_FIELD.reasoning)
        )
      );
    }

    if (node.kind === "echo") {
      const echoKind = node.echoKind ?? "a2a:status_update_event";
      if (echoKind === "a2a:status_update_event") {
        if (!node.message?.trim()) {
          issues.push(
            err(
              "graph.echo.empty-message",
              `Status echo "${node.name}" needs a message.`,
              nodeLoc(NODE_FIELD.message)
            )
          );
        }
        if (!isTerminalEchoNode(node) && !node.onExitTarget) {
          issues.push(
            err(
              "graph.echo.progress-no-transition",
              `Non-terminal status echo "${node.name}" must transition to the next node.`,
              nodeLoc(NODE_FIELD.onExit)
            )
          );
        }
      } else {
        if (!node.artifactExpr?.trim()) {
          issues.push(
            err(
              "graph.echo.empty-artifact",
              `Artifact echo "${node.name}" needs an a2a.artifact() expression.`,
              nodeLoc(NODE_FIELD.message)
            )
          );
        }
        if (!node.onExitTarget) {
          issues.push(
            err(
              "graph.echo.artifact-no-transition",
              `Artifact echo "${node.name}" must transition to a terminal status echo.`,
              nodeLoc(NODE_FIELD.onExit)
            )
          );
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
    if (!everyPathReachesTerminalEcho(broker, triggers[0].id)) {
      issues.push(
        err(
          "graph.non-terminal-path",
          "Every trigger path must reach a completed, failed, canceled, or rejected status echo.",
          { tab: "graph", nodeId: triggers[0].id }
        )
      );
    }
  }

  // Actions reference real connections.
  for (const action of broker.actions) {
    const actionLoc: IssueLocation = { tab: "actions", actionId: action.id };
    if (!NODE_NAME_PATTERN.test(action.name)) {
      issues.push(
        err(
          "actions.invalid-name",
          `Action "${action.name}" must start with a letter and contain only letters, digits, or underscores.`,
          actionLoc
        )
      );
    }
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
    if (action.httpHeaders?.length) {
      issues.push(
        err(
          "actions.legacy-http-headers",
          `Action "${action.name}" has unsupported definition-level http_headers. Add http_headers to each invocation binding instead.`,
          actionLoc
        )
      );
    }
    for (const input of action.inputs ?? []) {
      if (!NODE_NAME_PATTERN.test(input.name)) {
        issues.push(
          err(
            "actions.input.invalid-name",
            `Action "${action.name}" input "${input.name}" is not a valid AgentScript identifier.`,
            actionLoc
          )
        );
      }
      if (!ACTION_INPUT_TYPES.has(input.type)) {
        issues.push(
          err(
            "actions.input.invalid-type",
            `Action "${action.name}" input "${input.name}" uses unsupported type "${input.type}".`,
            actionLoc
          )
        );
      }
    }
  }

  if (broker.agentDialectVersion && !/^\d+(?:\.\d+)?$/.test(broker.agentDialectVersion)) {
    issues.push(
      err(
        "broker.dialect-version.invalid",
        "AgentFabric dialect version must be a major or major.minor number, for example 1 or 1.0.",
        { tab: "behavior" }
      )
    );
  }

  for (const binding of broker.llmBindings) {
    if (
      binding.temperature !== undefined &&
      (binding.temperature < 0 || binding.temperature > 2)
    ) {
      issues.push(
        err(
          "llms.temperature.range",
          `LLM binding "${binding.name}" needs temperature between 0 and 2.`,
          { tab: "llms" }
        )
      );
    }
    if (binding.topP !== undefined && (binding.topP < 0 || binding.topP > 1)) {
      issues.push(
        err(
          "llms.top-p.range",
          `LLM binding "${binding.name}" needs top_p between 0 and 1.`,
          { tab: "llms" }
        )
      );
    }
    for (const parameter of Object.keys(binding.params ?? {})) {
      issues.push(
        err(
          "llms.unknown-parameter",
          `LLM binding "${binding.name}" contains unsupported parameter "${parameter}".`,
          { tab: "llms" }
        )
      );
    }
    if (
      binding.provider === "OpenAI" &&
      (binding.thinkingLevel !== undefined ||
        binding.thinkingBudget !== undefined ||
        binding.responseLogprobs !== undefined)
    ) {
      issues.push(
        err(
          "llms.openai.gemini-fields",
          `OpenAI binding "${binding.name}" contains Gemini-only tuning fields.`,
          { tab: "llms" }
        )
      );
    }
    if (
      binding.provider === "Gemini" &&
      (binding.reasoningEffort !== undefined || binding.topLogprobs !== undefined)
    ) {
      issues.push(
        err(
          "llms.gemini.openai-fields",
          `Gemini binding "${binding.name}" contains OpenAI-only tuning fields.`,
          { tab: "llms" }
        )
      );
    }
    if (
      binding.provider === "Gemini" &&
      binding.thinkingBudget !== undefined &&
      binding.thinkingBudget < 0
    ) {
      issues.push(
        err(
          "llms.gemini.negative-thinking-budget",
          `Gemini binding "${binding.name}" needs a thinking budget of zero or greater because the pinned AgentFabric validator rejects documented -1 automatic mode.`,
          { tab: "llms" }
        )
      );
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

  // The Builder intentionally authors one broker per project.
  if (project.brokers.length === 0) {
    issues.push(warn("broker.missing", "No broker yet — add one to expose the network over A2A.", { tab: "a2a-card" }));
  } else if (project.brokers.length > 1) {
    issues.push(
      err(
        "broker.too-many",
        "Builder projects intentionally support exactly one broker; split additional brokers into separate Builder projects.",
        { tab: "a2a-card" }
      )
    );
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

  // Security posture: permissive-by-default configurations that still deploy.
  for (const governanceIssue of governanceIssues(project, broker)) {
    issues.push(governanceIssue);
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
