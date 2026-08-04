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
import { normalizeBrokerKey, isValidBrokerKey } from "@/lib/composer/broker-key";
import { connectionIdForBaseName, isValidAnfId, normalizeAnfId } from "@/lib/composer/anf-id";
import { defaultLlmBaseUrlForAsset } from "@/lib/composer/connectivity/llm-default-urls";
import { variableStorageKey } from "@/lib/composer/variable-keys";
import { newId } from "@/lib/composer/factory";
import { applyGraphLayout } from "@/lib/composer/builder-metadata";
import { applyHierarchicalGraphLayout } from "@/lib/composer/broker-graph-layout";
import {
  parseBrokerAgent,
  type ParsedBrokerAgent,
  type ParsedGraphNode,
} from "@/lib/composer/parse/broker-agent";
import { parseAgentNetworkYaml, type ParsedConnection } from "@/lib/composer/parse/agent-network-yaml";
import { parseExchangeJson, type ParsedExchangeJson } from "@/lib/composer/parse/exchange-json";
import { isVariableRef, parseVariableRef } from "@/lib/composer/connectivity/variable-ref";

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
  // Primary: yaml ref.name ↔ exchange dependency assetId (authoritative link).
  let idx = remaining.findIndex(
    (d) => d.assetId === refName && d.classifier === classifier && (!namespace || d.groupId === namespace)
  );
  if (idx < 0) {
    idx = remaining.findIndex(
      (d) => d.assetId === refName && (!namespace || d.groupId === namespace)
    );
  }
  if (idx < 0) idx = remaining.findIndex((d) => d.assetId === refName);
  // Last resort: classifier-only when ref doesn't match any remaining dep (registry-local
  // refs or broken yaml). Never prefer classifier over assetId — that scrambles ref.name
  // when multiple deps share a classifier (e.g. several mcp-metadata entries).
  if (idx < 0) {
    idx = remaining.findIndex(
      (d) => d.classifier === classifier && (!namespace || d.groupId === namespace)
    );
  }
  return idx;
}

interface BuiltAssets {
  assets: ImportedAsset[];
  /** Exchange dependencies no yaml connection claimed — preserved verbatim on export. */
  unmatched: ParsedExchangeJson["dependencies"];
}

function buildAssets(
  exchange: ParsedExchangeJson,
  connections: ParsedConnection[],
  fallbackGroupId?: string
): BuiltAssets {
  const remaining = exchange.dependencies.slice();
  const assets = connections.map((conn) => {
    const kind = KIND_BY_CONNECTION[conn.kind];
    const classifier = CLASSIFIER_BY_KIND[kind];
    const namespace = conn.refNamespace ?? "";
    const rawBaseName = conn.refName;
    const baseName = normalizeAnfId(rawBaseName, "asset");

    const depIdx = findDependencyIndex(remaining, classifier, namespace, rawBaseName);
    const dep = depIdx >= 0 ? remaining.splice(depIdx, 1)[0] : undefined;

    // Resolve groupId from the strongest available signal, falling back to the
    // network's own org id so imports never fail schema validation on an empty
    // groupId (the user can refine it per-asset afterwards).
    const resolvedGroupId =
      dep?.groupId || namespace || exchange.organizationId || fallbackGroupId || "";

    const group = toIdentifier(rawBaseName);
    const urlRef = conn.url && isVariableRef(conn.url) ? conn.url : undefined;
    const parsedUrlRef = urlRef ? parseVariableRef(urlRef) : null;
    const literalUrl = conn.url && !isVariableRef(conn.url) ? conn.url : undefined;
    let url =
      parsedUrlRef != null
        ? findVarDefault(exchange, parsedUrlRef.group, parsedUrlRef.field) ?? ""
        : literalUrl ?? findVarDefault(exchange, group, "url") ?? "";
    if (kind === "llm" && !url.trim()) {
      url = defaultLlmBaseUrlForAsset({
        name: rawBaseName,
        assetId: dep?.assetId ?? rawBaseName,
      });
    }

    const rawConnectionName = conn.connectionName;
    const connectionName = isValidAnfId(rawConnectionName)
      ? rawConnectionName
      : normalizeAnfId(rawConnectionName, connectionIdForBaseName(baseName));

    const asset: ImportedAsset = {
      id: newId(),
      kind,
      groupId: resolvedGroupId,
      assetId: dep?.assetId ?? rawBaseName,
      version: dep?.version ?? "1.0.0",
      ...(dep?.packaging ? { packaging: dep.packaging } : {}),
      namespace: namespace || dep?.groupId || resolvedGroupId || undefined,
      name: rawBaseName,
      baseName,
      ...(dep ? {} : { registryLocal: true }),
      connectionName,
      ...(urlRef ? { urlRef } : {}),
      ...(literalUrl ? { literalConnectionUrl: literalUrl } : {}),
      ...(parsedUrlRef ? { variableGroup: parsedUrlRef.group } : {}),
      url,
      authentication: conn.authentication,
      access: conn.access,
      policies: conn.policies,
    };
    return asset;
  });
  return { assets, unmatched: remaining };
}

function buildVariableOverrides(exchange: ParsedExchangeJson): Record<string, VariableOverride> {
  const overrides: Record<string, VariableOverride> = {};
  for (const v of exchange.variables) {
    overrides[variableStorageKey(v)] = {
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
  const derivedKeys = new Set(deriveVariables(derivedProject).map((v) => variableStorageKey(v)));
  const custom: CustomVariable[] = [];
  for (const v of exchange.variables) {
    if (derivedKeys.has(variableStorageKey(v))) continue;
    custom.push({
      ...(v.flat ? { flat: true } : { group: v.group }),
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
  if (pn.triggerTarget) node.triggerTarget = pn.triggerTarget;
  if (pn.llmBindingName) node.llmBindingName = pn.llmBindingName;
  if (pn.systemInstructions !== undefined) node.systemInstructions = pn.systemInstructions;
  if (pn.prompt !== undefined) node.prompt = pn.prompt;
  if (pn.reasoningInstructions !== undefined) node.reasoningInstructions = pn.reasoningInstructions;
  if (pn.reasoningInstructionsProcedure) node.reasoningInstructionsProcedure = true;
  if (pn.maxNumberOfLoops !== undefined) node.maxNumberOfLoops = pn.maxNumberOfLoops;
  if (pn.taskTimeoutSecs !== undefined) node.taskTimeoutSecs = pn.taskTimeoutSecs;
  if (pn.maxConsecutiveErrors !== undefined) node.maxConsecutiveErrors = pn.maxConsecutiveErrors;
  if (pn.actionBindings) node.actionBindings = pn.actionBindings;
  if (pn.actionRefs) node.actionRefs = pn.actionRefs;
  if (pn.promptProcedure) node.promptProcedure = true;
  if (pn.outputs) node.outputs = pn.outputs;
  if (pn.executorStatements) node.executorStatements = pn.executorStatements;
  if (pn.echoKind) node.echoKind = pn.echoKind;
  if (pn.state) node.state = pn.state;
  if (pn.message !== undefined) node.message = pn.message;
  if (pn.taskExpr !== undefined) node.taskExpr = pn.taskExpr;
  if (pn.echoMessageMultiline) node.echoMessageMultiline = true;
  if (pn.echoTaskMultiline) node.echoTaskMultiline = true;
  if (pn.artifactExpr !== undefined) node.artifactExpr = pn.artifactExpr;
  if (pn.echoAppend !== undefined) node.echoAppend = pn.echoAppend;
  if (pn.echoLastChunk !== undefined) node.echoLastChunk = pn.echoLastChunk;
  if (pn.metadataExpr !== undefined) node.metadataExpr = pn.metadataExpr;
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
    ...(b.reasoningEffort ? { reasoningEffort: b.reasoningEffort } : {}),
    ...(b.temperature !== undefined ? { temperature: b.temperature } : {}),
    ...(b.topP !== undefined ? { topP: b.topP } : {}),
    ...(b.topLogprobs !== undefined ? { topLogprobs: b.topLogprobs } : {}),
    ...(b.maxOutputTokens !== undefined ? { maxOutputTokens: b.maxOutputTokens } : {}),
    ...(b.thinkingLevel ? { thinkingLevel: b.thinkingLevel } : {}),
    ...(b.thinkingBudget !== undefined ? { thinkingBudget: b.thinkingBudget } : {}),
    ...(b.responseLogprobs !== undefined ? { responseLogprobs: b.responseLogprobs } : {}),
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
    ...(a.httpHeaders ? { httpHeaders: a.httpHeaders } : {}),
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

  const { assets, unmatched: unmatchedDependencies } = buildAssets(
    exchange,
    yamlDoc.connections,
    input.fallbackGroupId
  );

  const rawBrokerName = agent.agentName ?? yamlDoc.broker?.key ?? yamlDoc.broker?.card.name ?? "broker";
  const brokerName = isValidBrokerKey(rawBrokerName)
    ? rawBrokerName
    : normalizeBrokerKey(rawBrokerName, "broker");

  const broker: Broker = {
    id: newId(),
    name: brokerName,
    interfaceName: yamlDoc.broker?.interfaceName ?? "a2a",
    card: yamlDoc.broker?.card ?? { ...DEFAULT_CARD, name: brokerName },
    ...(yamlDoc.broker?.interfacePolicies ? { interfacePolicies: yamlDoc.broker.interfacePolicies } : {}),
    systemInstructions: agent.systemInstructions ?? "",
    ...(agent.systemInstructionsProcedure ? { systemInstructionsProcedure: true } : {}),
    ...(agent.agentConfigLabel ? { agentConfigLabel: agent.agentConfigLabel } : {}),
    ...(agent.agentConfigDescription ? { agentConfigDescription: agent.agentConfigDescription } : {}),
    ...(agent.agentDialectVersion ? { agentDialectVersion: agent.agentDialectVersion } : {}),
    defaultLlmBindingName: agent.defaultLlm,
    llmBindings: buildLlmBindings(agent),
    actions: buildActions(agent),
    nodes: buildNodes(agent),
  };
  const savedLayout = exchange.builderMetadata?.graphLayouts?.[brokerName];
  const graphLayoutPinned = exchange.builderMetadata?.graphLayoutPinned !== false;
  let brokerWithLayout = applyGraphLayout(broker, savedLayout);
  if (!savedLayout || !graphLayoutPinned) {
    brokerWithLayout = applyHierarchicalGraphLayout(brokerWithLayout);
  }

  const candidate: ComposerProject = {
    version: 1,
    identity: {
      name: yamlDoc.label ?? exchange.name ?? "My Agent Network",
      organizationId: exchange.organizationId || input.fallbackGroupId || "",
      assetId: exchange.assetId ?? "my-agent-network",
      version: exchange.version ?? "1.0.0",
      descriptorVersion: exchange.descriptorVersion ?? "1.0.0",
      apiVersion: exchange.apiVersion ?? "v1",
      ...(exchange.description ? { description: exchange.description } : {}),
      tags: exchange.tags ?? [],
      ...(yamlDoc.yamlInfo ? { yamlInfo: yamlDoc.yamlInfo } : {}),
    },
    assets,
    brokers: [brokerWithLayout],
    policyBindings: yamlDoc.policyBindings,
    variableOverrides: buildVariableOverrides(exchange),
    customVariables: [],
    graphLayoutPinned: graphLayoutPinned && Boolean(savedLayout),
    ...(yamlDoc.registry ? { registry: yamlDoc.registry } : {}),
    // Dependencies that map to a connection are re-derived from the live assets on
    // export, so edits stay in sync. Only the leftovers need preserving verbatim.
    ...(unmatchedDependencies.length > 0
      ? {
          unmatchedDependencies: unmatchedDependencies.map((d) => ({
            groupId: d.groupId,
            assetId: d.assetId,
            version: d.version,
            classifier: d.classifier,
            packaging: d.packaging ?? "zip",
          })),
        }
      : {}),
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
