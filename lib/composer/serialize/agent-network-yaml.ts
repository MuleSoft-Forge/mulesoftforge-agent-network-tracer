import { stringify } from "yaml";
import type { BrokerCard, ComposerProject } from "@/lib/composer/model";
import { deriveConnections, primaryBroker } from "@/lib/composer/model";
import { brokerFileName, brokerKey } from "@/lib/composer/serialize/util";

function cardToObject(card: BrokerCard): Record<string, unknown> {
  const out: Record<string, unknown> = { name: card.name };
  if (card.description) out.description = card.description;
  out.version = card.version;
  if (card.capabilities) out.capabilities = card.capabilities;
  if (card.defaultInputModes) out.defaultInputModes = card.defaultInputModes;
  if (card.defaultOutputModes) out.defaultOutputModes = card.defaultOutputModes;
  if (card.skills && card.skills.length > 0) {
    out.skills = card.skills.map((s) => {
      const skill: Record<string, unknown> = { id: s.id, name: s.name };
      if (s.description) skill.description = s.description;
      if (s.tags && s.tags.length > 0) skill.tags = s.tags;
      if (s.examples && s.examples.length > 0) skill.examples = s.examples;
      return skill;
    });
  }
  return out;
}

/** Serialize the model's agent-network.yaml projection (info + connections + broker). */
export function serializeAgentNetworkYaml(project: ComposerProject): string {
  const doc: Record<string, unknown> = {
    agentNetwork: "2.0.0",
    info: {
      label: project.identity.name,
      version: project.identity.version,
    },
  };

  const connections = deriveConnections(project);
  if (connections.length > 0) {
    const connObj: Record<string, unknown> = {};
    for (const c of connections) {
      const ref: Record<string, unknown> = { name: c.refName };
      if (c.refNamespace) ref.namespace = c.refNamespace;
      const entry: Record<string, unknown> = { kind: c.kind, ref, url: c.url };
      if (c.auth) {
        entry.authentication = { kind: c.auth.kind, apiKey: c.auth.apiKeyToken };
      }
      connObj[c.connectionName] = entry;
    }
    doc.context = { connections: connObj };
  }

  const broker = primaryBroker(project);
  if (broker) {
    doc.brokers = {
      [brokerKey(broker)]: {
        kind: "AgentScript",
        implementation: `./brokers/${brokerFileName(broker)}`,
        interfaces: {
          [broker.interfaceName || "a2a"]: { card: cardToObject(broker.card) },
        },
      },
    };
  }

  return stringify(doc, { lineWidth: 0 });
}
