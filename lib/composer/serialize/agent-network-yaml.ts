import { stringify } from "yaml";
import type { ComposerProject, YamlNetworkInfo } from "@/lib/composer/model";
import { serializeBrokerCard } from "@/lib/composer/a2a-card";
import { deriveA2aCardSecurityFromInterfacePolicies } from "@/lib/composer/a2a-card-security-from-policies";
import { deriveConnections, primaryBroker } from "@/lib/composer/model";
import { serializeConnectionAuth } from "@/lib/composer/connectivity/serialize-auth";
import { applyConnectionExtras, serializeConnectionPolicies } from "@/lib/composer/connectivity/connection-extras";
import { serializeContextPolicies } from "@/lib/composer/connectivity/policy-bindings";
import { serializeNetworkRegistry } from "@/lib/composer/registry/serialize";
import { brokerFileName, brokerKey } from "@/lib/composer/serialize/util";

function yamlInfoToObject(yamlInfo: YamlNetworkInfo | undefined): Record<string, unknown> {
  if (!yamlInfo) return {};
  const out: Record<string, unknown> = {};
  // version is emitted from info.version directly; skip duplicate here.
  if (yamlInfo.description) out.description = yamlInfo.description;
  if (yamlInfo.summary) out.summary = yamlInfo.summary;
  if (yamlInfo.tags && yamlInfo.tags.length > 0) out.tags = yamlInfo.tags;
  if (yamlInfo.termsOfService) out.termsOfService = yamlInfo.termsOfService;
  if (yamlInfo.contact && (yamlInfo.contact.name || yamlInfo.contact.url || yamlInfo.contact.email)) {
    out.contact = {
      ...(yamlInfo.contact.name ? { name: yamlInfo.contact.name } : {}),
      ...(yamlInfo.contact.url ? { url: yamlInfo.contact.url } : {}),
      ...(yamlInfo.contact.email ? { email: yamlInfo.contact.email } : {}),
    };
  }
  if (yamlInfo.license?.name) {
    out.license = {
      name: yamlInfo.license.name,
      ...(yamlInfo.license.identifier ? { identifier: yamlInfo.license.identifier } : {}),
      ...(yamlInfo.license.url ? { url: yamlInfo.license.url } : {}),
    };
  }
  return out;
}

/**
 * Build the agent-network.yaml document as a plain object. This is the exact
 * shape that gets stringified AND schema-validated (see lib/composer/schema),
 * so the validated object and the emitted file never diverge.
 */
export function buildAgentNetworkDoc(project: ComposerProject): Record<string, unknown> {
  const yamlVersion = project.identity.yamlInfo?.version ?? project.identity.version;
  const doc: Record<string, unknown> = {
    agentNetwork: "2.0.0",
    info: {
      label: project.identity.name,
      version: yamlVersion,
      ...yamlInfoToObject(project.identity.yamlInfo),
    },
  };

  const registryDoc = serializeNetworkRegistry(project.registry, project);
  if (registryDoc) doc.registry = registryDoc;

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
    const derivedSecurity = deriveA2aCardSecurityFromInterfacePolicies(broker, project) ?? null;
    const iface: Record<string, unknown> = {
      card: serializeBrokerCard(broker.card, derivedSecurity),
    };
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
