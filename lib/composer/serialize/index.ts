import type { ComposerProject } from "@/lib/composer/model";
import { primaryBroker } from "@/lib/composer/model";
import { serializeExchangeJson } from "@/lib/composer/serialize/exchange-json";
import { serializeAgentNetworkYaml } from "@/lib/composer/serialize/agent-network-yaml";
import { serializeBrokerAgent } from "@/lib/composer/serialize/broker-agent";
import { brokerFileName } from "@/lib/composer/serialize/util";

export { serializeExchangeJson } from "@/lib/composer/serialize/exchange-json";
export { serializeAgentNetworkYaml } from "@/lib/composer/serialize/agent-network-yaml";
export { serializeBrokerAgent } from "@/lib/composer/serialize/broker-agent";
export { brokerFileName, brokerKey, kebab } from "@/lib/composer/serialize/util";

export interface SerializedFile {
  /** Path relative to project root, e.g. "brokers/my-broker.agent". */
  path: string;
  language: "json" | "yaml" | "agent";
  content: string;
}

/** Serialize the whole project into its three (or more) files, in display order. */
export function serializeProject(project: ComposerProject): SerializedFile[] {
  const files: SerializedFile[] = [
    { path: "exchange.json", language: "json", content: serializeExchangeJson(project) },
    { path: "agent-network.yaml", language: "yaml", content: serializeAgentNetworkYaml(project) },
  ];

  const broker = primaryBroker(project);
  if (broker) {
    files.push({
      path: `brokers/${brokerFileName(broker)}`,
      language: "agent",
      content: serializeBrokerAgent(broker),
    });
  }

  return files;
}
