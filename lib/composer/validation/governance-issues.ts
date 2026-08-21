/**
 * Security-posture rules adapted from MuleSoft's "Agent Network Best Practices"
 * ruleset (Exchange asset agent-network-best-practices 1.0.0). That ruleset
 * binds to the v1 shape — `brokers.*.spec.policies`, `agents.*.metadata.tools`,
 * `schemaVersion: 1.0.0` — so the targets below are re-derived against v2 rather
 * than ported literally. Do not "correct" them back to the published paths.
 *
 * Both are warnings: each flags a permissive setup that still deploys and still
 * passes schema, so blocking export would be wrong.
 */

import type { Broker, ComposerProject } from "@/lib/composer/model";
import type { ValidationIssue } from "@/lib/composer/validation/issue";

function warn(code: string, message: string, location: ValidationIssue["location"]): ValidationIssue {
  return { code, message, location, severity: "warning", origin: "consistency" };
}

/**
 * v2 keeps the binding at `brokers.*.interfaces.a2a.policies.inbound`. Inbound
 * is also the sole input to the card's securitySchemes — see
 * deriveA2aCardSecurityFromInterfacePolicies, which returns undefined on an
 * empty list — so an empty list leaves the network both unprotected and
 * advertising that it needs no credentials.
 */
function inboundPolicyIssues(broker: Broker): ValidationIssue[] {
  if ((broker.interfacePolicies?.inbound?.length ?? 0) > 0) return [];
  return [
    warn(
      "access.inbound-policies.missing",
      "Broker A2A interface has no inbound policies — the front door accepts unauthenticated calls, and the exported card advertises no security schemes to callers.",
      { tab: "access" }
    ),
  ];
}

/**
 * An absent `allowed` means every tool on the server is callable, and the
 * serializer omits the key when the list is empty — so empty and absent are the
 * same posture and both warn.
 *
 * MuleSoft's rego scopes this to broker tools and skips agent metadata tools.
 * v2 inverts that: brokers carry no tool list (they have an AgentScript
 * `implementation`), leaving `registry.agents.*.metadata.tools` as the only
 * place a ToolsRef with `allowed` can appear.
 */
function unrestrictedMcpToolIssues(project: ComposerProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const agent of project.registry?.agents ?? []) {
    for (const tool of agent.metadata.tools ?? []) {
      if (!("mcp" in tool)) continue;
      if ((tool.mcp.allowed?.length ?? 0) > 0) continue;
      issues.push(
        warn(
          "registry.agent.mcp-tools.unrestricted",
          `Agent "${agent.key}" has no allowed list for MCP server "${tool.mcp.ref.name}", so every tool the server exposes is callable. List the tools it actually needs.`,
          { tab: "registry", registry: { kind: "agents", key: agent.key } }
        )
      );
    }
  }
  return issues;
}

export function governanceIssues(
  project: ComposerProject,
  broker: Broker | undefined
): ValidationIssue[] {
  return [...(broker ? inboundPolicyIssues(broker) : []), ...unrestrictedMcpToolIssues(project)];
}
