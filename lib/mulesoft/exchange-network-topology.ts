import { parse as parseYaml } from "yaml";
import {
  detectProjectVersion,
  type AgentNetworkProjectVersion,
} from "@/lib/mulesoft/agent-network-project-version";
import type {
  AgentNetworkMetadata,
  ExchangeAssetRef,
  ExchangeConnection,
} from "@/lib/mulesoft/exchange-asset-metadata";

export interface TopologyBroker {
  logicalId?: string;
  label: string;
  ref?: ExchangeAssetRef;
  connections: ExchangeConnection[];
}

export interface NetworkTopology {
  projectVersion: AgentNetworkProjectVersion;
  brokers: TopologyBroker[];
  registry: Array<{ ref: ExchangeAssetRef; label?: string }>;
}

export interface ProjectZipSources {
  zipClassifier?: string | null;
  yamlContent?: string | null;
  exchangeJsonContent?: string | null;
}

interface ExchangeDependency extends ExchangeAssetRef {
  classifier?: string;
}

function refKey(ref: ExchangeAssetRef): string {
  return `${ref.groupId}:${ref.assetId}:${ref.version}`;
}

function addRef(
  map: Map<string, ExchangeAssetRef>,
  ref: ExchangeAssetRef | undefined
): void {
  if (!ref?.groupId || !ref.assetId || !ref.version) return;
  map.set(refKey(ref), ref);
}

function parseExchangeDependencies(content: string | null | undefined): ExchangeDependency[] {
  if (!content) return [];
  try {
    const json = JSON.parse(content) as { dependencies?: unknown };
    if (!Array.isArray(json.dependencies)) return [];
    const out: ExchangeDependency[] = [];
    for (const item of json.dependencies) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (typeof o.groupId !== "string" || typeof o.assetId !== "string") continue;
      out.push({
        groupId: o.groupId,
        assetId: o.assetId,
        version: typeof o.version === "string" ? o.version : "",
        classifier: typeof o.classifier === "string" ? o.classifier : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function findDependency(
  dependencies: ExchangeDependency[],
  logicalName: string,
  kind?: string
): ExchangeDependency | undefined {
  const normalized = logicalName.toLowerCase();
  return dependencies.find((dep) => {
    const assetId = dep.assetId.toLowerCase();
    if (assetId === normalized || assetId.includes(normalized) || normalized.includes(assetId)) {
      return true;
    }
    if (kind && dep.classifier) {
      const classifier = dep.classifier.toLowerCase();
      if (kind === "llm" && (classifier.includes("llm") || classifier.includes("model"))) return true;
      if (kind === "mcp" && classifier.includes("mcp")) return true;
      if (kind === "agent" && classifier.includes("agent")) return true;
    }
    return false;
  });
}

function connectionFromRef(kind: string, ref: ExchangeAssetRef, name?: string): ExchangeConnection {
  return { kind, name, ref };
}

function topologyFromNetworkMetadata(
  metadata: AgentNetworkMetadata,
  projectVersion: AgentNetworkProjectVersion
): NetworkTopology {
  return {
    projectVersion,
    brokers: metadata.brokers.map((broker) => ({
      label: broker.ref.assetId,
      ref: broker.ref,
      connections: broker.connections,
    })),
    registry: metadata.registry.map((entry) => ({ ref: entry.ref })),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readRefName(value: unknown): string | undefined {
  const record = asRecord(value);
  const ref = record ? asRecord(record.ref) : null;
  const name = ref?.name;
  return typeof name === "string" ? name : undefined;
}

function collectV1BrokerConnections(
  brokerDef: Record<string, unknown>,
  yamlRoot: Record<string, unknown>,
  dependencies: ExchangeDependency[]
): ExchangeConnection[] {
  const connections: ExchangeConnection[] = [];
  const spec = asRecord(brokerDef.spec);

  const llmRefName = spec ? readRefName(spec.llm) : undefined;
  if (llmRefName) {
    const dep = findDependency(dependencies, llmRefName, "llm");
    if (dep?.version) {
      connections.push(connectionFromRef("llm", dep, llmRefName));
    }
  }

  const tools = spec?.tools;
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      const toolRecord = asRecord(tool);
      if (!toolRecord) continue;
      for (const kind of ["mcp", "agent", "llm"] as const) {
        const block = asRecord(toolRecord[kind]);
        if (!block) continue;
        const name = readRefName(block);
        if (!name) continue;
        const dep = findDependency(dependencies, name, kind);
        if (dep?.version) {
          connections.push(connectionFromRef(kind, dep, name));
        }
      }
    }
  }

  const links = spec?.links;
  if (Array.isArray(links)) {
    for (const link of links) {
      const linkRecord = asRecord(link);
      if (!linkRecord) continue;
      const agentBlock = asRecord(linkRecord.agent);
      const name = agentBlock ? readRefName(agentBlock) : undefined;
      if (!name) continue;
      const dep = findDependency(dependencies, name, "agent");
      if (dep?.version) {
        connections.push(connectionFromRef("agent", dep, name));
      }
    }
  }

  const yamlConnections = asRecord(yamlRoot.connections);
  if (yamlConnections) {
    for (const conn of Object.values(yamlConnections)) {
      const connRecord = asRecord(conn);
      if (!connRecord || typeof connRecord.kind !== "string") continue;
      const name = readRefName(connRecord);
      if (!name) continue;
      const dep = findDependency(dependencies, name, connRecord.kind);
      if (dep?.version) {
        connections.push(connectionFromRef(connRecord.kind, dep, name));
      }
    }
  }

  const unique = new Map<string, ExchangeConnection>();
  for (const conn of connections) {
    unique.set(`${conn.kind}:${refKey(conn.ref)}`, conn);
  }
  return Array.from(unique.values());
}

function topologyFromV1ProjectSources(sources: ProjectZipSources): NetworkTopology {
  const dependencies = parseExchangeDependencies(sources.exchangeJsonContent);
  const registry = dependencies
    .filter((dep) => dep.version)
    .map((dep) => ({ ref: dep as ExchangeAssetRef, label: dep.assetId }));

  let brokers: TopologyBroker[] = [];
  if (sources.yamlContent) {
    try {
      const yamlRoot = asRecord(parseYaml(sources.yamlContent));
      if (yamlRoot) {
        const yamlBrokers = asRecord(yamlRoot.brokers);
        if (yamlBrokers) {
          brokers = Object.entries(yamlBrokers).map(([brokerId, brokerDef]) => {
            const brokerRecord = asRecord(brokerDef) ?? {};
            const card = asRecord(brokerRecord.card);
            const label =
              (typeof card?.name === "string" ? card.name : undefined) ?? brokerId;
            const dep =
              findDependency(dependencies, brokerId, "agent") ??
              findDependency(dependencies, brokerId);
            return {
              logicalId: brokerId,
              label,
              ref: dep?.version ? (dep as ExchangeAssetRef) : undefined,
              connections: collectV1BrokerConnections(brokerRecord, yamlRoot, dependencies),
            };
          });
        }
      }
    } catch {
      /* fall through */
    }
  }

  if (brokers.length === 0 && dependencies.length > 0) {
    brokers = dependencies
      .filter(
        (dep) =>
          dep.version &&
          (dep.classifier?.includes("agent") ||
            dep.classifier?.includes("broker") ||
            dep.assetId.toLowerCase().includes("broker"))
      )
      .map((dep) => ({
        label: dep.assetId,
        ref: dep as ExchangeAssetRef,
        connections: [],
      }));
  }

  return {
    projectVersion: "v1",
    brokers,
    registry,
  };
}

export function resolveNetworkTopology(input: {
  networkMetadata: AgentNetworkMetadata | null;
  sources: ProjectZipSources;
}): NetworkTopology {
  const projectVersion = detectProjectVersion({
    zipClassifier: input.sources.zipClassifier,
    yamlContent: input.sources.yamlContent,
  });

  if (input.networkMetadata) {
    return topologyFromNetworkMetadata(
      input.networkMetadata,
      projectVersion === "unknown" ? "v2" : projectVersion
    );
  }

  if (projectVersion === "v1" || input.sources.zipClassifier === "agent-network") {
    return topologyFromV1ProjectSources(input.sources);
  }

  return {
    projectVersion,
    brokers: [],
    registry: parseExchangeDependencies(input.sources.exchangeJsonContent)
      .filter((dep) => dep.version)
      .map((dep) => ({ ref: dep as ExchangeAssetRef, label: dep.assetId })),
  };
}

export function collectTopologyRefs(topology: NetworkTopology): ExchangeAssetRef[] {
  const refs = new Map<string, ExchangeAssetRef>();
  for (const broker of topology.brokers) {
    addRef(refs, broker.ref);
    for (const conn of broker.connections) addRef(refs, conn.ref);
  }
  for (const entry of topology.registry) addRef(refs, entry.ref);
  return Array.from(refs.values()).filter((ref) => Boolean(ref.version));
}

export function findProjectSourcesInFiles(
  zipFiles: Array<{ classifier?: string; packaging?: string; content?: string | null }>,
  zipClassifier?: string | null
): ProjectZipSources {
  const yamlFile = zipFiles.find(
    (f) =>
      f.content &&
      ((f.classifier === "agent-network" && f.packaging === "yaml") ||
        f.classifier === "agent-network.yaml")
  );
  const exchangeFile = zipFiles.find(
    (f) =>
      f.content &&
      ((f.classifier === "exchange" && f.packaging === "json") || f.classifier === "exchange.json")
  );
  return {
    zipClassifier,
    yamlContent: yamlFile?.content ?? null,
    exchangeJsonContent: exchangeFile?.content ?? null,
  };
}
