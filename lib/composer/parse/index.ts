/**
 * Assemble a ComposerProject from the three project files. This is the inverse
 * of lib/composer/serialize: text -> model. Used by the editable file preview
 * so testers can paste real v2 examples and see the UI populate.
 *
 * The model stays the single source of truth; parsing just rebuilds it. Where a
 * detail is only carried by one file (e.g. per-variable descriptions), we keep
 * it as a variable override so the files round-trip.
 */

import type {
  AssetKind,
  Broker,
  BrokerAction,
  BrokerCard,
  ComposerProject,
  CustomVariable,
  GraphNode,
  ImportedAsset,
  LlmBinding,
  RouterRoute,
  VariableOverride,
} from "@/lib/composer/model";
import {
  CLASSIFIER_BY_KIND,
  ComposerProjectSchema,
  deriveVariables,
  toIdentifier,
} from "@/lib/composer/model";
import { newId } from "@/lib/composer/factory";
import {
  parseBrokerAgent,
  type ParsedBrokerAgent,
  type ParsedGraphNode,
} from "@/lib/composer/parse/broker-agent";
import { parseAgentNetworkYaml, type ParsedConnection } from "@/lib/composer/parse/agent-network-yaml";
import { parseExchangeJson, type ParsedExchangeJson } from "@/lib/composer/parse/exchange-json";

export interface ParseFilesInput {
  exchangeJson?: string;
  agentYaml?: string;
  brokerAgent?: string;
  /**
   * groupId to use for connections whose asset groupId can't be resolved from
   * the exchange.json dependencies or the yaml `ref.namespace` (real published
   * networks often omit both). Typically the network's business group / org id.
   */
  fallbackGroupId?: string;
}

export type ParseFilesResult =
  | { ok: true; project: ComposerProject; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

const KIND_BY_CONNECTION: Record<ParsedConnection["kind"], AssetKind> = {
  a2a: "agent",
  mcp: "mcp",
  llm: "llm",
};

function findVarDefault(exchange: ParsedExchangeJson, group: string, field: string): string | undefined {
  const v = exchange.variables.find((x) => x.group === group && x.field === field);
  return v?.default;
}

function findDependencyIndex(
  remaining: ParsedExchangeJson["dependencies"],
  classifier: string,
  namespace: string,
  refName: string
): number {
  // Preferred: exact classifier (+ groupId when the yaml pins a namespace).
  let idx = remaining.findIndex(
    (d) => d.classifier === classifier && (!namespace || d.groupId === namespace)
  );
  // Fall back to matching by assetId — real networks use varied dependency
  // classifiers, but the connection name/ref usually mirrors the assetId.
  if (idx < 0) {
    idx = remaining.findIndex(
      (d) => d.assetId === refName && (!namespace || d.groupId === namespace)
    );
  }
  if (idx < 0) idx = remaining.findIndex((d) => d.assetId === refName);
  return idx;
}

function buildAssets(
  exchange: ParsedExchangeJson,
  connections: ParsedConnection[],
  fallbackGroupId?: string
): ImportedAsset[] {
  const remaining = exchange.dependencies.slice();
  return connections.map((conn) => {
    const kind = KIND_BY_CONNECTION[conn.kind];
    const classifier = CLASSIFIER_BY_KIND[kind];
    const namespace = conn.refNamespace ?? "";
    const baseName = conn.refName;

    const depIdx = findDependencyIndex(remaining, classifier, namespace, baseName);
    const dep = depIdx >= 0 ? remaining.splice(depIdx, 1)[0] : undefined;

    // Resolve groupId from the strongest available signal, falling back to the
    // network's own org id so imports never fail schema validation on an empty
    // groupId (the user can refine it per-asset afterwards).
    const resolvedGroupId =
      dep?.groupId || namespace || exchange.organizationId || fallbackGroupId || "";

    const group = toIdentifier(baseName);
    const url = findVarDefault(exchange, group, "url") ?? "";

    const asset: ImportedAsset = {
      id: newId(),
      kind,
      groupId: resolvedGroupId,
      assetId: dep?.assetId ?? baseName,
      version: dep?.version ?? "1.0.0",
      namespace: namespace || dep?.groupId || resolvedGroupId || undefined,
      name: baseName,
      baseName,
      // Keep the file's exact connection name so actions/llm bindings resolve,
      // even when it doesn't follow the derived `<base>Connection` convention.
      connectionName: conn.connectionName,
      url,
      authentication: conn.authentication,
      access: conn.access,
      policies: conn.policies,
    };
    return asset;
  });
}

function buildVariableOverrides(exchange: ParsedExchangeJson): Record<string, VariableOverride> {
  const overrides: Record<string, VariableOverride> = {};
  for (const v of exchange.variables) {
    overrides[`${v.group}.${v.field}`] = {
      ...(v.description ? { description: v.description } : {}),
      default: v.default,
      secret: v.secret,
    };
  }
  return overrides;
}

/**
 * exchange.json variables that don't correspond to any connection/policy-derived
 * variable are user-declared custom variables — preserve them so they round-trip.
 */
function buildCustomVariables(
  exchange: ParsedExchangeJson,
  derivedProject: ComposerProject
): CustomVariable[] {
  const derivedKeys = new Set(
    deriveVariables(derivedProject).map((v) => `${v.group}.${v.field}`)
  );
  const custom: CustomVariable[] = [];
  for (const v of exchange.variables) {
    if (derivedKeys.has(`${v.group}.${v.field}`)) continue;
    custom.push({
      group: v.group,
      field: v.field,
      ...(v.description ? { description: v.description } : {}),
      ...(v.default ? { default: v.default } : {}),
      ...(v.secret ? { secret: v.secret } : {}),
    });
  }
  return custom;
}

function toGraphNode(pn: ParsedGraphNode, id: string, position: { x: number; y: number }): GraphNode {
  const node: GraphNode = { id, kind: pn.kind, name: pn.name, position };
  if (pn.label) node.label = pn.label;
  if (pn.description) node.description = pn.description;
  if (pn.interfaceName) node.interfaceName = pn.interfaceName;
  if (pn.llmBindingName) node.llmBindingName = pn.llmBindingName;
  if (pn.systemInstructions !== undefined) node.systemInstructions = pn.systemInstructions;
  if (pn.prompt !== undefined) node.prompt = pn.prompt;
  if (pn.reasoningInstructions !== undefined) node.reasoningInstructions = pn.reasoningInstructions;
  if (pn.actionRefs) node.actionRefs = pn.actionRefs;
  if (pn.outputs) node.outputs = pn.outputs;
  if (pn.runActionName) node.runActionName = pn.runActionName;
  if (pn.withArgs) node.withArgs = pn.withArgs;
  if (pn.echoKind) node.echoKind = pn.echoKind;
  if (pn.state) node.state = pn.state;
  if (pn.message !== undefined) node.message = pn.message;
  return node;
}

/** Left-to-right layout with a mild vertical stagger (positions aren't in the file). */
function layoutPosition(index: number): { x: number; y: number } {
  return { x: 60 + index * 240, y: 160 + (index % 2) * 90 };
}

function buildNodes(parsed: ParsedBrokerAgent): GraphNode[] {
  const ids = parsed.nodes.map(() => newId());
  const nameToId = new Map<string, string>();
  parsed.nodes.forEach((pn, i) => nameToId.set(pn.name, ids[i]));

  return parsed.nodes.map((pn, i) => {
    const node = toGraphNode(pn, ids[i], layoutPosition(i));
    if (pn.onExitTargetName) {
      const target = nameToId.get(pn.onExitTargetName);
      if (target) node.onExitTarget = target;
    }
    if (pn.routes) {
      const routes: RouterRoute[] = [];
      for (const r of pn.routes) {
        const target = nameToId.get(r.targetName);
        if (target) {
          routes.push({
            id: `route-${Math.random().toString(36).slice(2)}`,
            targetNodeId: target,
            when: r.when || "true",
            ...(r.label ? { label: r.label } : {}),
          });
        }
      }
      if (routes.length > 0) node.routes = routes;
    }
    if (pn.otherwiseTargetName) {
      const target = nameToId.get(pn.otherwiseTargetName);
      if (target) node.otherwiseTargetNodeId = target;
    }
    return node;
  });
}

function buildLlmBindings(parsed: ParsedBrokerAgent): LlmBinding[] {
  return parsed.llmBindings.map((b) => ({
    id: newId(),
    name: b.name,
    connectionName: b.connectionName,
    provider: b.provider,
    model: b.model,
    ...(b.params ? { params: b.params } : {}),
  }));
}

function buildActions(parsed: ParsedBrokerAgent): BrokerAction[] {
  return parsed.actions.map((a) => ({
    id: newId(),
    name: a.name,
    actionKind: a.actionKind,
    connectionName: a.connectionName,
    ...(a.toolName !== undefined ? { toolName: a.toolName } : {}),
    ...(a.inputs ? { inputs: a.inputs } : {}),
  }));
}

const DEFAULT_CARD: BrokerCard = { name: "Broker", version: "1.0.0" };

export function parseProjectFiles(input: ParseFilesInput): ParseFilesResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let exchange: ParsedExchangeJson = { dependencies: [], variables: [] };
  if (input.exchangeJson && input.exchangeJson.trim()) {
    try {
      exchange = parseExchangeJson(input.exchangeJson);
    } catch (e) {
      errors.push(`exchange.json: ${(e as Error).message}`);
    }
  }

  let yamlDoc = parseAgentNetworkYaml("");
  if (input.agentYaml && input.agentYaml.trim()) {
    try {
      yamlDoc = parseAgentNetworkYaml(input.agentYaml);
    } catch (e) {
      errors.push(`agent-network.yaml: ${(e as Error).message}`);
    }
  }

  let agent: ParsedBrokerAgent = { llmBindings: [], actions: [], nodes: [] };
  if (input.brokerAgent && input.brokerAgent.trim()) {
    try {
      agent = parseBrokerAgent(input.brokerAgent);
    } catch (e) {
      errors.push(`broker .agent: ${(e as Error).message}`);
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings };

  const assets = buildAssets(exchange, yamlDoc.connections, input.fallbackGroupId);

  const brokerName =
    agent.agentName ?? yamlDoc.broker?.key ?? toIdentifier(yamlDoc.broker?.card.name ?? "broker", "broker");

  const broker: Broker = {
    id: newId(),
    name: brokerName,
    interfaceName: yamlDoc.broker?.interfaceName ?? "a2a",
    card: yamlDoc.broker?.card ?? { ...DEFAULT_CARD, name: brokerName },
    ...(yamlDoc.broker?.interfacePolicies ? { interfacePolicies: yamlDoc.broker.interfacePolicies } : {}),
    systemInstructions: agent.systemInstructions ?? "",
    defaultLlmBindingName: agent.defaultLlm,
    llmBindings: buildLlmBindings(agent),
    actions: buildActions(agent),
    nodes: buildNodes(agent),
  };

  const candidate: ComposerProject = {
    version: 1,
    identity: {
      name: exchange.name ?? yamlDoc.label ?? "My Agent Network",
      organizationId: exchange.organizationId || input.fallbackGroupId || "",
      assetId: exchange.assetId ?? "my-agent-network",
      version: exchange.version ?? yamlDoc.version ?? "1.0.0",
      descriptorVersion: exchange.descriptorVersion ?? "1.0.0",
      apiVersion: exchange.apiVersion ?? "v2.0",
      ...(exchange.description ? { description: exchange.description } : {}),
      tags: exchange.tags ?? [],
      ...(yamlDoc.yamlInfo ? { yamlInfo: yamlDoc.yamlInfo } : {}),
    },
    assets,
    brokers: [broker],
    policyBindings: yamlDoc.policyBindings,
    variableOverrides: buildVariableOverrides(exchange),
    customVariables: [],
  };
  candidate.customVariables = buildCustomVariables(exchange, candidate);

  const parsed = ComposerProjectSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      warnings,
    };
  }

  return { ok: true, project: parsed.data, warnings };
}
