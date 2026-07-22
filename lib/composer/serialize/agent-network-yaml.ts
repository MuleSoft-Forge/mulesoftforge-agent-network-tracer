import { stringify } from "yaml";
import type { ComposerProject, YamlNetworkInfo } from "@/lib/composer/model";
import { serializeBrokerCard } from "@/lib/composer/a2a-card";
import { deriveConnections, primaryBroker } from "@/lib/composer/model";
import { serializeConnectionAuth } from "@/lib/composer/connectivity/serialize-auth";
import { applyConnectionExtras, serializeConnectionPolicies } from "@/lib/composer/connectivity/connection-extras";
import { serializeContextPolicies } from "@/lib/composer/connectivity/policy-bindings";
import { brokerFileName, brokerKey } from "@/lib/composer/serialize/util";

function yamlInfoToObject(yamlInfo: YamlNetworkInfo | undefined): Record<string, unknown> {
  if (!yamlInfo) return {};
  const out: Record<string, unknown> = {};
  if (yamlInfo.description) out.description = yamlInfo.description;
  if (yamlInfo.summary) out.summary = yamlInfo.summary;
  if (yamlInfo.tags && yamlInfo.tags.length > 0) out.tags = yamlInfo.tags;
  return out;
}

/**
 * Build the agent-network.yaml document as a plain object. This is the exact
 * shape that gets stringified AND schema-validated (see lib/composer/schema),
 * so the validated object and the emitted file never diverge.
 */
export function buildAgentNetworkDoc(project: ComposerProject): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    agentNetwork: "2.0.0",
    info: {
      label: project.identity.name,
      version: project.identity.version,
      ...yamlInfoToObject(project.identity.yamlInfo),
    },
  };

  const connections = deriveConnections(project);
  const contextPolicies = serializeContextPolicies(project);
  if (connections.length > 0 || contextPolicies) {
    const connObj: Record<string, unknown> = {};
    for (const c of connections) {
      const ref: Record<string, unknown> = { name: c.refName };
      if (c.refNamespace) ref.namespace = c.refNamespace;
      const entry: Record<string, unknown> = { kind: c.kind, ref, url: c.url };
      if (c.authentication) {
        entry.authentication = serializeConnectionAuth(c.authentication);
      }
      applyConnectionExtras(entry, c.access, c.policies);
      connObj[c.connectionName] = entry;
    }
    doc.context = {
      ...(connections.length > 0 ? { connections: connObj } : {}),
      ...(contextPolicies ? { policies: contextPolicies } : {}),
    };
  }

  const broker = primaryBroker(project);
  if (broker) {
    const ifaceName = broker.interfaceName || "a2a";
    const ifacePolicies = serializeConnectionPolicies(broker.interfacePolicies);
    const iface: Record<string, unknown> = { card: serializeBrokerCard(broker.card) };
    if (ifacePolicies) iface.policies = ifacePolicies;
    doc.brokers = {
      [brokerKey(broker)]: {
        kind: "AgentScript",
        implementation: `./brokers/${brokerFileName(broker)}`,
        interfaces: {
          [ifaceName]: iface,
        },
      },
    };
  }

  return doc;
}

/** Serialize the model's agent-network.yaml projection (info + connections + broker). */
export function serializeAgentNetworkYaml(project: ComposerProject): string {
  return stringify(buildAgentNetworkDoc(project), { lineWidth: 0 });
}
