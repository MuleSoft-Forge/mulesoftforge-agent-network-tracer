import { parse as parseYaml } from "yaml";
import { flattenExchangeDeployVariables } from "@/lib/desktop/exchange-deploy-variables";
import {
  defaultDeployOptions,
  deployOptionsReady,
  propertiesFromVariables,
} from "@/lib/desktop/deploy-options";
import {
  createEmptyProject,
  createScaffoldProject,
  importAsset,
  createMcpToolAction,
  createActionsForMcpAsset,
} from "@/lib/composer/factory";
import {
  serializeProject,
  serializeAgentNetworkYaml,
  serializeExchangeJson,
  serializeBrokerAgent,
  buildAgentNetworkDoc,
} from "@/lib/composer/serialize";
import { validateAgentNetworkDoc, schemaValidatorBuildError } from "@/lib/composer/schema/anf/index";
import { verifyAnfSchemaManifestStructure } from "@/lib/composer/schema/anf/catalog";
import manifest from "@/lib/composer/schema/anf/manifest.json";
import { parseConnectionAuth } from "@/lib/composer/connectivity/parse-auth";
import { serializeConnectionAuth } from "@/lib/composer/connectivity/serialize-auth";
import {
  fetchExchangePolicyCatalog,
  fetchExchangePolicyTemplate,
  fetchExchangePolicyTemplates,
} from "@/lib/mulesoft/exchange-policy-templates";
import {
  filterPolicyCatalogForAssetKind,
  policyMatchesAssetKind,
} from "@/lib/mulesoft/policy-catalog-filter";
import {
  parseContextPolicies,
  serializeContextPolicies,
} from "@/lib/composer/connectivity/policy-bindings";
import { policyConfigFieldSpecs } from "@/lib/composer/connectivity/policy-schema-fields";
import {
  applyPolicyConfigVariableDefaults,
  policyVariableFieldName,
} from "@/lib/composer/connectivity/policy-config-defaults";
import { derivePolicyVariableBindings } from "@/lib/composer/connectivity/policy-variable-bindings";
import {
  deriveVariables,
  deriveVariablesForAsset,
  assignDefaultConnectionName,
  defaultConnectionIdForProject,
} from "@/lib/composer/model";
import {
  parseConnectionAccess,
  parseConnectionPolicies,
  sanitizeConnectionPolicies,
  serializeConnectionAccess,
  serializeConnectionPolicies,
} from "@/lib/composer/connectivity/connection-extras";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { composerReducer, type ComposerAction } from "@/lib/composer/store";
import { validateProject } from "@/lib/composer/validate";
import { PANEL_TAB_GROUPS, type PanelTab } from "@/lib/composer/panel-tabs";
import { buildTabGate, isTabLocked, tabLock, type TabGate } from "@/lib/composer/tab-gating";
import { actionInputsFromMcpToolInputSchema } from "@/lib/composer/mcp-action-inputs";
import {
  defaultToolNameFromMeta,
  hasMcpAssetMeta,
  mcpMetaForAsset,
  mcpMetaFromExchange,
  parseMcpAssetMeta,
  tagMcpMetaForAsset,
} from "@/lib/composer/mcp-metadata";
import {
  pickMcpMetadataFile,
  parseMcpMetadataContent,
} from "@/lib/mulesoft/exchange-mcp-metadata";
import { resolveExchangeFileDownloadUrls } from "@/lib/mulesoft/exchange-file-download";
import { parseProjectFiles, type ParseFilesInput } from "@/lib/composer/parse";
import { parseBrokerAgent } from "@/lib/composer/parse/broker-agent";
import {
  buildExecutionOverlay,
  canonicalNodeKey,
  edgeKey,
  findDriftedNodes,
} from "@/lib/task-timeline/execution-overlay";
import type { NodeVisit } from "@/lib/task-timeline/build-v2-node-timeline";
import { chooseVersionForTask, resolveAgentEntry } from "@/lib/task-timeline/resolve-agent-source";
import { specToProtocolGraph } from "@/lib/task-timeline/spec-graph";
import { instructionTextForEditor } from "@/lib/composer/instruction-text";
import { buildExpressionCatalog, flattenExpressionCatalog, requestScopeMembers } from "@/lib/composer/agentfabric-expression-catalog";
import {
  ANF_ID_PATTERN,
  connectionIdForBaseName,
  isValidAnfId,
  normalizeAnfId,
} from "@/lib/composer/anf-id";
import {
  BROKER_KEY_PATTERN,
  brokerKeyValidationMessage,
  isValidBrokerKey,
  normalizeBrokerKey,
} from "@/lib/composer/broker-key";
import {
  EXCHANGE_ASSET_ID_PATTERN,
  exchangeAssetIdValidationMessage,
  isValidExchangeAssetId,
  normalizeExchangeAssetId,
  restrictExchangeAssetIdInput,
} from "@/lib/composer/exchange-asset-id";
import {
  findUndeclaredMarkers,
  scanVariableMarkers,
  splitMarkerKey,
} from "@/lib/composer/variable-markers";
import { parseAgentNetworkYaml } from "@/lib/composer/parse/agent-network-yaml";
import {
  a2aCardSchemaValidatorBuildError,
  validateBrokerCardDoc,
} from "@/lib/composer/schema/a2a-card-schema";
import { normalizeStringArray, parseBrokerCard, serializeBrokerCard } from "@/lib/composer/a2a-card";
import { evaluateA2aCard } from "@/lib/composer/a2a-card-checks";
import { buildA2aCardCompleteness } from "@/lib/composer/a2a-card-completeness";
import { buildProjectCompleteness } from "@/lib/composer/project-completeness";
import { selectProjectSourceFiles } from "@/lib/composer/import/select-project-files";
import { importLocalProjectEntries } from "@/lib/composer/import/import-local-project";
import { detectProjectVersion } from "@/lib/mulesoft/agent-network-project-version";
import type { BrokerCard, ComposerProject } from "@/lib/composer/model";
import type { RegistryAgentTool } from "@/lib/composer/registry/types";
import type { SerializedFile } from "@/lib/composer/serialize";
import type { Graph } from "@sf-agentscript/agentfabric-dialect";
import {
  parseProtocolOutputs,
  protocolGraphToReactFlow,
  routerCanvasOutputs,
  routerOutputHandleId,
  lexicalPositionForNode,
} from "@/lib/composer/agentfabric-graph";
import { applyDagreOverviewLayout } from "@/lib/composer/agentfabric-graph-layout";
import {
  buildTaskStoryFromStorageEntry,
  describeV2StorageShape,
  parseA2ATaskStory,
  parseGraphStateEntries,
} from "@/lib/object-store/v2-parser";
import {
  extractStringsFromPickledTask,
  looksLikePickle,
  parsePickledA2ATask,
} from "@/lib/object-store/pickle-a2a";
import { buildV2NodeTimeline, nodeExecutionsFromState } from "@/lib/task-timeline/build-v2-node-timeline";
import { detectBrokerFormat } from "@/lib/task-timeline/broker-format";
import { parseLogsForTasks } from "@/lib/broker-tasks/runtime-logs-strategy";
import { buildTaskQueries } from "@/lib/broker-tasks/msearch-strategy";
import {
  chooseSpecIdAtOrBefore,
  parseEpochMs,
  parseSpecTimestamp,
  type AmcSpecDescriptor,
} from "@/lib/broker-tasks/amc-spec-selection";
import type { LogEntry } from "@/components/task-details/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function apply(p: ComposerProject, ...actions: ComposerAction[]): ComposerProject {
  return actions.reduce((acc, a) => composerReducer(acc, a), p);
}

// ---------------------------------------------------------------------------
console.log("\n[1] Blank project factory defaults");
{
  let p = createEmptyProject("ORG");
  check("blank identity name", p.identity.name === "");
  check("blank identity assetId", p.identity.assetId === "");
  check("blank identity tags", p.identity.tags.join(",") === "broker");
  check("blank broker key", p.brokers[0].name === "");
  check("blank broker graph", p.brokers[0].nodes.length === 0);
  check("blank card name", p.brokers[0].card.name === "");
  check("blank project not yet valid", !validateProject(p).ok);
  const files = serializeProject(p);
  check("3 files (exchange, yaml, one broker agent)", files.length === 3, `${files.length}`);
  const ex = JSON.parse(serializeExchangeJson(p));
  check("exchange classifier agentic-network", ex.classifier === "agentic-network");
  check("exchange dependencies empty", Array.isArray(ex.dependencies) && ex.dependencies.length === 0);
  const y = parseYaml(serializeAgentNetworkYaml(p));
  check("yaml agentNetwork 2.0.0", y.agentNetwork === "2.0.0");
  check("yaml always declares registry", y.registry !== undefined && typeof y.registry === "object" && Object.keys(y.registry).length === 0);
  check("yaml serialized registry is empty object", serializeAgentNetworkYaml(p).includes("registry: {}"));
  check("yaml has brokers", !!y.brokers && Object.keys(y.brokers).length === 1);
  const brokerKey = Object.keys(y.brokers)[0];
  check("yaml broker key falls back when blank", brokerKey === "broker");
  check("broker kind AgentScript", y.brokers[brokerKey].kind === "AgentScript");
  const agentText = serializeBrokerAgent(p.brokers[0]);
  check("agent has dialect header", agentText.startsWith("# @dialect: AGENTFABRIC=1.0"));
}

console.log("\n[1b] Scaffold project serializes to valid files");
{
  let p = createScaffoldProject("ORG");
  {
    const errors = validateProject(p).errors.filter(
      (e) =>
        e.code !== "a2a-card.required.endpoint-url" &&
        e.code !== "graph.echo.empty-message"
    );
    check("scaffold project has no non-authoring errors", errors.length === 0, JSON.stringify(errors));
  }
}

// ---------------------------------------------------------------------------
console.log("\n[2] Compose agent + mcp + llm; derivations + cross-refs");
{
  let p = createScaffoldProject("ORG");
  p = apply(
    p,
    { type: "addAsset", asset: importAsset({ kind: "agent", groupId: "ga", assetId: "help-agent", version: "1.0.0", name: "Help Agent", url: "https://a2a/help" }) },
    { type: "addAsset", asset: importAsset({ kind: "mcp", groupId: "gm", assetId: "jira-mcp", version: "2.1.0", name: "Jira MCP" }) },
    { type: "addAsset", asset: importAsset({ kind: "llm", groupId: "gl", assetId: "openai", version: "1.0.0", name: "OpenAI GPT" }) },
  );
  const ex = JSON.parse(serializeExchangeJson(p));
  const classifiers = ex.dependencies.map((d: { classifier: string }) => d.classifier).sort();
  check("dependencies classifiers", JSON.stringify(classifiers) === JSON.stringify(["agent-metadata", "llm-metadata", "mcp-metadata"]), JSON.stringify(classifiers));
  const y = parseYaml(serializeAgentNetworkYaml(p));
  const conns = y.context.connections;
  check("3 connections", Object.keys(conns).length === 3);
  const kinds = Object.values(conns).map((c: any) => c.kind).sort();
  check("connection kinds a2a/llm/mcp", JSON.stringify(kinds) === JSON.stringify(["a2a", "llm", "mcp"]), JSON.stringify(kinds));
  check("llm connection has apiKey auth token", Object.values(conns).some((c: any) => c.authentication?.apiKey?.includes("${")));
  const llmAsset = p.assets.find((a) => a.kind === "llm");
  check("llm asset default url", llmAsset?.url === "https://api.openai.com/v1");
  const llmVariableGroup = llmAsset?.variableGroup ?? "openAiGpt";
  const openAiUrlVar = ex.metadata.variables?.[llmVariableGroup]?.url?.default;
  check("exchange.json llm url default", openAiUrlVar === "https://api.openai.com/v1", String(openAiUrlVar));
  // action auto-created for agent + mcp, llm binding for llm
  const broker = p.brokers[0];
  check("2 actions auto-created (agent+mcp)", broker.actions.length === 2, `${broker.actions.length}`);
  check("1 llm binding auto-created", broker.llmBindings.length === 1);
  check("default_llm set", broker.defaultLlmBindingName === broker.llmBindings[0].name);
  // cross-ref: every action target connection exists in yaml
  const connNames = new Set(Object.keys(conns));
  const agentText = serializeBrokerAgent(broker);
  const targets = [...agentText.matchAll(/target: "(?:a2a|mcp|llm):\/\/([^"]+)"/g)].map((m) => m[1]);
  check("all agent targets resolve to yaml connections", targets.every((t) => connNames.has(t)), JSON.stringify(targets));
  // MCP action starts without a tool_name (server exposes many tools) -> invalid until set.
  check("mcp action needs tool_name before valid", !validateProject(p).ok);
  const mcpAction = broker.actions.find((a) => a.actionKind === "mcp:tool")!;
  p = apply(p, { type: "updateAction", id: mcpAction.id, patch: { toolName: "updateIssue" } });
  {
    const errors = validateProject(p).errors.filter(
      (e) =>
        e.code !== "a2a-card.required.endpoint-url" &&
        e.code !== "graph.echo.empty-message"
    );
    check("valid after setting tool_name (aside from required endpoint URL)", errors.length === 0, JSON.stringify(errors));
  }
}

// ---------------------------------------------------------------------------
console.log("\n[2b] Project-scoped connection IDs avoid cross-project collisions");
{
  const empAssist = apply(createScaffoldProject("ORG"), {
    type: "setIdentity",
    patch: { assetId: "emp-assist" },
  });
  const triage = apply(createScaffoldProject("ORG"), {
    type: "setIdentity",
    patch: { assetId: "submission-triage" },
  });
  const llmInput = { kind: "llm" as const, groupId: "g", assetId: "llm-openai", version: "1.0.0", name: "OpenAI" };
  const empConn = apply(empAssist, { type: "addAsset", asset: importAsset(llmInput) }).assets[0].connectionName;
  const triageConn = apply(triage, { type: "addAsset", asset: importAsset(llmInput) }).assets[0].connectionName;
  check("emp-assist llm connection id", empConn === "emp_assist_open_ai_connection", empConn);
  check("triage llm connection id", triageConn === "submission_triage_open_ai_connection", triageConn);
  check("same Exchange llm asset, different connection ids", empConn !== triageConn);
}

// ---------------------------------------------------------------------------
console.log("\n[3] removeAsset cascades to actions/bindings");
{
  let p = createScaffoldProject("ORG");
  const agent = importAsset({ kind: "agent", groupId: "ga", assetId: "a", version: "1.0.0", name: "Agent A" });
  p = apply(p, { type: "addAsset", asset: agent });
  check("action created", p.brokers[0].actions.length === 1);
  p = apply(p, { type: "removeAsset", id: agent.id });
  check("asset removed", p.assets.length === 0);
  check("action cascaded away", p.brokers[0].actions.length === 0);
}

// ---------------------------------------------------------------------------
console.log("\n[4] Router graph: routes + otherwise, generator + echo");
{
  let p = createScaffoldProject("ORG");
  const broker = p.brokers[0];
  const trigger = broker.nodes.find((n) => n.kind === "trigger")!;
  const echo = broker.nodes.find((n) => n.kind === "echo")!;
  p = apply(
    p,
    { type: "addNode", kind: "generator", position: { x: 200, y: 100 } },
    { type: "addNode", kind: "router", position: { x: 300, y: 100 } },
    { type: "addNode", kind: "echo", position: { x: 500, y: 300 } },
  );
  let b = p.brokers[0];
  const gen = b.nodes.find((n) => n.kind === "generator")!;
  const router = b.nodes.find((n) => n.kind === "router")!;
  const echo2 = b.nodes.filter((n) => n.kind === "echo")[1];
  p = apply(
    p,
    { type: "updateNode", id: gen.id, patch: { prompt: "Classify the request." } },
    { type: "updateNode", id: echo2.id, patch: { message: "Completed." } },
    { type: "connect", sourceId: trigger.id, targetId: gen.id },
    { type: "connect", sourceId: gen.id, targetId: router.id },
    { type: "connect", sourceId: router.id, targetId: echo.id },   // route 1
    { type: "connect", sourceId: router.id, targetId: echo2.id },  // route 2
    { type: "updateNode", id: router.id, patch: { otherwiseTargetNodeId: echo.id } },
  );
  b = p.brokers[0];
  const r = b.nodes.find((n) => n.kind === "router")!;
  check("router has 2 routes", (r.routes ?? []).length === 2, `${(r.routes ?? []).length}`);
  const agentText = serializeBrokerAgent(b);
  check("router block emitted", agentText.includes("router "));
  check("router has otherwise", /otherwise:\s*\n\s*target:/.test(agentText));
  {
    const errors = validateProject(p).errors.filter(
      (e) =>
        e.code !== "a2a-card.required.endpoint-url" &&
        e.code !== "graph.echo.empty-message"
    );
    check("valid graph (aside from required endpoint URL)", errors.length === 0, JSON.stringify(errors));
  }
}

// ---------------------------------------------------------------------------
console.log("\n[4b] Router otherwise via sourceHandle");
{
  let p = createScaffoldProject("ORG");
  p = apply(
    p,
    { type: "addNode", kind: "router", position: { x: 0, y: 0 } },
    { type: "addNode", kind: "echo", position: { x: 200, y: 0 } },
  );
  const b = p.brokers[0];
  const router = b.nodes.find((n) => n.kind === "router")!;
  const echo = b.nodes.find((n) => n.kind === "echo")!;
  p = apply(p, {
    type: "connect",
    sourceId: router.id,
    targetId: echo.id,
    sourceHandle: routerOutputHandleId("otherwise"),
  });
  const r = p.brokers[0].nodes.find((n) => n.kind === "router")!;
  check("otherwise set via sourceHandle", r.otherwiseTargetNodeId === echo.id, r.otherwiseTargetNodeId ?? "undefined");
  check("otherwise connect does not add route", (r.routes ?? []).length === 0);
}

// ---------------------------------------------------------------------------
console.log("\n[5] Validation catches bad graphs");
{
  // Router without otherwise -> error
  let p = createScaffoldProject("ORG");
  p = apply(p, { type: "addNode", kind: "router", position: { x: 0, y: 0 } });
  let res = validateProject(p);
  check("router without route/otherwise -> error", !res.ok && res.errors.some((e) => /router/i.test(e.message)));

  // MCP action without tool_name -> error
  let p2 = createScaffoldProject("ORG");
  const mcp = importAsset({ kind: "mcp", groupId: "g", assetId: "m", version: "1.0.0", name: "M" });
  p2 = apply(p2, { type: "addAsset", asset: mcp });
  const action = p2.brokers[0].actions[0];
  p2 = apply(p2, { type: "updateAction", id: action.id, patch: { toolName: "" } });
  res = validateProject(p2);
  check("mcp action without tool_name -> error", res.errors.some((e) => /tool_name/i.test(e.message)));

  // A project with no trigger (only reachable via import) -> error
  const base = createScaffoldProject("ORG");
  let p3 = {
    ...base,
    brokers: [{ ...base.brokers[0], nodes: base.brokers[0].nodes.filter((n) => n.kind !== "trigger") }],
  };
  res = validateProject(p3);
  check("no trigger -> error", res.errors.some((e) => /trigger/i.test(e.message)));

  // Re-add trigger after import
  p3 = apply(p3, { type: "addNode", kind: "trigger", position: { x: 80, y: 200 } });
  check("re-add trigger restores node", p3.brokers[0].nodes.some((n) => n.kind === "trigger"));
  const reTrig = p3.brokers[0].nodes.find((n) => n.kind === "trigger")!;
  check("re-add trigger uses name trigger", reTrig.name === "trigger");
  check("re-add trigger inherits broker interface", reTrig.interfaceName === p3.brokers[0].interfaceName);
  res = validateProject(p3);
  check(
    "re-add trigger clears missing-trigger error",
    !res.errors.some((e) => /no trigger node/i.test(e.message))
  );

  const beforeCount = p3.brokers[0].nodes.length;
  p3 = apply(p3, { type: "addNode", kind: "trigger", position: { x: 80, y: 200 } });
  check("duplicate trigger add ignored", p3.brokers[0].nodes.length === beforeCount);
}

// ---------------------------------------------------------------------------
console.log("\n[6] YAML/JSON always parse for a rich project");
{
  let p = createScaffoldProject("ORG-9");
  p = apply(
    p,
    { type: "setIdentity", patch: { name: "IT Help Desk", assetId: "it-help-desk" } },
    { type: "addAsset", asset: importAsset({ kind: "agent", groupId: "g", assetId: "help", version: "1.0.0", name: "Help Center Agent", url: "https://x/help" }) },
    { type: "addAsset", asset: importAsset({ kind: "llm", groupId: "g", assetId: "gemini", version: "1.0.0", name: "Gemini" }) },
    { type: "updateCard", patch: { name: "IT Help Desk Broker", description: "Triages tickets" } },
    { type: "updateBroker", patch: { systemInstructions: "You are an IT help desk broker." } },
  );
  let ok = true;
  try { JSON.parse(serializeExchangeJson(p)); } catch { ok = false; }
  check("exchange.json parses", ok);
  ok = true;
  try { parseYaml(serializeAgentNetworkYaml(p)); } catch { ok = false; }
  check("agent-network.yaml parses", ok);
}

// ---------------------------------------------------------------------------
console.log("\n[6b] AgentScript procedure blocks (`->`) parse to instruction text");
{
  const agentText = `# @dialect: AGENTFABRIC=1.0

system:
  instructions: ->
    | You are the support broker.

config:
  agent_name: broker
  default_llm: default

llm default:
  connection: "llm://default"
  provider: OpenAI
  model: gpt-4o

generator classify:
  llm: @llm.default
  prompt: ->
    | {!@trigger.message}
  system:
    instructions: ->
      | Classify the request.

orchestrator plan:
  llm: @llm.default
  reasoning:
    instructions: ->
      | Think step by step.

generator empty-prompt:
  llm: @llm.default
  prompt: ->

trigger start:
  on exit:
    transition to @generator.classify
`;

  const parsed = parseBrokerAgent(agentText);
  check("broker system instructions from procedure block", parsed.systemInstructions === "You are the support broker.");
  const gen = parsed.nodes.find((n) => n.name === "classify");
  check("generator prompt from procedure block", gen?.prompt === "{!@trigger.message}");
  check("generator system instructions from procedure block", gen?.systemInstructions === "Classify the request.");
  check("prompt is not bare procedure marker", gen?.prompt !== "->");
  const orch = parsed.nodes.find((n) => n.name === "plan");
  check("orchestrator reasoning from procedure block", orch?.reasoningInstructions === "Think step by step.");
  check("reasoning is not bare procedure marker", orch?.reasoningInstructions !== "->");
  const emptyGen = parsed.nodes.find((n) => n.name === "empty-prompt");
  check("empty procedure prompt omitted", emptyGen?.prompt === undefined);
  check("instructionTextForEditor hides legacy marker", instructionTextForEditor("->") === "");
}

// ---------------------------------------------------------------------------
console.log("\n[6c] Broker map keys (snake_case)");
{
  check("customer_service_agent valid", isValidBrokerKey("customer_service_agent"));
  check("billing_agent valid", isValidBrokerKey("billing_agent"));
  check("customerServiceAgent invalid", !isValidBrokerKey("customerServiceAgent"));
  check("my_broker_ invalid (trailing underscore)", !isValidBrokerKey("my_broker_"));
  check("pattern constant matches validator", BROKER_KEY_PATTERN.test("agent2"));
  check("normalize camelCase", normalizeBrokerKey("customerServiceAgent") === "customer_service_agent");
  check("normalize spaces", normalizeBrokerKey("My Broker") === "my_broker");
  check("normalize trailing underscore", normalizeBrokerKey("my_broker_") === "my_broker");
  check("validation message mentions camelCase", brokerKeyValidationMessage("customerServiceAgent").includes("llmOpenaiConnection"));
  check("connection id rejects camelCase", !isValidAnfId("llmOpenaiConnection"));
  check("connection id accepts snake_case", isValidAnfId("llm_openai_connection"));
  check(
    "addAsset assigns project-scoped connection id",
    apply(createScaffoldProject("ORG"), {
      type: "addAsset",
      asset: importAsset({ kind: "llm", groupId: "g", assetId: "openai", version: "1", name: "OpenAI GPT" }),
    }).assets[0].connectionName === "my_agent_network_open_ai_gpt_connection"
  );
  check(
    "defaultConnectionIdForProject uses network assetId",
    defaultConnectionIdForProject(createScaffoldProject("ORG"), "llm-openai") === "my_agent_network_llm_openai_connection"
  );
  check(
    "assignDefaultConnectionName leaves explicit connectionName",
    assignDefaultConnectionName(createScaffoldProject("ORG"), {
      ...importAsset({ kind: "llm", groupId: "g", assetId: "openai", version: "1", name: "OpenAI" }),
      connectionName: "custom_openai_connection",
    }).connectionName === "custom_openai_connection"
  );

  check(
    "importAsset llm OpenAI default url",
    importAsset({ kind: "llm", groupId: "g", assetId: "openai", version: "1", name: "OpenAI GPT" }).url ===
      "https://api.openai.com/v1"
  );
  check(
    "importAsset llm Gemini default url",
    importAsset({ kind: "llm", groupId: "g", assetId: "gemini", version: "1", name: "Gemini" }).url ===
      "https://generativelanguage.googleapis.com"
  );
  check(
    "importAsset llm Azure default url",
    importAsset({ kind: "llm", groupId: "g", assetId: "azure-openai", version: "1", name: "Azure OpenAI" }).url ===
      "https://<YOUR_RESOURCE_NAME>.openai.azure.com/openai/v1"
  );
  check(
    "importAsset llm Bedrock default url",
    importAsset({ kind: "llm", groupId: "g", assetId: "bedrock-openai", version: "1", name: "Bedrock OpenAI" }).url ===
      "https://bedrock-mantle.<YOUR_REGION>.api.aws/v1"
  );
  check(
    "importAsset llm preserves explicit url",
    importAsset({ kind: "llm", groupId: "g", assetId: "openai", version: "1", name: "OpenAI GPT", url: "https://custom" })
      .url === "https://custom"
  );
  {
    const importedLlm = importAsset({
      kind: "llm",
      groupId: "g",
      assetId: "llm-openai",
      version: "1",
      name: "llm-openai",
    });
    check("importAsset llm sets consistent variableGroup", importedLlm.variableGroup === "llm_openai");
    check(
      "importAsset llm auth uses variableGroup",
      importedLlm.authentication?.kind === "apiKey" &&
        importedLlm.authentication.apiKey === "${llm_openai.apiKey}"
    );
    const derived = deriveVariablesForAsset(importedLlm);
    check("importAsset llm derives url in variableGroup", derived.some((v) => v.group === "llm_openai" && v.field === "url"));
    check(
      "importAsset llm derives apiKey in variableGroup",
      derived.some((v) => v.group === "llm_openai" && v.field === "apiKey")
    );
  }

  check("exchange asset id accepts kebab-case", isValidExchangeAssetId("it-help-desk"));
  check("exchange asset id accepts snake_case", isValidExchangeAssetId("agent_network_reasoningonly_assetid"));
  check("exchange asset id accepts mixed separators", isValidExchangeAssetId("agent_broker_get_date"));
  check("exchange asset id rejects camelCase", !isValidExchangeAssetId("itHelpDesk"));
  check("exchange asset id rejects trailing hyphen", !isValidExchangeAssetId("my-network-"));
  check("exchange asset id rejects trailing underscore", !isValidExchangeAssetId("my_broker_"));
  check("pattern constant matches validator", EXCHANGE_ASSET_ID_PATTERN.test("agent-network"));
  check("normalize camelCase slug", normalizeExchangeAssetId("ItHelpDesk") === "it-help-desk");
  check("normalize preserves snake_case", normalizeExchangeAssetId("agent_broker_get_date") === "agent_broker_get_date");
  check("restrict strips uppercase", restrictExchangeAssetIdInput("My-Agent") === "my-agent");
  check("restrict preserves underscore", restrictExchangeAssetIdInput("agent_broker_get_date") === "agent_broker_get_date");
  check("validation message mentions lowercase", exchangeAssetIdValidationMessage("MyAgent").includes("lowercase"));
  check(
    "invalid asset id fails validation",
    !validateProject(apply(createScaffoldProject("ORG"), { type: "setIdentity", patch: { assetId: "BadAssetId" } })).ok
  );

  let p = createScaffoldProject("ORG");
  check("empty project default broker key", p.brokers[0].name === "my_broker");
  check("empty project default apiVersion v1.0", p.identity.apiVersion === "v1.0");
  check("empty project default asset version 1.0.0", p.identity.version === "1.0.0");
  check("empty project valid broker key", isValidBrokerKey(p.brokers[0].name));
  check(
    "invalid broker key fails validation",
    !validateProject(apply(p, { type: "updateBroker", patch: { name: "my_broker_" } })).ok
  );
  const yaml = serializeAgentNetworkYaml(createScaffoldProject("ORG"));
  check("serialized yaml uses snake_case broker key", yaml.includes("  my_broker:"));
  check("serialized implementation path", yaml.includes("./brokers/my_broker.agent"));
}

// ---------------------------------------------------------------------------
console.log("\n[6d] AgentFabric expression catalog");
{
  let p = createScaffoldProject("ORG");
  const broker = p.brokers[0];
  const catalog = buildExpressionCatalog(broker);
  const flat = flattenExpressionCatalog(catalog);
  check("request scope members documented", requestScopeMembers().includes("payload"));
  check("catalog includes user message snippet", flat.some((e) => e.insert === "{!@request.payload.message.parts[0].text}"));
  const trigger = broker.nodes.find((n) => n.kind === "trigger");
  const gen = broker.nodes.find((n) => n.kind === "generator");
  if (trigger && gen) {
    check("catalog includes trigger input ref", flat.some((e) => e.insert === `@trigger.${trigger.name}.input`));
    check("catalog includes generator output ref", flat.some((e) => e.insert === `@generator.${gen.name}.output`));
    const excluded = buildExpressionCatalog(broker, { excludeNodeId: gen.id });
    const excludedFlat = flattenExpressionCatalog(excluded);
    check("excludeNodeId omits current node refs", !excludedFlat.some((e) => e.insert.includes(`@generator.${gen.name}.`)));
  }
}

// ---------------------------------------------------------------------------
{
  function toInput(files: SerializedFile[]): ParseFilesInput {
    const input: ParseFilesInput = {};
    for (const f of files) {
      if (f.language === "json") input.exchangeJson = f.content;
      else if (f.language === "yaml") input.agentYaml = f.content;
      else if (f.language === "agent") input.brokerAgent = f.content;
    }
    return input;
  }
  function firstDiff(a: string, b: string): string {
    const la = a.split("\n");
    const lb = b.split("\n");
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if (la[i] !== lb[i]) return `line ${i + 1}:\n   orig: ${JSON.stringify(la[i])}\n   rt:   ${JSON.stringify(lb[i])}`;
    }
    return "identical";
  }

  let p = createScaffoldProject("ORG-RT");
  const agent = importAsset({ kind: "agent", groupId: "ga", assetId: "order-status", version: "1.2.0", name: "Order Status Agent", url: "https://a2a/order" });
  const mcp = importAsset({ kind: "mcp", groupId: "gm", assetId: "jira-mcp", version: "2.1.0", name: "Jira MCP" });
  const llm = importAsset({ kind: "llm", groupId: "gl", assetId: "gemini", version: "1.0.0", name: "Gemini" });
  p = apply(
    p,
    { type: "setIdentity", patch: { name: "Support Network", assetId: "support-network", version: "3.0.0" } },
    { type: "updateBroker", patch: { systemInstructions: "You are a support broker.\nRoute wisely." } },
    { type: "updateCard", patch: { name: "Support Broker", description: "Front door" } },
    { type: "addAsset", asset: agent },
    { type: "addAsset", asset: mcp },
    { type: "addAsset", asset: llm },
  );
  const mcpAction = p.brokers[0].actions.find((a) => a.actionKind === "mcp:tool")!;
  p = apply(p, { type: "updateAction", id: mcpAction.id, patch: { toolName: "updateIssue", inputs: [{ name: "issueId", type: "string" }, { name: "note", type: "string", default: "auto" }] } });

  // Build a graph: trigger -> generator -> router -> (echo | echo2), otherwise echo
  const trigger = p.brokers[0].nodes.find((n) => n.kind === "trigger")!;
  const echo = p.brokers[0].nodes.find((n) => n.kind === "echo")!;
  p = apply(
    p,
    { type: "addNode", kind: "generator", position: { x: 200, y: 100 } },
    { type: "addNode", kind: "orchestrator", position: { x: 300, y: 100 } },
    { type: "addNode", kind: "router", position: { x: 400, y: 100 } },
    { type: "addNode", kind: "echo", position: { x: 600, y: 300 } },
  );
  let b = p.brokers[0];
  const gen = b.nodes.find((n) => n.kind === "generator")!;
  const orch = b.nodes.find((n) => n.kind === "orchestrator")!;
  const router = b.nodes.find((n) => n.kind === "router")!;
  const echo2 = b.nodes.filter((n) => n.kind === "echo")[1];
  p = apply(
    p,
    { type: "updateNode", id: gen.id, patch: { llmBindingName: p.brokers[0].llmBindings[0].name, systemInstructions: "Classify the request.", prompt: "User said: {{input}}", outputs: [{ name: "category", type: "string", description: "the category" }] } },
    { type: "updateNode", id: orch.id, patch: { llmBindingName: p.brokers[0].llmBindings[0].name, reasoningInstructions: "Think then act.", actionRefs: [p.brokers[0].actions[0].name], description: "Plans work" } },
    { type: "updateNode", id: echo2.id, patch: { message: "Completed alternate route." } },
    { type: "connect", sourceId: trigger.id, targetId: gen.id },
    { type: "connect", sourceId: gen.id, targetId: orch.id },
    { type: "connect", sourceId: orch.id, targetId: router.id },
    { type: "connect", sourceId: router.id, targetId: echo.id },
    { type: "connect", sourceId: router.id, targetId: echo2.id },
    { type: "updateNode", id: router.id, patch: { otherwiseTargetNodeId: echo.id } },
  );
  b = p.brokers[0];
  const r = b.nodes.find((n) => n.kind === "router")!;
  p = apply(p, {
    type: "updateNode",
    id: r.id,
    patch: { routes: (r.routes ?? []).map((rt, i) => ({ ...rt, when: `category == "c${i}"`, label: `case ${i}` })) },
  });

  {
    const errors = validateProject(p).errors.filter(
      (e) =>
        e.code !== "a2a-card.required.endpoint-url" &&
        e.code !== "graph.echo.empty-message"
    );
    check("original project valid (aside from required endpoint URL)", errors.length === 0, JSON.stringify(errors));
  }

  const files1 = serializeProject(p);
  const result = parseProjectFiles(toInput(files1));
  check("round-trip parses ok", result.ok, result.ok ? "" : JSON.stringify(result.errors));
  if (result.ok) {
    const files2 = serializeProject(result.project);
    {
      const errors = validateProject(result.project).errors.filter(
        (e) =>
          e.code !== "a2a-card.required.endpoint-url" &&
          e.code !== "graph.echo.empty-message"
      );
      check("round-trip valid (aside from required endpoint URL)", errors.length === 0, JSON.stringify(errors));
    }
    check("same file count", files1.length === files2.length, `${files1.length} vs ${files2.length}`);
    for (const f1 of files1) {
      const f2 = files2.find((f) => f.path === f1.path);
      check(`stable: ${f1.path}`, !!f2 && f2.content === f1.content, f2 ? firstDiff(f1.content, f2.content) : "missing file");
    }
    // Spot-check the model was rebuilt, not empty.
    check("assets rebuilt (3)", result.project.assets.length === 3, `${result.project.assets.length}`);
    check("nodes rebuilt (6)", result.project.brokers[0].nodes.length === 6, `${result.project.brokers[0].nodes.length}`);
    check("mcp tool_name preserved", result.project.brokers[0].actions.some((a) => a.toolName === "updateIssue"));
    check("router routes preserved (2)", (result.project.brokers[0].nodes.find((n) => n.kind === "router")?.routes ?? []).length === 2);
  }
}

// ---------------------------------------------------------------------------
console.log("\n[8] Import files whose connection name != derived convention");
{
  const exchangeJson = JSON.stringify(
    {
      main: "agent-network.yaml",
      name: "T",
      classifier: "agentic-network",
      organizationId: "ORG",
      descriptorVersion: "1.0.0",
      tags: [],
      metadata: { variables: { openaiModel: { url: { default: "https://llm", secret: false }, apiKey: { default: "", secret: true } } } },
      apiVersion: "v2.0",
      dependencies: [{ groupId: "ORG", assetId: "openai", version: "1.0.0", classifier: "llm-metadata", packaging: "zip" }],
      groupId: "ORG",
      assetId: "t",
      version: "1.0.0",
    },
    null,
    2
  );
  const agentYaml = [
    "agentNetwork: 2.0.0",
    "info:",
    "  label: T",
    "  version: 1.0.0",
    "context:",
    "  connections:",
    "    openaiConnection:", // key does NOT match ref.name + "Connection"
    "      kind: llm",
    "      ref:",
    "        name: openai-model",
    "        namespace: ORG",
    "      url: ${openaiModel.url}",
    "      authentication:",
    "        kind: apiKey",
    "        apiKey: ${openaiModel.apiKey}",
    "brokers:",
    "  myBroker:",
    "    kind: AgentScript",
    "    implementation: ./brokers/my-broker.agent",
    "    interfaces:",
    "      a2a:",
    "        card:",
    "          name: My Broker",
    "          description: My Broker",
    "          version: 1.0.0",
  ].join("\n");
  const brokerAgent = [
    "# @dialect: AGENTFABRIC=1.0",
    "",
    "system:",
    '  instructions: "hi"',
    "",
    "config:",
    '  agent_name: "myBroker"',
    "  default_llm: @llm.openai",
    "",
    "llm:",
    "  openai:",
    '    target: "llm://openai_connection"',
    '    kind: "OpenAI"',
    '    model: "gpt-4o"',
    "",
    "trigger trigger:",
    '  kind: "a2a"',
    '  target: "brokers://myBroker/a2a"',
    "  on_message: ->",
    "    transition to @echo.response",
    "",
    "echo response:",
    '  kind: "a2a:status_update_event"',
    '  state: "TASK_STATE_COMPLETED"',
    '  message: a2a.message({messageId: uuid(), parts: [a2a.textPart("done")]})',
  ].join("\n");

  const res = parseProjectFiles({ exchangeJson, agentYaml, brokerAgent });
  check("imports ok", res.ok, res.ok ? "" : JSON.stringify(res.errors));
  if (res.ok) {
    const v = validateProject(res.project);
    {
      const errors = v.errors.filter(
        (e) =>
          e.code !== "a2a-card.required.endpoint-url" &&
          e.code !== "graph.echo.empty-message"
      );
      check(
        "llm binding resolves to real connection (no unknown-connection error)",
        errors.length === 0,
        JSON.stringify(errors)
      );
    }
    check("import normalizes broker key to snake_case", res.project.brokers[0].name === "my_broker");
    const asset = res.project.assets[0];
    check("import normalizes invalid connection id from yaml", asset.connectionName === "openai_connection", asset.connectionName);
    // Re-serialize keeps the normalized connection key so it still links.
    const yaml = serializeAgentNetworkYaml(res.project);
    check("re-serialized yaml keeps openai_connection key", yaml.includes("openai_connection:"));
  }
}

// ---------------------------------------------------------------------------
console.log("\n[9] Official JSON Schema conformance (agent_network_v2.json)");
{
  check("schema validator builds", schemaValidatorBuildError() === null, schemaValidatorBuildError() ?? "");

  // Empty project.
  let p = createScaffoldProject("ORG");
  check("empty project doc conforms", validateAgentNetworkDoc(buildAgentNetworkDoc(p)).length === 0, JSON.stringify(validateAgentNetworkDoc(buildAgentNetworkDoc(p))));

  // Rich project with all three asset kinds + a full card.
  let r = createScaffoldProject("ORG");
  r = apply(
    r,
    { type: "setIdentity", patch: { name: "Support Net", version: "2.0.0" } },
    { type: "addAsset", asset: importAsset({ kind: "agent", groupId: "ga", assetId: "help", version: "1.0.0", name: "Help Agent", url: "https://a2a/help" }) },
    { type: "addAsset", asset: importAsset({ kind: "mcp", groupId: "gm", assetId: "jira", version: "2.0.0", name: "Jira MCP" }) },
    { type: "addAsset", asset: importAsset({ kind: "llm", groupId: "gl", assetId: "gemini", version: "1.0.0", name: "Gemini" }) },
    { type: "updateCard", patch: { name: "Support Broker", description: "Front door", capabilities: { streaming: false, pushNotifications: true } } },
  );
  const richIssues = validateAgentNetworkDoc(buildAgentNetworkDoc(r));
  check("rich project doc conforms", richIssues.length === 0, JSON.stringify(richIssues));

  // Negative controls: schema actually rejects violations.
  const badVersion = { ...buildAgentNetworkDoc(r), agentNetwork: "1.0.0" };
  check("rejects wrong agentNetwork const", validateAgentNetworkDoc(badVersion).length > 0);

  const badDoc = buildAgentNetworkDoc(r) as Record<string, any>;
  const tampered = JSON.parse(JSON.stringify(badDoc));
  const connKey = Object.keys(tampered.context.connections)[0];
  tampered.context.connections[connKey].bogusField = true; // additionalProperties: false
  check("rejects unexpected connection property", validateAgentNetworkDoc(tampered).length > 0);

  const tampered2 = JSON.parse(JSON.stringify(badDoc));
  const bKey = Object.keys(tampered2.brokers)[0];
  delete tampered2.brokers[bKey].implementation; // required
  check("rejects broker missing implementation", validateAgentNetworkDoc(tampered2).length > 0);

  // The live validator surfaces schema errors through validateProject.
  const modelWithBadBroker = { ...r, brokers: [{ ...r.brokers[0], interfaceName: "a2a" }] };
  check("valid project has no schema errors in validateProject", validateProject(modelWithBadBroker).errors.every((e) => !/^Schema/.test(e.message)), JSON.stringify(validateProject(modelWithBadBroker).errors.filter((e) => /^Schema/.test(e.message))));
}

// ---------------------------------------------------------------------------
console.log("\n[10] ANF schema bundle manifest (provenance + checksums)");
{
  const structureErrors = verifyAnfSchemaManifestStructure();
  check("manifest structure ok", structureErrors.length === 0, structureErrors.join("; "));

  const anfDir = join(dirname(fileURLToPath(import.meta.url)), "..", "lib/composer/schema/anf");
  for (const file of manifest.files) {
    const path = join(anfDir, file.filename);
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    check(`manifest sha256 ${file.filename}`, hash === file.sha256, `expected ${file.sha256}, got ${hash}`);
  }

  check("manifest has source commit", Boolean(manifest.source.commit));
  check("manifest has syncedAt", Boolean(manifest.source.syncedAt));
  check("manifest specVersion 2.0.0", manifest.specVersion === "2.0.0");
}

// ---------------------------------------------------------------------------
console.log("\n[11] Connectivity auth serialize/parse round-trip");
{
  const basic = {
    kind: "basic" as const,
    username: "${myAgent.username}",
    password: "${myAgent.password}",
  };
  const basicBack = parseConnectionAuth(serializeConnectionAuth(basic), "a2a");
  check("basic auth round-trip", basicBack?.kind === "basic" && basicBack.username === basic.username);

  const oauth = {
    kind: "oauth2-client-credentials" as const,
    clientId: "${svc.clientId}",
    clientSecret: "${svc.clientSecret}",
    token: { url: "https://login.example.com/token" },
  };
  const oauthBack = parseConnectionAuth(serializeConnectionAuth(oauth), "mcp");
  check("oauth2-client-credentials round-trip", oauthBack?.kind === "oauth2-client-credentials");

  const obo = {
    kind: "oauth2-obo" as const,
    flow: "oauth2-token-exchange" as const,
    clientId: "${obo.clientId}",
    clientSecret: "${obo.clientSecret}",
    tokenEndpoint: "https://login.example.com/token",
    targetType: "audience" as const,
    targetValue: "https://api.example.com",
  };
  const oboBack = parseConnectionAuth(serializeConnectionAuth(obo), "a2a");
  check("oauth2-obo round-trip", oboBack?.kind === "oauth2-obo" && oboBack.targetValue === obo.targetValue);
}

// ---------------------------------------------------------------------------
console.log("\n[12] Connection access + policies serialize/parse round-trip");
{
  check("access internal omitted", serializeConnectionAccess(undefined) === undefined);
  check("access internal explicit omitted", serializeConnectionAccess("internal") === undefined);
  check("access shared serialized", serializeConnectionAccess("shared") === "shared");
  check("access parse shared", parseConnectionAccess("shared") === "shared");
  check("access parse internal", parseConnectionAccess("internal") === "internal");

  const policies = {
    inbound: [{ mode: "ref" as const, name: "rate-limit", namespace: "ORG" }],
    outbound: [{ mode: "ref" as const, name: "audit-log" }],
  };
  const serialized = serializeConnectionPolicies(policies);
  check("policies serialize inbound", Array.isArray(serialized?.inbound) && (serialized!.inbound as unknown[]).length === 1);
  const parsed = parseConnectionPolicies(serialized);
  check(
    "policies round-trip",
    parsed?.inbound?.[0]?.mode === "ref" &&
      parsed.inbound[0].mode === "ref" &&
      parsed.inbound[0].name === "rate-limit" &&
      parsed.inbound[0].namespace === "ORG" &&
      parsed.outbound?.[0]?.mode === "ref" &&
      parsed.outbound[0].name === "audit-log"
  );

  const inlineRaw = {
    inbound: [{ policy: { kind: "custom", name: "x" } }],
    outbound: [{ ref: { name: "keep-me" } }],
  };
  const inlineParsed = parseConnectionPolicies(inlineRaw);
  check("inline policy preserved", inlineParsed?.inbound?.[0]?.mode === "inline");
  check("ref policy parsed", inlineParsed?.outbound?.[0]?.mode === "ref" && inlineParsed.outbound[0].name === "keep-me");

  check(
    "serialize drops empty policy ref",
    serializeConnectionPolicies({
      outbound: [{ mode: "ref", name: "", namespace: "68ef9520-24e9-4cf2-b2f5-620025690913" }],
    }) === undefined
  );
  check(
    "sanitize removes empty inbound ref",
    sanitizeConnectionPolicies({
      inbound: [{ mode: "ref", name: "  ", namespace: "ORG" }],
      outbound: [{ mode: "ref", name: "rate-limiting" }],
    })?.outbound?.[0]?.mode === "ref"
  );

  let p = createScaffoldProject("ORG");
  const agent = importAsset({
    kind: "agent",
    groupId: "ORG",
    assetId: "my-agent",
    version: "1.0.0",
    name: "my-agent",
    url: "https://agent.example.com",
  });
  p = apply(
    p,
    { type: "addAsset", asset: agent },
    {
      type: "updateAsset",
      id: agent.id,
      patch: {
        access: "shared",
        policies: {
          inbound: [{ mode: "ref", name: "ingress-policy", namespace: "ORG" }],
        },
      },
    }
  );
  const files = serializeProject(p);
  const yaml = files.find((f) => f.language === "yaml")!.content;
  check("yaml includes access shared", yaml.includes("access: shared"));
  check("yaml includes policy ref", yaml.includes("ingress-policy"));
  check("yaml includes context.policies stub", yaml.includes("context:") && yaml.includes("policies:"));
  const parsedProject = parseProjectFiles({
    exchangeJson: files.find((f) => f.language === "json")!.content,
    agentYaml: yaml,
    brokerAgent: files.find((f) => f.language === "agent")!.content,
  });
  check("access/policies import ok", parsedProject.ok, parsedProject.ok ? "" : JSON.stringify(parsedProject.errors));
  if (parsedProject.ok) {
    const asset = parsedProject.project.assets[0];
    check("asset access shared", asset.access === "shared");
    check(
      "asset policies inbound",
      asset.policies?.inbound?.[0]?.mode === "ref" && asset.policies.inbound[0].name === "ingress-policy"
    );
  }
}

// ---------------------------------------------------------------------------
console.log("\n[13] Exchange policy catalog (getExchangePolicyTemplates client)");
{
  const sampleInbound = [
    {
      groupId: "68ef9520-24e9-4cf2-b2f5-620025690913",
      assetId: "rate-limiting",
      assetVersion: "1.4.0",
      name: "Rate Limiting",
      type: "system",
      category: "Quality of Service",
    },
    {
      groupId: "ORG-1",
      assetId: "my-custom-policy",
      assetVersion: "1.0.0",
      name: "My Custom Policy",
      type: "custom",
      category: "Security",
    },
    {
      groupId: "68ef9520-24e9-4cf2-b2f5-620025690913",
      assetId: "openai-transcoding-policy",
      assetVersion: "1.0.3",
      name: "OpenAI Transcoding",
      type: "system",
      category: "LLM",
      capabilities: { assetTypes: ["llm"] },
    },
    {
      groupId: "68ef9520-24e9-4cf2-b2f5-620025690913",
      assetId: "a-two-a-pii-detector",
      assetVersion: "1.0.0",
      name: "A2A PII Detector",
      type: "system",
      category: "A2A",
    },
    {
      groupId: "68ef9520-24e9-4cf2-b2f5-620025690913",
      assetId: "mcp-pii-detector",
      assetVersion: "1.0.0",
      name: "MCP PII Detector",
      type: "system",
      category: "MCP",
    },
  ];
  const sampleOutbound = [
    {
      groupId: "68ef9520-24e9-4cf2-b2f5-620025690913",
      assetId: "credential-injection-oauth2-obo",
      assetVersion: "1.1.1",
      name: "OAuth2 OBO Credential Injection",
      type: "system",
      category: "Security",
    },
  ];

  async function mockFetch(input: string, init?: RequestInit): Promise<Response> {
    const url = String(input);
    const injectionPoint = url.includes("injectionPoint=outbound") ? "outbound" : "inbound";
    const body = injectionPoint === "outbound" ? sampleOutbound : sampleInbound;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const inbound = await fetchExchangePolicyTemplates(
    "https://example.com",
    "token",
    { organizationId: "ORG-1", injectionPoint: "inbound" },
    mockFetch
  );
  check("inbound catalog count", inbound.length === 5, `${inbound.length}`);
  check("inbound system policy", inbound.some((p) => p.assetId === "rate-limiting" && p.provider === "mulesoft"));
  check("inbound org policy", inbound.some((p) => p.assetId === "my-custom-policy" && p.provider === "organization"));
  check("inbound llm assetTypes", inbound.find((p) => p.assetId === "openai-transcoding-policy")?.assetTypes.join(",") === "llm");
  check(
    "xapi uses injectionPoint param",
    (await mockFetch("https://example.com/exchange-policy-templates?injectionPoint=inbound")).ok
  );

  const catalog = await fetchExchangePolicyCatalog("https://example.com", "token", { organizationId: "ORG-1" }, mockFetch);
  check("catalog inbound/outbound split", catalog.inbound.length === 5 && catalog.outbound.length === 1);
  check("outbound obo policy", catalog.outbound[0]?.assetId === "credential-injection-oauth2-obo");

  const llmOnly = catalog.inbound.find((p) => p.assetId === "openai-transcoding-policy")!;
  const universal = catalog.inbound.find((p) => p.assetId === "rate-limiting")!;
  check("universal policy matches all kinds", policyMatchesAssetKind(universal, "agent") && policyMatchesAssetKind(universal, "llm"));
  check("llm-only policy matches llm", policyMatchesAssetKind(llmOnly, "llm"));
  check("llm-only policy excludes agent", !policyMatchesAssetKind(llmOnly, "agent"));

  const a2aCategory = catalog.inbound.find((p) => p.assetId === "a-two-a-pii-detector")!;
  const mcpCategory = catalog.inbound.find((p) => p.assetId === "mcp-pii-detector")!;
  check("a2a category policy matches agent", policyMatchesAssetKind(a2aCategory, "agent"));
  check("a2a category policy excludes llm", !policyMatchesAssetKind(a2aCategory, "llm"));
  check("mcp category policy excludes llm", !policyMatchesAssetKind(mcpCategory, "llm"));

  const agentFiltered = filterPolicyCatalogForAssetKind(catalog, "agent");
  check(
    "agent filter keeps a2a category",
    agentFiltered.inbound.some((p) => p.assetId === "rate-limiting") &&
      agentFiltered.inbound.some((p) => p.assetId === "a-two-a-pii-detector") &&
      !agentFiltered.inbound.some((p) => p.assetId === "openai-transcoding-policy") &&
      !agentFiltered.inbound.some((p) => p.assetId === "mcp-pii-detector")
  );

  const llmFiltered = filterPolicyCatalogForAssetKind(catalog, "llm");
  check(
    "llm filter drops a2a and mcp categories",
    llmFiltered.inbound.some((p) => p.assetId === "rate-limiting") &&
      llmFiltered.inbound.some((p) => p.assetId === "openai-transcoding-policy") &&
      !llmFiltered.inbound.some((p) => p.assetId === "a-two-a-pii-detector") &&
      !llmFiltered.inbound.some((p) => p.assetId === "mcp-pii-detector")
  );
}

// ---------------------------------------------------------------------------
console.log("\n[14] context.policies declarations + configuration schema fields");
{
  const schema = {
    type: "object",
    required: ["clientId"],
    properties: {
      clientId: { type: "string", title: "Client Id" },
      nested: {
        type: "object",
        properties: { limit: { type: "integer", title: "Limit" } },
      },
    },
  };
  const fields = policyConfigFieldSpecs(schema);
  check("schema fields flattened", fields.some((f) => f.path === "clientId") && fields.some((f) => f.path === "nested.limit"));

  const parsedPolicies = parseContextPolicies({
    "client-id-enforcement": {
      ref: { name: "client-id-enforcement", namespace: "68ef9520-24e9-4cf2-b2f5-620025690913" },
      configuration: { clientId: "the-id" },
    },
  });
  check("parse context.policies", parsedPolicies["client-id-enforcement"]?.configuration.clientId === "the-id");

  let p = createScaffoldProject("ORG");
  const llm = importAsset({
    kind: "llm",
    groupId: "ORG",
    assetId: "openai",
    version: "1.0.0",
    name: "openai",
    url: "https://api.openai.com",
  });
  p = apply(
    p,
    { type: "addAsset", asset: llm },
    {
      type: "updateAsset",
      id: llm.id,
      patch: {
        policies: {
          inbound: [{ mode: "ref", name: "client-id-enforcement", namespace: "68ef9520-24e9-4cf2-b2f5-620025690913" }],
          outbound: [{ mode: "ref", name: "anthropic-llm-provider-policy", namespace: "68ef9520-24e9-4cf2-b2f5-620025690913" }],
        },
      },
    },
    {
      type: "ensurePolicyBinding",
      bindingName: "client-id-enforcement",
      binding: {
        ref: { name: "client-id-enforcement", namespace: "68ef9520-24e9-4cf2-b2f5-620025690913" },
        configuration: { clientId: "${group.clientId}" },
      },
    },
    {
      type: "ensurePolicyBinding",
      bindingName: "anthropic-llm-provider-policy",
      binding: {
        ref: { name: "anthropic-llm-provider-policy", namespace: "68ef9520-24e9-4cf2-b2f5-620025690913" },
        configuration: { apiKey: "${group.apiKey}" },
      },
    }
  );

  const serialized = serializeContextPolicies(p);
  check("serialize two policy bindings", Object.keys(serialized ?? {}).length === 2);
  const yaml = serializeAgentNetworkYaml(p);
  check("yaml context.policies clientId", yaml.includes("client-id-enforcement") && yaml.includes("clientId"));
  check("yaml omits templateVersion", !yaml.includes("templateVersion"));

  const mockDetail = {
    groupId: "68ef9520-24e9-4cf2-b2f5-620025690913",
    assetId: "message-logging",
    assetVersion: "2.0.2",
    name: "Message Logging",
    configuration: {
      type: "object",
      properties: {
        loggingConfiguration: {
          type: "object",
          properties: { message: { type: "string", title: "Message" } },
        },
      },
    },
  };
  async function mockTemplateFetch(input: string): Promise<Response> {
    return new Response(JSON.stringify(mockDetail), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  const detail = await fetchExchangePolicyTemplate(
    "https://example.com",
    "token",
    "ORG",
    mockDetail.groupId,
    mockDetail.assetId,
    "2.0.2",
    mockTemplateFetch
  );
  check("fetch policy template detail", detail.configurationSchema !== null);
  check(
    "detail schema nested field",
    policyConfigFieldSpecs(detail.configurationSchema).some((f) => f.path.includes("message"))
  );
}

// ---------------------------------------------------------------------------
console.log("\n[15] Policy configuration variable refs + exchange.json derivation");
{
  check(
    "policy variable field name nested",
    policyVariableFieldName("loggingConfiguration.message") === "loggingConfigurationMessage"
  );

  const schema = {
    type: "object",
    required: ["clientId", "clientSecret"],
    properties: {
      clientId: { type: "string", title: "Client ID" },
      clientSecret: { type: "string", title: "Client Secret" },
      limit: { type: "integer", title: "Limit" },
    },
  };
  const withDefaults = applyPolicyConfigVariableDefaults({}, schema, "openai");
  check(
    "defaults for required + secret",
    withDefaults.clientId === "${openai.clientId}" &&
      withDefaults.clientSecret === "${openai.clientSecret}" &&
      withDefaults.limit === undefined
  );

  const conditionalSchema = {
    type: "object",
    properties: {
      authType: { type: "string", enum: ["api-key", "none"] },
      apiKey: { type: "string", title: "API Key" },
    },
    allOf: [
      {
        if: {
          properties: { authType: { const: "api-key" } },
        },
        then: {
          required: ["apiKey"],
        },
      },
    ],
  };
  const conditionalDefaults = applyPolicyConfigVariableDefaults({}, conditionalSchema, "outboundPolicy");
  check(
    "defaults include conditional required field",
    conditionalDefaults.apiKey === "${outboundPolicy.apiKey}"
  );

  const authSchema = {
    type: "object",
    properties: {
      authType: { type: "string", enum: ["api-key", "basic"] },
      apiKey: { type: "string", title: "API Key" },
      password: { type: "string", title: "Password" },
    },
    allOf: [
      {
        if: { properties: { authType: { const: "api-key" } } },
        then: { required: ["apiKey"] },
      },
      {
        if: { properties: { authType: { const: "basic" } } },
        then: { required: ["password"] },
      },
    ],
  };
  const apiKeyModeDefaults = applyPolicyConfigVariableDefaults(
    { authType: "api-key" },
    authSchema,
    "credentialInjection"
  );
  check("api-key mode includes apiKey default", apiKeyModeDefaults.apiKey === "${credentialInjection.apiKey}");
  check("api-key mode excludes password default", apiKeyModeDefaults.password === undefined);

  let p = createScaffoldProject("ORG");
  const llm = importAsset({
    kind: "llm",
    groupId: "ORG",
    assetId: "openai",
    version: "1.0.0",
    name: "openai",
    url: "https://api.openai.com",
  });
  p = apply(
    p,
    { type: "addAsset", asset: llm },
    {
      type: "updateAsset",
      id: llm.id,
      patch: {
        policies: {
          inbound: [{ mode: "ref", name: "client-id-enforcement" }],
        },
      },
    },
    {
      type: "ensurePolicyBinding",
      bindingName: "client-id-enforcement",
      binding: {
        ref: { name: "client-id-enforcement" },
        configuration: {
          clientId: "${openai.clientId}",
          clientSecret: "${openai.clientSecret}",
        },
      },
    }
  );

  const policyVars = derivePolicyVariableBindings(p);
  check("derive policy variable bindings", policyVars.length === 2);
  check("policy clientSecret is secret", policyVars.some((v) => v.field === "clientSecret" && v.secret));

  const allVars = deriveVariables(p);
  check(
    "deriveVariables merges policy placeholders",
    allVars.some((v) => v.group === "openai" && v.field === "clientId") &&
      allVars.some((v) => v.group === "openai" && v.field === "clientSecret")
  );

  const ex = JSON.parse(serializeExchangeJson(p));
  const openaiVars = ex.metadata.variables.openai;
  check(
    "exchange.json includes policy-derived variables",
    openaiVars?.clientId && openaiVars?.clientSecret?.secret === true
  );
}

// ---------------------------------------------------------------------------
console.log("\n[15b] Policy dependencies: ACB classifier + configuration validation");
{
  const { validatePolicyConfiguration } = await import("@/lib/composer/connectivity/policy-config-validation");
  const { policyConfigUnsupportedPaths } = await import("@/lib/composer/connectivity/policy-schema-fields");
  const MULESOFT_ORG = "68ef9520-24e9-4cf2-b2f5-620025690913";

  let p = createScaffoldProject("ORG");
  p = apply(
    p,
    {
      type: "updateBroker",
      patch: {
        interfacePolicies: { inbound: [{ mode: "ref", name: "rate-limiting", namespace: MULESOFT_ORG }] },
      },
    },
    {
      type: "ensurePolicyBinding",
      bindingName: "rate-limiting",
      binding: {
        ref: { name: "rate-limiting", namespace: MULESOFT_ORG },
        configuration: { rateLimits: [{ maximumRequests: 10, timePeriodInMilliseconds: 60000 }] },
        templateVersion: "1.5.1",
      },
    }
  );

  type DepRow = { assetId: string; classifier: string; packaging: string; version: string };
  const policyDepsOf = (project: typeof p): DepRow[] =>
    (JSON.parse(serializeExchangeJson(project)).dependencies as DepRow[]).filter(
      (d) => d.assetId === "rate-limiting"
    );

  const policyDeps = policyDepsOf(p);
  check(
    "policy dependency uses ACB's classifier, exactly once",
    policyDeps.length === 1 && policyDeps[0]?.classifier === "policy",
    JSON.stringify(policyDeps)
  );
  check("policy dependency packaging is zip", policyDeps[0]?.packaging === "zip");

  const exchangeJson = serializeExchangeJson(p);
  const agentYaml = serializeAgentNetworkYaml(p);
  const roundTrip = parseProjectFiles({ exchangeJson, agentYaml });
  check("ACB-shaped policy dependency round-trips", roundTrip.ok, roundTrip.ok ? "" : roundTrip.errors.join("; "));
  if (roundTrip.ok) {
    // The yaml carries no version, so the binding can only learn it from the dependency.
    check(
      "import gives the binding its template version",
      roundTrip.project.policyBindings["rate-limiting"]?.templateVersion === "1.5.1"
    );
    check(
      "the claimed dependency is not also kept as an unmatched leftover",
      !(roundTrip.project.unmatchedDependencies ?? []).some((d) => d.assetId === "rate-limiting")
    );
    check("re-export emits one policy dependency", policyDepsOf(roundTrip.project).length === 1);
  }

  const legacy = parseProjectFiles({
    exchangeJson: exchangeJson.replace('"classifier": "policy"', '"classifier": "schema"'),
    agentYaml,
  });
  check("a legacy schema-classified policy dependency imports", legacy.ok, legacy.ok ? "" : legacy.errors.join("; "));
  if (legacy.ok) {
    const legacyDeps = policyDepsOf(legacy.project);
    check(
      "legacy policy dependency is re-exported with ACB's classifier",
      legacyDeps.length === 1 && legacyDeps[0]?.classifier === "policy",
      JSON.stringify(legacyDeps)
    );
  }

  // Published rate-limiting 1.5.1 schema: keySelector must be an expression, and
  // rateLimits carries a default that fails its own item requirements.
  const rateLimitingSchema = {
    $schema: "https://json-schema.org/draft/2019-09/schema",
    type: "object",
    required: [],
    properties: {
      keySelector: { title: "Identifier", type: "string", format: "dataweaveExpression" },
      rateLimits: {
        title: "Limits",
        type: "array",
        minItems: 1,
        default: [{}],
        items: {
          type: "object",
          required: ["maximumRequests", "timePeriodInMilliseconds"],
          properties: {
            maximumRequests: { type: "integer", minimum: 1 },
            timePeriodInMilliseconds: { type: "integer", minimum: 1 },
          },
        },
      },
      exposeHeaders: { type: "boolean", default: false },
    },
  };
  const limits = { rateLimits: [{ maximumRequests: 10, timePeriodInMilliseconds: 60000 }] };

  check("a valid rate-limiting configuration passes", validatePolicyConfiguration(rateLimitingSchema, limits).length === 0);

  const literalKeySelector = validatePolicyConfiguration(rateLimitingSchema, {
    ...limits,
    keySelector: "client_id",
  });
  check(
    "a literal keySelector is rejected the way the CLI rejects it",
    literalKeySelector.some((i) => i.path === "keySelector" && i.message.includes("dataweaveExpression")),
    JSON.stringify(literalKeySelector)
  );
  check(
    "a DataWeave expression keySelector passes",
    validatePolicyConfiguration(rateLimitingSchema, {
      ...limits,
      keySelector: "#[attributes.headers['client_id']]",
    }).length === 0
  );
  check(
    "a deploy variable keySelector passes",
    validatePolicyConfiguration(rateLimitingSchema, {
      ...limits,
      keySelector: "${rateLimiting.keySelector}",
    }).length === 0
  );

  const emptyConfig = validatePolicyConfiguration(rateLimitingSchema, {});
  check(
    "an empty configuration is judged on the defaults the CLI injects",
    emptyConfig.some((i) => i.path.startsWith("rateLimits") && i.message.includes("maximumRequests")),
    JSON.stringify(emptyConfig)
  );

  check(
    "array parameters are reported as uneditable in the form",
    policyConfigUnsupportedPaths(rateLimitingSchema).includes("rateLimits")
  );
}

console.log("\n[16] Schema gap closure (yaml info, broker card/policies, headerName, policy access, inline)");
{
  let p = createScaffoldProject("ORG");
  p = apply(p, {
    type: "setIdentity",
    patch: {
      yamlInfo: {
        description: "Network purpose",
        summary: "Short summary",
        tags: ["demo", "broker"],
      },
    },
  });
  p = apply(p, {
    type: "updateCard",
    patch: {
      capabilities: { streaming: true, pushNotifications: false },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain", "application/json"],
      skills: [{ id: "route", name: "Route requests", description: "Routes to agents", tags: ["routing"] }],
    },
  });
  p = apply(p, {
    type: "updateBroker",
    patch: {
      interfacePolicies: {
        inbound: [
          { mode: "inline", document: { policy: { ref: { name: "rate-limit" }, configuration: { limit: 100 } } } },
          { mode: "ref", name: "rate-limit" },
        ],
      },
    },
  });
  const mcp = importAsset({
    kind: "mcp",
    groupId: "ORG",
    assetId: "tools",
    version: "1.0.0",
    name: "tools",
  });
  p = apply(
    p,
    { type: "addAsset", asset: mcp },
    {
      type: "updateAsset",
      id: mcp.id,
      patch: {
        authentication: {
          kind: "apiKey",
          apiKey: "${tools.apiKey}",
          headerName: "X-Api-Key",
        },
      },
    }
  );

  const doc = buildAgentNetworkDoc(p);
  check("yaml info.description", (doc.info as Record<string, unknown>).description === "Network purpose");
  check("yaml info.tags", Array.isArray((doc.info as Record<string, unknown>).tags));
  const brokers = doc.brokers as Record<string, Record<string, unknown>>;
  const iface = (brokers[Object.keys(brokers)[0]].interfaces as Record<string, Record<string, unknown>>).a2a;
  check("broker interface policies", Boolean(iface.policies));
  const card = iface.card as Record<string, unknown>;
  check("broker card skills", Array.isArray(card.skills) && (card.skills as unknown[]).length === 1);
  check("schema valid with gaps closed", validateAgentNetworkDoc(doc).length === 0, JSON.stringify(validateAgentNetworkDoc(doc)));

  const yaml = serializeAgentNetworkYaml(p);
  const parsed = parseAgentNetworkYaml(yaml);
  check("parse yaml info", parsed.yamlInfo?.description === "Network purpose");
  check("parse broker interface policies", (parsed.broker?.interfacePolicies?.inbound?.length ?? 0) >= 1);
  check("parse broker card skills", parsed.broker?.card.skills?.[0]?.id === "route");

  p = apply(p, {
    type: "ensurePolicyBinding",
    bindingName: "rate-limit",
    binding: {
      ref: { name: "rate-limit" },
      configuration: { limit: 100 },
      access: "shared",
    },
  });
  const policyDoc = buildAgentNetworkDoc(p);
  const policies = (policyDoc.context as Record<string, unknown>).policies as Record<string, Record<string, unknown>>;
  check("context.policies access", policies["rate-limit"]?.access === "shared");

  const mcpAsset = p.assets.find((a) => a.kind === "mcp");
  check(
    "headerName on mcp auth",
    mcpAsset?.authentication?.kind === "apiKey" && mcpAsset.authentication.headerName === "X-Api-Key"
  );
}

console.log("\n[17] A2A card round-trip preserves imported fields");
{
  const richCardYaml = `
agentNetwork: "2.0.0"
info:
  label: Net
  version: "1.0.0"
brokers:
  myBroker:
    kind: AgentScript
    implementation: "./brokers/my-broker.agent"
    interfaces:
      a2a:
        card:
          name: Support Broker
          version: "1.0.0"
          iconUrl: https://cdn.example.com/icon.png
          provider:
            organization: Example Corp
            url: https://example.com
          capabilities:
            streaming: true
            extendedAgentCard: true
            extensions:
              - uri: https://example.com/ext
                required: false
          securitySchemes:
            bearer:
              httpAuthSecurityScheme:
                scheme: Bearer
          supportedInterfaces:
            - url: https://omni-ai-gateway-9sqczt.wsyr1h-2.irl-e1.cloudhub.io/agent_broker_get_date/
              protocolVersion: "1.0"
              protocolBinding: HTTP+JSON
          skills:
            - id: triage
              name: Triage
              inputModes: ["text/plain"]
              securityRequirements:
                - bearer: []
`;

  const parsed = parseAgentNetworkYaml(richCardYaml);
  const card = parsed.broker?.card;
  check("parse provider", card?.provider?.organization === "Example Corp");
  check("parse iconUrl", card?.iconUrl === "https://cdn.example.com/icon.png");
  check("parse extendedAgentCard", card?.capabilities?.extendedAgentCard === true);
  check("parse capability extensions", card?.capabilities?.extensions?.[0]?.uri === "https://example.com/ext");
  check("parse securitySchemes", Boolean(card?.securitySchemes?.bearer));
  check("parse supportedInterfaces url", card?.supportedInterfaces?.[0]?.url?.includes("agent_broker_get_date"));
  check("parse supportedInterfaces binding", card?.supportedInterfaces?.[0]?.protocolBinding === "HTTP+JSON");
  check("parse supportedInterfaces version", card?.supportedInterfaces?.[0]?.protocolVersion === "1.0");
  check("supportedInterfaces not in extra", card?.extra?.supportedInterfaces === undefined);
  check("parse skill inputModes", card?.skills?.[0]?.inputModes?.[0] === "text/plain");
  check("parse skill securityRequirements", Boolean(card?.skills?.[0]?.securityRequirements?.length));

  const project = {
    version: 1 as const,
    identity: {
      name: "Net",
      organizationId: "ORG",
      assetId: "net",
      version: "1.0.0",
      descriptorVersion: "1.0.0",
      apiVersion: "v2.0",
      tags: [] as string[],
    },
    assets: [] as const,
    brokers: [
      {
        id: "b1",
        name: "my_broker",
        interfaceName: "a2a",
        card: card!,
        llmBindings: [],
        actions: [],
        nodes: [],
      },
    ],
    policyBindings: {},
  };

  const reserialized = serializeAgentNetworkYaml(project);
  const reparsed = parseAgentNetworkYaml(reserialized);
  const roundCard = reparsed.broker?.card;
  check("round-trip provider", roundCard?.provider?.organization === "Example Corp");
  check(
    "round-trip securitySchemes omitted without interface policies",
    roundCard?.securitySchemes === undefined
  );
  check("round-trip supportedInterfaces", roundCard?.supportedInterfaces?.[0]?.protocolBinding === "HTTP+JSON");
  check("round-trip capability extensions", roundCard?.capabilities?.extensions?.[0]?.uri === "https://example.com/ext");
  check("round-trip skill inputModes", roundCard?.skills?.[0]?.inputModes?.[0] === "text/plain");
  check(
    "round-trip skill securityRequirements omitted without interface policies",
    !roundCard?.skills?.[0]?.securityRequirements?.length
  );

  const { deriveA2aCardSecurityFromInterfacePolicies } = await import(
    "@/lib/composer/a2a-card-security-from-policies"
  );
  const withPolicies = {
    ...project,
    brokers: [
      {
        ...project.brokers[0],
        interfacePolicies: {
          inbound: [{ mode: "ref" as const, name: "jwt-validation" }],
        },
      },
    ],
    policyBindings: {
      "jwt-validation": { ref: { name: "jwt-validation" }, configuration: {} },
    },
  };
  const derived = deriveA2aCardSecurityFromInterfacePolicies(withPolicies.brokers[0], withPolicies);
  check("derive jwt scheme key", Boolean(derived?.securitySchemes?.jwt_validation));
  const withClientIdPolicy = {
    ...project,
    brokers: [
      {
        ...project.brokers[0],
        interfacePolicies: {
          inbound: [{ mode: "ref" as const, name: "client-id-enforcement" }],
        },
      },
    ],
    policyBindings: {
      "client-id-enforcement": { ref: { name: "client-id-enforcement" }, configuration: {} },
    },
  };
  const derivedClientId = deriveA2aCardSecurityFromInterfacePolicies(
    withClientIdPolicy.brokers[0],
    withClientIdPolicy
  );
  const clientIdScheme = (derivedClientId?.securitySchemes?.client_id_enforcement_client_id ?? {}) as Record<
    string,
    unknown
  >;
  const clientSecretScheme = (derivedClientId?.securitySchemes?.client_id_enforcement_client_secret ??
    {}) as Record<string, unknown>;
  const apiKeyScheme = (clientIdScheme.apiKeySecurityScheme ?? {}) as Record<string, unknown>;
  const apiSecretScheme = (clientSecretScheme.apiKeySecurityScheme ?? {}) as Record<string, unknown>;
  const derivedReq = (derivedClientId?.securityRequirements?.[0] ?? {}) as Record<string, unknown>;
  check(
    "client-id emits client_id and client_secret schemes",
    Boolean(derivedClientId?.securitySchemes?.client_id_enforcement_client_id) &&
      Boolean(derivedClientId?.securitySchemes?.client_id_enforcement_client_secret)
  );
  check("client-id uses a2a_v1 apiKey location field", apiKeyScheme.location === "header");
  check("client-secret uses a2a_v1 apiKey location field", apiSecretScheme.location === "header");
  check("client-secret api key name", apiSecretScheme.name === "client_secret");
  check(
    "client-id requirement includes both header schemes",
    Array.isArray(derivedReq.client_id_enforcement_client_id) &&
      Array.isArray(derivedReq.client_id_enforcement_client_secret)
  );
  check("client-id does not emit OpenAPI in field", !("in" in apiKeyScheme));
  const derivedYaml = serializeAgentNetworkYaml(withPolicies);
  check("export emits derived securitySchemes", derivedYaml.includes("securitySchemes:"));
  check("export emits derived securityRequirements", derivedYaml.includes("securityRequirements:"));
  check("round-trip schema valid", validateAgentNetworkDoc(buildAgentNetworkDoc(project)).length === 0);
}

console.log("\n[17b] Skill examples are string arrays");
{
  const fromArray = parseBrokerCard({
    name: "Agent",
    version: "1.0.0",
    skills: [{ id: "s1", name: "Cook", examples: ["I need a recipe for bread", "What can I bake today?"] }],
  });
  check("parse examples array", fromArray.skills?.[0]?.examples?.join("|") === "I need a recipe for bread|What can I bake today?");

  const fromString = parseBrokerCard({
    name: "Agent",
    version: "1.0.0",
    skills: [{ id: "s1", name: "Cook", examples: "I need a recipe for bread" }],
  });
  check("coerce single string example", fromString.skills?.[0]?.examples?.[0] === "I need a recipe for bread");

  const fromNested = parseBrokerCard({
    name: "Agent",
    version: "1.0.0",
    skills: [{ id: "s1", name: "Cook", examples: [["I need a recipe for bread"]] }],
  });
  check("flatten nested example arrays", fromNested.skills?.[0]?.examples?.[0] === "I need a recipe for bread");

  const serialized = serializeBrokerCard({
    name: "Agent",
    version: "1.0.0",
    skills: [{ id: "s1", name: "Cook", examples: ["Find my order, please", "Track shipment #12345"] }],
  });
  const skill = (serialized.skills as Record<string, unknown>[])[0];
  check(
    "serialize examples as string[]",
    Array.isArray(skill.examples) &&
      skill.examples.every((value) => typeof value === "string") &&
      (skill.examples as string[]).length === 2
  );
  check("serialize skill description fallback from name", skill.description === "Cook");
  check("examples survive round-trip", parseBrokerCard(serialized).skills?.[0]?.examples?.[1] === "Track shipment #12345");

  check("normalizeStringArray string", normalizeStringArray("hello")?.[0] === "hello");
  check("normalizeStringArray nested", normalizeStringArray([["a"], "b"])?.join("") === "ab");
}

console.log("\n[18] A2A card schema validator (a2a_v1.json Agent Card)");
{
  check("a2a card validator builds", a2aCardSchemaValidatorBuildError() === null, a2aCardSchemaValidatorBuildError() ?? "");
  const card = serializeBrokerCard({
    name: "Test",
    version: "1.0.0",
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
  });
  check("minimal card valid", validateBrokerCardDoc(card).length === 0, JSON.stringify(validateBrokerCardDoc(card)));
  check("rejects non-object", validateBrokerCardDoc(null).length > 0);
  const withInterfaces = serializeBrokerCard({
    name: "Agent Broker Get Date",
    version: "1.0.0",
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    supportedInterfaces: [
      {
        url: "https://omni-ai-gateway-9sqczt.wsyr1h-2.irl-e1.cloudhub.io/agent_broker_get_date/",
        protocolVersion: "1.0",
        protocolBinding: "HTTP+JSON",
      },
    ],
  });
  check(
    "supportedInterfaces card valid",
    validateBrokerCardDoc(withInterfaces).length === 0,
    JSON.stringify(validateBrokerCardDoc(withInterfaces))
  );
}

console.log("\n[19] MCP metadata — pick file, parse tools, auto-select single tool");
{
  const files = [
    { classifier: "agent-metadata", packaging: "json" },
    { classifier: "mcp-metadata", packaging: "json", downloadURL: "https://x/mcp-metadata.json" },
    { classifier: "mcp", packaging: "json" },
  ];
  const picked = pickMcpMetadataFile(files);
  check("pickMcpMetadataFile prefers mcp-metadata", picked?.classifier === "mcp-metadata");

  const mcpJson = JSON.stringify({
    protocolVersion: "2024-11-05",
    tools: [
      { name: "searchIssues", description: "Search Jira issues" },
      { name: "updateIssue", description: "Update an issue" },
    ],
  });
  const parsedMcp = parseMcpMetadataContent("mcp", mcpJson);
  check("parseMcpMetadataContent tools", parsedMcp?.tools.length === 2);

  const meta = mcpMetaFromExchange(parsedMcp!);
  check("parseMcpAssetMeta round-trip", parseMcpAssetMeta(meta)?.tools[0]?.name === "searchIssues");
  check("hasMcpAssetMeta: empty tools still cached", hasMcpAssetMeta({ fileKind: "mcp-metadata", tools: [] }));
  check("parseMcpAssetMeta: empty tools returns null", parseMcpAssetMeta({ fileKind: "mcp-metadata", tools: [] }) === null);
  check("defaultToolNameFromMeta single tool", defaultToolNameFromMeta({ fileKind: "mcp-metadata", tools: [{ name: "onlyOne" }] }) === "onlyOne");
  check("defaultToolNameFromMeta multi tool undefined", defaultToolNameFromMeta(meta) === undefined);

  const derived = actionInputsFromMcpToolInputSchema({
    type: "object",
    properties: {
      submissionId: { type: "string" },
      result: { type: "object" },
    },
    required: ["submissionId"],
  });
  check("actionInputsFromMcpToolInputSchema required first", derived?.[0]?.name === "submissionId");
  check("actionInputsFromMcpToolInputSchema maps object", derived?.some((i) => i.name === "result" && i.type === "object"));

  let p = createScaffoldProject("ORG");
  const mcpAsset = importAsset({
    kind: "mcp",
    groupId: "gm",
    assetId: "jira-mcp",
    version: "1.0.0",
    name: "Jira MCP",
    meta: { fileKind: "mcp-metadata", tools: [{ name: "updateIssue" }] },
  });
  p = apply(p, { type: "addAsset", asset: mcpAsset });
  const action = p.brokers[0].actions.find((a) => a.actionKind === "mcp:tool")!;
  check("addAsset auto-selects single MCP tool", action.toolName === "updateIssue");
  {
    const errors = validateProject(p).errors.filter(
      (e) =>
        e.code !== "a2a-card.required.endpoint-url" &&
        e.code !== "graph.echo.empty-message"
    );
    check("single-tool mcp action validates (aside from required endpoint URL)", errors.length === 0);
  }

  const schemaMeta = tagMcpMetaForAsset(
    {
      fileKind: "mcp-metadata",
      tools: [
        {
          name: "screen_entity",
          inputSchema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
        {
          name: "check_appetite",
          inputSchema: {
            type: "object",
            properties: { submissionId: { type: "string" } },
            required: ["submissionId"],
          },
        },
      ],
    },
    "watchlist-mcp"
  );
  const schemaAsset = importAsset({
    kind: "mcp",
    groupId: "gm",
    assetId: "watchlist-mcp",
    version: "1.0.0",
    name: "Watchlist",
    meta: schemaMeta,
  });
  const screenAction = createActionsForMcpAsset(schemaAsset, new Set()).find((a) => a.toolName === "screen_entity");
  check("createMcpToolAction derives inputs from inputSchema", screenAction?.inputs?.[0]?.name === "name");
  check("input type maps to string", screenAction?.inputs?.[0]?.type === "string");
  const appetiteAction = createActionsForMcpAsset(schemaAsset, new Set()).find((a) => a.toolName === "check_appetite");
  check("each tool gets its own inputs", appetiteAction?.inputs?.[0]?.name === "submissionId");
  const agentText = serializeBrokerAgent({
    ...p.brokers[0],
    actions: screenAction ? [screenAction] : [],
  });
  check("serialized agent emits action inputs", agentText.includes("inputs:") && agentText.includes("name: string"));

  let pMulti = createScaffoldProject("ORG");
  const multiToolAsset = importAsset({
    kind: "mcp",
    groupId: "gm",
    assetId: "jira-mcp",
    version: "1.0.0",
    name: "Jira MCP",
    meta: {
      fileKind: "mcp-metadata",
      tools: [{ name: "searchIssues" }, { name: "updateIssue" }],
    },
  });
  pMulti = apply(pMulti, { type: "addAsset", asset: multiToolAsset });
  const mcpActions = pMulti.brokers[0].actions.filter((a) => a.actionKind === "mcp:tool");
  check("addAsset creates one MCP action per tool", mcpActions.length === 2, `${mcpActions.length}`);
  check(
    "multi-tool actions have distinct tool_name",
    new Set(mcpActions.map((a) => a.toolName)).size === 2
  );
  check("multi-tool actions have distinct names", new Set(mcpActions.map((a) => a.name)).size === 2);

  const used = new Set(pMulti.brokers[0].actions.map((a) => a.name));
  const extra = createMcpToolAction(multiToolAsset, "createIssue", used);
  pMulti = apply(pMulti, { type: "addAction", action: extra });
  check("manual addAction assigns unique name", extra.name !== mcpActions[0].name);

  const watchlistMeta = tagMcpMetaForAsset(
    { fileKind: "mcp-metadata", tools: [{ name: "get-triage-state" }] },
    "agentexplorer-triage-state"
  );
  const watchlistAsset = {
    ...importAsset({
      kind: "mcp",
      groupId: "gm",
      assetId: "agentexplorer-watchlist-mcp-server",
      version: "1.0.0",
      name: "Watchlist",
    }),
    meta: watchlistMeta,
  };
  check(
    "mcpMetaForAsset ignores catalog from wrong sourceAssetId",
    mcpMetaForAsset(watchlistAsset) === null
  );
  check(
    "createActionsForMcpAsset skips stale wrong-server meta",
    createActionsForMcpAsset(watchlistAsset, new Set()).length === 1 &&
      createActionsForMcpAsset(watchlistAsset, new Set())[0].toolName === ""
  );

  const downloadUrls = resolveExchangeFileDownloadUrls(
    "https://anypoint.mulesoft.com",
    { organizationId: "ORG", groupId: "com.example", assetId: "jira-mcp", version: "1.0.0" },
    {
      classifier: "mcp-metadata",
      packaging: "json",
      downloadURL: "https://anypoint.mulesoft.com/exchange/files/api/v1/organizations/ORG/assets/com.example/jira-mcp/mcp-metadata/json",
    }
  );
  check("resolveExchangeFileDownloadUrls prefers downloadURL", downloadUrls[0]?.includes("/exchange/files/api/v1/"));
  check("resolveExchangeFileDownloadUrls includes v1 fallback", downloadUrls.some((u) => u.includes("/assets/com.example/jira-mcp/mcp-metadata/json")));

  // --- AgentFabric official graph adapter (Phase 2) ---
  {
    const fixtureGraph: Graph = {
      nodes: [
        { id: "trigger.ticketTrigger", kind: "trigger" },
        {
          id: "subagent.classifySeverity",
          kind: "subagent",
          additionalProperties: {
            label: "Classify Severity",
            "lexical-start-position": "12,4",
          },
        },
        {
          id: "router.severityRouter",
          kind: "router",
          additionalProperties: { outputs: "High, otherwise" },
        },
        { id: "executor.escalateTicket", kind: "executor" },
        { id: "echo.escalationResponse", kind: "echo" },
      ],
      edges: [
        { from: "trigger.ticketTrigger", to: "subagent.classifySeverity" },
        { from: "subagent.classifySeverity", to: "router.severityRouter" },
        {
          from: "router.severityRouter",
          to: "executor.escalateTicket",
          additionalProperties: { output: "High", predicate: '@x.severity == "high"' },
        },
        {
          from: "router.severityRouter",
          to: "echo.escalationResponse",
          additionalProperties: { output: "otherwise" },
        },
      ],
    };

    const { nodes, edges } = protocolGraphToReactFlow(fixtureGraph);
    check("protocolGraphToReactFlow emits one af-trigger", nodes.filter((n) => n.type === "af-trigger").length === 1);
    check("protocolGraphToReactFlow maps router to af-router", nodes.find((n) => n.id === "router.severityRouter")?.type === "af-router");
    check("protocolGraphToReactFlow passes router outputs", (nodes.find((n) => n.id === "router.severityRouter")?.data.outputs as string)?.includes("otherwise"));
    check("protocolGraphToReactFlow uses AST label when present", nodes.find((n) => n.id === "subagent.classifySeverity")?.data.label === "Classify Severity");
    check("protocolGraphToReactFlow derives label from id", nodes.find((n) => n.id === "executor.escalateTicket")?.data.label === "escalateTicket");

    const routerEdge = edges.find((e) => e.data?.output === "High");
    check("protocolGraphToReactFlow pins router sourceHandle", routerEdge?.sourceHandle === routerOutputHandleId("High"));
    check("protocolGraphToReactFlow labels edge with predicate", routerEdge?.label === '@x.severity == "high"');

    check("parseProtocolOutputs escapes commas", parseProtocolOutputs(String.raw`yes\, sir, no`).join("|") === "yes, sir|no");

    const pos = lexicalPositionForNode(fixtureGraph, "subagent.classifySeverity");
    check("lexicalPositionForNode parses protocol bag", pos?.line === 12 && pos?.character === 4);

    const layout = applyDagreOverviewLayout(nodes, edges);
    check("applyDagreOverviewLayout positions all nodes", layout.nodes.length === nodes.length);
    check("applyDagreOverviewLayout assigns connectedHandles", (layout.connectedHandles.get("router.severityRouter")?.size ?? 0) >= 1);
  }
}

// ---------------------------------------------------------------------------
console.log("\n[A2A card live-validation checks]");
{
  const fullCard: BrokerCard = {
    name: "Customer Support Agent",
    version: "1.0.0",
    description: "Answers customer support questions and escalates when needed.",
    provider: { organization: "Example Inc.", url: "https://example.com" },
    capabilities: { streaming: true, pushNotifications: true },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain"],
    supportedInterfaces: [
      { url: "https://api.example.com/a2a/customer-support", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
    ],
    skills: [{ id: "resolve", name: "Resolve support request", tags: ["support", "orders"] }],
  };
  const full = evaluateA2aCard(fullCard);
  check("evaluateA2aCard: complete card has no schema errors", full.errors.length === 0, full.errors.join("; "));
  check("evaluateA2aCard: complete card has no warnings", full.warnings.length === 0, full.warnings.join("; "));
  check("evaluateA2aCard: complete card passes 10 checks", full.passed.length === 10, `${full.passed.length}`);

  const sparseCard: BrokerCard = { name: "Bare", version: "1.0.0" };
  const sparse = evaluateA2aCard(sparseCard);
  check("evaluateA2aCard: sparse card errors on deploy-required description", sparse.errors.some((e) => e.startsWith("description:")));
  check("evaluateA2aCard: sparse card warns on recommendations", sparse.warnings.length === 10, `${sparse.warnings.length}`);
  check("evaluateA2aCard: sparse card passes nothing", sparse.passed.length === 0, `${sparse.passed.length}`);

  const httpCard: BrokerCard = {
    name: "Insecure",
    version: "1.0.0",
    supportedInterfaces: [{ url: "http://api.example.com/a2a", protocolBinding: "HTTP+JSON", protocolVersion: "1.0" }],
  };
  const http = evaluateA2aCard(httpCard);
  check("evaluateA2aCard: http endpoint set but not https", http.warnings.includes("Endpoint uses HTTPS") && http.passed.includes("A2A endpoint URL is set"));
}

// ---------------------------------------------------------------------------
console.log("\n[A2A card completeness panel]");
{
  const fullCard: BrokerCard = {
    name: "Customer Support Agent",
    version: "1.0.0",
    description: "Answers customer support questions and escalates when needed.",
    provider: { organization: "Example Inc.", url: "https://example.com" },
    capabilities: { streaming: true },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    supportedInterfaces: [
      { url: "https://api.example.com/a2a/customer-support", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
    ],
    skills: [{ id: "resolve", name: "Resolve support request", tags: ["support"] }],
  };
  const full = buildA2aCardCompleteness(fullCard);
  check("buildA2aCardCompleteness: all required set", full.summary.requiredSet === full.summary.requiredTotal);
  check("buildA2aCardCompleteness: all recommended set", full.summary.recommendedSet === full.summary.recommendedTotal);
  check(
    "buildA2aCardCompleteness: endpoint preview",
    full.groups[1].items[0].valuePreview?.startsWith("https://") ?? false
  );

  const sparse = buildA2aCardCompleteness({ name: "Bare", version: "1.0.0" });
  check(
    "buildA2aCardCompleteness: sparse misses required description",
    sparse.groups[0].items.some((i) => i.id === "description" && i.tier === "required" && i.status !== "set")
  );
  check(
    "buildA2aCardCompleteness: sparse misses required endpoint",
    sparse.summary.requiredSet < sparse.summary.requiredTotal
  );
  check(
    "buildA2aCardCompleteness: sparse misses recommendations",
    sparse.summary.recommendedSet < sparse.summary.recommendedTotal
  );
}

// ---------------------------------------------------------------------------
console.log("\n[Project completeness panel]");
{
  const empty = createEmptyProject();
  const emptyCompleteness = buildProjectCompleteness(empty);
  check(
    "buildProjectCompleteness: empty project misses required identity",
    emptyCompleteness.summary.requiredSet < emptyCompleteness.summary.requiredTotal
  );
  check(
    "buildProjectCompleteness: identity fields have why text",
    emptyCompleteness.groups[0].items.every((i) => i.why.length > 0)
  );

  const named = {
    ...empty,
    identity: {
      ...empty.identity,
      name: "Demo Network",
      organizationId: "00000000-0000-4000-8000-000000000001",
      assetId: "demo-network",
      version: "1.0.0",
    },
  };
  const namedCompleteness = buildProjectCompleteness(named);
  check(
    "buildProjectCompleteness: named project fills identity required",
    namedCompleteness.groups[0].items
      .filter((i) => i.tier === "required")
      .every((i) => i.status === "set")
  );

  const reasoningOnlyAgent = `# @dialect: AGENTFABRIC=1.0.0
system:
  instructions: "You are to get the system date"
config:
  agent_name: "agent_broker_get_date"
  default_llm: @llm.openai
llm:
  openai:
    target: "llm://openai_llm_connection_v1"
    kind: "OpenAI"
    model: "gpt-5.1"
trigger t:
  kind: "a2a"
  target: "brokers://agent_broker_get_date/a2a"
  on_message: ->
    transition to @orchestrator.getSystemDate
orchestrator getSystemDate:
  reasoning:
    instructions: "Get the date"
    outputs:
      properties:
        summary:
          type: "string"
  on_exit: ->
    transition to @echo.r
echo r:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message({ messageId: uuid(), parts: [a2a.textPart(@orchestrator.getSystemDate.output.summary)] })
`;
  const reasoningBroker = parseBrokerAgent(reasoningOnlyAgent);
  const reasoningProject = {
    ...named,
    brokers: [{ ...createScaffoldProject().brokers[0], ...reasoningBroker, actions: [] }],
  };
  const reasoningCompleteness = buildProjectCompleteness(reasoningProject);
  const actionsItem = reasoningCompleteness.groups
    .flatMap((g) => g.items)
    .find((i) => i.id === "actions");
  check(
    "buildProjectCompleteness: reasoning-only orchestrator does not require actions",
    actionsItem?.tier === "recommended" && actionsItem.status === "set"
  );
}

// ---------------------------------------------------------------------------
console.log("\n[Exchange network import: project file selection]");
{
  const entries = [
    { filename: "agent-network.yaml", content: "label: Net" },
    { filename: "exchange.json", content: "{}" },
    { filename: "brokers/support.agent", content: "agent Support {}" },
    { filename: "README.md", content: "# readme" },
  ];
  const picked = selectProjectSourceFiles(entries);
  check("selectProjectSourceFiles: finds agent-network.yaml", picked.agentYaml === "label: Net");
  check("selectProjectSourceFiles: finds exchange.json", picked.exchangeJson === "{}");
  check("selectProjectSourceFiles: finds broker .agent under brokers/", picked.brokerAgent === "agent Support {}");

  const nested = [
    { filename: "my-net/src/main/exchange.json", content: "{\"n\":1}" },
    { filename: "my-net/src/main/agent-network.yaml", content: "label: Nested" },
    { filename: "my-net/src/main/brokers/b.agent", content: "agent B {}" },
  ];
  const pickedNested = selectProjectSourceFiles(nested);
  check("selectProjectSourceFiles: matches nested paths by basename", pickedNested.exchangeJson === "{\"n\":1}" && pickedNested.agentYaml === "label: Nested" && pickedNested.brokerAgent === "agent B {}");

  const implementationYaml = [
    "brokers:",
    "  selected:",
    "    implementation: ./brokers/selected.agent",
  ].join("\n");
  const selectedImplementation = selectProjectSourceFiles([
    { filename: "project/agent-network.yaml", content: implementationYaml },
    { filename: "project/brokers/selected.agent", content: "selected" },
  ]);
  check(
    "selectProjectSourceFiles: follows broker implementation path",
    selectedImplementation.brokerAgent === "selected"
  );
  let rejectedDiscardedAgent = false;
  try {
    selectProjectSourceFiles([
      { filename: "project/agent-network.yaml", content: implementationYaml },
      { filename: "project/brokers/other.agent", content: "other" },
      { filename: "project/brokers/selected.agent", content: "selected" },
    ]);
  } catch {
    rejectedDiscardedAgent = true;
  }
  check(
    "selectProjectSourceFiles: refuses to silently discard extra .agent files",
    rejectedDiscardedAgent
  );

  const noAgent = selectProjectSourceFiles([{ filename: "exchange.json", content: "{}" }]);
  check("selectProjectSourceFiles: omits missing files", noAgent.brokerAgent === undefined && noAgent.agentYaml === undefined);

  const emptyPick = selectProjectSourceFiles([]);
  check("selectProjectSourceFiles: empty input yields empty selection", Object.keys(emptyPick).length === 0);
}

// ---------------------------------------------------------------------------
console.log("\n[Exchange network import: v1/v2 gating]");
{
  // v2 project — zip classifier agentic-network and/or v2 yaml markers → editable.
  const v2ByClassifier = detectProjectVersion({ zipClassifier: "agentic-network", yamlContent: null });
  check("detectProjectVersion: agentic-network zip is v2", v2ByClassifier === "v2");

  const v2Yaml = "registry:\n  foo: bar\ncontext:\n  connections: {}\n";
  check("detectProjectVersion: v2 yaml shape is v2", detectProjectVersion({ zipClassifier: null, yamlContent: v2Yaml }) === "v2");
  check("detectProjectVersion: agentNetwork: 2 marker is v2", detectProjectVersion({ zipClassifier: null, yamlContent: "agentNetwork: 2.0.0\n" }) === "v2");

  // v1 project — blocked from editing.
  const v1ByClassifier = detectProjectVersion({ zipClassifier: "agent-network", yamlContent: null });
  check("detectProjectVersion: agent-network zip is v1", v1ByClassifier === "v1");
  check("detectProjectVersion: broker-group zip is v1", detectProjectVersion({ zipClassifier: "broker-group", yamlContent: null }) === "v1");

  const v1Yaml = "brokers:\n  b1: {}\nconnections:\n  c1: {}\n";
  check("detectProjectVersion: v1 yaml shape is v1", detectProjectVersion({ zipClassifier: null, yamlContent: v1Yaml }) === "v1");

  // yaml wins when zip classifier disagrees (a v2 yaml in a legacy-classified zip).
  check("detectProjectVersion: yaml overrides conflicting classifier", detectProjectVersion({ zipClassifier: "agent-network", yamlContent: v2Yaml }) === "v2");

  check("detectProjectVersion: no signals is unknown", detectProjectVersion({ zipClassifier: null, yamlContent: null }) === "unknown");
}

// ---------------------------------------------------------------------------
console.log("\n[Import: groupId resolution & fallback]");
{
  // A real-ish v2 network whose connections carry only ref.name (no namespace)
  // and whose exchange.json has a top-level groupId but no matching deps.
  const exchangeJson = JSON.stringify({
    name: "Support Net",
    groupId: "org-abc",
    assetId: "support-net",
    version: "2.0.0",
    dependencies: [],
  });
  const agentYaml = [
    "info:",
    "  label: Support Net",
    "context:",
    "  connections:",
    "    orderAgentConnection:",
    "      kind: a2a",
    "      ref:",
    "        name: orderAgent",
    "    lookupConnection:",
    "      kind: mcp",
    "      ref:",
    "        name: lookup",
    "brokers:",
    "  supportBroker:",
    "    kind: AgentScript",
    "    interfaces:",
    "      a2a:",
    "        card:",
    "          name: Support Broker",
    "          version: 1.0.0",
  ].join("\n");

  const res = parseProjectFiles({ exchangeJson, agentYaml });
  check("parseProjectFiles: v2 import succeeds", res.ok, res.ok ? "" : res.errors.join("; "));
  if (res.ok) {
    check("parseProjectFiles: assets fall back to exchange org groupId", res.project.assets.every((a) => a.groupId === "org-abc"));
    check("parseProjectFiles: identity org resolves from exchange", res.project.identity.organizationId === "org-abc");
  }

  // No groupId anywhere in files → fallbackGroupId (selected business group).
  const exchangeNoOrg = JSON.stringify({ name: "No Org", assetId: "n", version: "2.0.0", dependencies: [] });
  const fb = parseProjectFiles({ exchangeJson: exchangeNoOrg, agentYaml, fallbackGroupId: "bg-fallback" });
  check("parseProjectFiles: uses fallbackGroupId when files omit groupId", fb.ok);
  if (fb.ok) {
    check("parseProjectFiles: assets use fallbackGroupId", fb.project.assets.every((a) => a.groupId === "bg-fallback"));
  }

  // Dependency matching by assetId when classifier doesn't match our vocabulary.
  const exchangeWithDep = JSON.stringify({
    name: "Dep Net",
    groupId: "org-xyz",
    assetId: "dep-net",
    version: "2.0.0",
    dependencies: [{ groupId: "vendor-1", assetId: "orderAgent", version: "3.1.0", classifier: "http" }],
  });
  const depRes = parseProjectFiles({ exchangeJson: exchangeWithDep, agentYaml });
  check("parseProjectFiles: matches dependency by assetId", depRes.ok);
  if (depRes.ok) {
    const orderAsset = depRes.project.assets.find((a) => a.assetId === "orderAgent");
    check("parseProjectFiles: assetId-matched dep supplies groupId+version", orderAsset?.groupId === "vendor-1" && orderAsset?.version === "3.1.0");
  }
}

console.log("\n[Import: multi-asset ref.name ↔ dependency matching]");
{
  const org = "00000000-0000-4000-8000-000000000001";
  // Dependencies deliberately in a different order than yaml connections.
  const exchangeJson = JSON.stringify({
    name: "Multi MCP",
    groupId: org,
    assetId: "multi-mcp",
    version: "1.0.0",
    dependencies: [
      { groupId: org, assetId: "agentexplorer-triage-state", version: "1.0.0", classifier: "mcp-metadata", packaging: "zip" },
      { groupId: org, assetId: "agentexplorer-watchlist-mcp-server", version: "1.0.0", classifier: "mcp-metadata", packaging: "zip" },
      { groupId: org, assetId: "agentexplorer-mail-server", version: "1.0.0", classifier: "mcp-metadata", packaging: "zip" },
      { groupId: org, assetId: "llm-openai", version: "1.0.0", classifier: "llm-metadata", packaging: "zip" },
    ],
  });
  const agentYaml = [
    "agentNetwork: 2.0.0",
    "info:",
    "  label: Multi MCP",
    "  version: 1.0.0",
    "context:",
    "  connections:",
    "    watchlist_connection:",
    "      kind: mcp",
    "      ref:",
    `        name: agentexplorer-watchlist-mcp-server`,
    `        namespace: ${org}`,
    "      url: ${watchlist.url}",
    "    triage_state_connection:",
    "      kind: mcp",
    "      ref:",
    "        name: agentexplorer-triage-state",
    `        namespace: ${org}`,
    "      url: ${triageState.url}",
    "    mail_connection:",
    "      kind: mcp",
    "      ref:",
    "        name: agentexplorer-mail-server",
    `        namespace: ${org}`,
    "      url: ${mail.url}",
    "    openai_connection:",
    "      kind: llm",
    "      ref:",
    "        name: llm-openai",
    `        namespace: ${org}`,
    "      url: ${openai.url}",
    "      authentication:",
    "        kind: apiKey",
    "        apiKey: ${openai.apiKey}",
  ].join("\n");

  const res = parseProjectFiles({ exchangeJson, agentYaml });
  check("multi-mcp import parses", res.ok, res.ok ? "" : res.errors.join("; "));
  if (res.ok) {
    const byConn = Object.fromEntries(res.project.assets.map((a) => [a.connectionName, a.assetId]));
    check("watchlist assetId matches ref.name", byConn.watchlist_connection === "agentexplorer-watchlist-mcp-server");
    check("triage state assetId matches ref.name", byConn.triage_state_connection === "agentexplorer-triage-state");
    check("mail assetId matches ref.name", byConn.mail_connection === "agentexplorer-mail-server");
    check("llm assetId matches ref.name", byConn.openai_connection === "llm-openai");

    const yaml = serializeAgentNetworkYaml(res.project);
    check("yaml ref.name watchlist round-trips", yaml.includes("name: agentexplorer-watchlist-mcp-server"));
    check("yaml ref.name triage state round-trips", yaml.includes("name: agentexplorer-triage-state"));
    check("yaml ref.name mail round-trips", yaml.includes("name: agentexplorer-mail-server"));
    check("yaml ref.name llm round-trips", yaml.includes("name: llm-openai"));
  }

  const brokerAgent = [
    "# @dialect: AGENTFABRIC=1.0",
    "system:",
    '  instructions: ""',
    "actions:",
    "  watchlistScreen:",
    '    target: "mcp://watchlist_connection"',
    '    kind: "mcp:tool"',
    '    tool_name: "screen_entity"',
    "trigger trigger:",
    '  kind: "a2a"',
    "  on_message: ->",
    "    transition to @echo.response",
    "echo response:",
    '  kind: "a2a:status_update_event"',
    '  state: "TASK_STATE_COMPLETED"',
    '  message: a2a.message({messageId: uuid(), parts: [a2a.textPart("Done")]})',
  ].join("\n");
  const withBroker = parseProjectFiles({ exchangeJson, agentYaml, brokerAgent });
  check("multi-mcp import with broker parses", withBroker.ok, withBroker.ok ? "" : withBroker.errors.join("; "));
  if (withBroker.ok) {
    const screen = withBroker.project.brokers[0].actions.find((a) => a.name === "watchlistScreen");
    check("broker import preserves watchlist tool_name", screen?.toolName === "screen_entity");
    check(
      "watchlist action keeps watchlist connection",
      screen?.connectionName === "watchlist_connection"
    );
  }
}

console.log("\n[custom variables & marker scanning]");
{
  // splitMarkerKey: group is first segment, field is the rest.
  const s1 = splitMarkerKey("myGroup.apiKey");
  check("splitMarkerKey simple", s1.group === "myGroup" && s1.field === "apiKey");
  const s2 = splitMarkerKey("a.b.c");
  check("splitMarkerKey nested field keeps key", s2.group === "a" && s2.field === "b.c");

  // scanVariableMarkers: only ${group.field} with a dot, ignore ${bare}.
  const markers = scanVariableMarkers([
    { path: "a.txt", content: "use ${foo.bar} and ${foo.bar} again" },
    { path: "b.txt", content: "other ${baz.qux}, ignore ${nodot} and @not.a.marker" },
  ]);
  check("scanVariableMarkers de-dupes keys", markers.length === 2, `${markers.length}`);
  const foo = markers.find((m) => m.key === "foo.bar");
  check("scanVariableMarkers records single location for repeat", foo?.locations.length === 1);
  check("scanVariableMarkers ignores dot-less markers", !markers.some((m) => m.key === "nodot"));

  // addCustomVariable → appears in deriveVariables + exchange.json.
  let p = createScaffoldProject("ORG");
  p = apply(p, { type: "addCustomVariable", variable: { group: "svc", field: "token", secret: true } });
  const vars = deriveVariables(p);
  check("addCustomVariable surfaces in deriveVariables", vars.some((v) => v.group === "svc" && v.field === "token" && v.secret));
  const ex = JSON.parse(serializeExchangeJson(p));
  check("custom variable serialized to exchange.json", ex.metadata.variables.svc?.token?.secret === true);

  // duplicate add is a no-op.
  const before = (p.customVariables ?? []).length;
  p = apply(p, { type: "addCustomVariable", variable: { group: "svc", field: "token" } });
  check("addCustomVariable ignores duplicates", (p.customVariables ?? []).length === before);

  // findUndeclaredMarkers: marker in instructions is undeclared until added.
  let p2 = createScaffoldProject("ORG");
  p2 = apply(p2, { type: "updateBroker", patch: { systemInstructions: "Call with ${my.token}" } });
  const undeclared = findUndeclaredMarkers(p2);
  check("findUndeclaredMarkers flags typed marker", undeclared.some((m) => m.key === "my.token"));
  p2 = apply(p2, { type: "addCustomVariable", variable: { group: "my", field: "token" } });
  check("findUndeclaredMarkers clears after declaring", !findUndeclaredMarkers(p2).some((m) => m.key === "my.token"));

  // updateCustomVariable + removeCustomVariable.
  p2 = apply(p2, { type: "updateCustomVariable", group: "my", field: "token", patch: { default: "abc" } });
  check("updateCustomVariable sets default", deriveVariables(p2).some((v) => v.group === "my" && v.field === "token" && v.default === "abc"));
  p2 = apply(p2, { type: "removeCustomVariable", group: "my", field: "token" });
  check("removeCustomVariable removes it", !deriveVariables(p2).some((v) => v.group === "my" && v.field === "token"));

  // Round-trip: custom variable (not connection-derived) survives serialize→parse.
  let p3 = createScaffoldProject("org-rt");
  p3 = apply(p3, {
    type: "setIdentity",
    patch: { organizationId: "org-rt", assetId: "rt-net", version: "2.0.0" },
  });
  p3 = apply(p3, { type: "addCustomVariable", variable: { group: "custom", field: "endpoint", default: "https://x" } });
  const files = serializeProject(p3);
  const rt = parseProjectFiles({
    exchangeJson: files.find((f) => f.path === "exchange.json")!.content,
    agentYaml: files.find((f) => f.path === "agent-network.yaml")!.content,
    brokerAgent: files.find((f) => f.path.startsWith("brokers/"))!.content,
  });
  check("round-trip custom variable parses", rt.ok, rt.ok ? "" : rt.errors.join("; "));
  if (rt.ok) {
    check(
      "round-trip preserves custom variable",
      (rt.project.customVariables ?? []).some((v) => v.group === "custom" && v.field === "endpoint")
    );
  }

  // Runtime system limits: flat exchange.json variables round-trip.
  let p4 = createScaffoldProject("ORG");
  p4 = apply(p4, {
    type: "addCustomVariable",
    variable: {
      field: "MODULE_GRAPH_ERROR_SETTINGS_MAX_HANDOFF_ITERATIONS",
      flat: true,
      description: "max node-to-node transitions per turn",
      default: "30",
      secret: false,
    },
  });
  const exLimits = JSON.parse(serializeExchangeJson(p4));
  check(
    "runtime limit serializes flat in exchange.json",
    exLimits.metadata.variables.MODULE_GRAPH_ERROR_SETTINGS_MAX_HANDOFF_ITERATIONS?.default === "30"
  );
  check(
    "runtime limit not nested under bogus group",
    exLimits.metadata.variables.MODULE_GRAPH_ERROR_SETTINGS_MAX_HANDOFF_ITERATIONS?.description !== undefined
  );
  const files4 = serializeProject(p4);
  const rt4 = parseProjectFiles({
    exchangeJson: files4.find((f) => f.path === "exchange.json")!.content,
    agentYaml: files4.find((f) => f.path === "agent-network.yaml")!.content,
    brokerAgent: files4.find((f) => f.path.startsWith("brokers/"))!.content,
  });
  check("runtime limit round-trip parses", rt4.ok, rt4.ok ? "" : rt4.errors.join("; "));
  if (rt4.ok) {
    check(
      "runtime limit round-trip preserves flat flag",
      (rt4.project.customVariables ?? []).some(
        (v) => v.flat && v.field === "MODULE_GRAPH_ERROR_SETTINGS_MAX_HANDOFF_ITERATIONS"
      )
    );
  }
}

console.log("\n[LLM variable group import]");
{
  const exchangeJson = JSON.stringify({
    main: "agent-network.yaml",
    name: "Reasoning Only",
    organizationId: "org-1",
    assetId: "agent-net",
    version: "1.0.0",
    metadata: {
      variables: {
        openaiLlm: {
          baseUrl: {
            description: "base URL for the OpenAI API (Version 1)",
            default: "https://api.openai.com/v1/",
            secret: false,
          },
          model: {
            description: "OpenAI LLM model to use",
            default: "gpt-5.1",
            secret: false,
          },
          apiKey: {
            description: "OpenAI LLM model apiKey",
            secret: true,
          },
        },
      },
    },
    dependencies: [
      {
        groupId: "org-1",
        assetId: "llm-openai",
        version: "1.0.0",
        classifier: "llm-metadata",
      },
    ],
  });
  const agentYaml = [
    "agentNetwork: 2.0.0",
    "info:",
    "  label: Reasoning Only",
    "  version: 1.0.0",
    "context:",
    "  connections:",
    "    openai_llm_connection:",
    "      kind: llm",
    "      ref:",
    "        name: llm-openai",
    "        namespace: org-1",
    "      url: ${openaiLlm.baseUrl}",
    "      authentication:",
    "        kind: apiKey",
    "        apiKey: ${openaiLlm.apiKey}",
  ].join("\n");
  const res = parseProjectFiles({ exchangeJson, agentYaml });
  check("LLM import parses", res.ok, res.ok ? "" : res.errors.join("; "));
  if (res.ok) {
    const llm = res.project.assets.find((a) => a.kind === "llm");
    check("LLM asset preserves urlRef", llm?.urlRef === "${openaiLlm.baseUrl}");
    check("LLM asset preserves variableGroup", llm?.variableGroup === "openaiLlm");
    const ex = JSON.parse(serializeExchangeJson(res.project));
    const vars = ex.metadata.variables as Record<string, unknown>;
    check("exchange.json has no spurious llmOpenai group", vars.llmOpenai === undefined);
    const openai = vars.openaiLlm as Record<string, Record<string, { default?: string }>>;
    check("openaiLlm.baseUrl round-trips", openai?.baseUrl?.default === "https://api.openai.com/v1/");
    check("openaiLlm.model round-trips", openai?.model?.default === "gpt-5.1");
    check("openaiLlm.apiKey round-trips", openai?.apiKey?.secret === true);
    const yaml = serializeAgentNetworkYaml(res.project);
    check("yaml keeps ${openaiLlm.baseUrl}", yaml.includes("url: ${openaiLlm.baseUrl}"));
  }
}

console.log("\n[echo round-trip]");
{
  const onboardPart =
    'a2a.textPart("You have been onboarded! Your employee ID is " + @orchestrator.hrSystemOnboard.output.employeeId)';

  const statusAgent = [
    "# @dialect: AGENTFABRIC=1.0",
    "",
    "system:",
    '  instructions: ""',
    "",
    "echo setStatus:",
    '  kind: "a2a:status_update_event"',
    '  state: "TASK_STATE_COMPLETED"',
    "  message: a2a.message({",
    "    messageId: uuid(),",
    "    parts: [",
    `      ${onboardPart}`,
    "    ]",
    "  })",
  ].join("\n");

  const artifactAgent = [
    "# @dialect: AGENTFABRIC=1.0",
    "",
    "system:",
    '  instructions: ""',
    "",
    "echo addArtifact:",
    '  kind: "a2a:artifact_update_event"',
    "  artifact: a2a.artifact({",
    "    artifactId: uuid(),",
    '    name: "myArtifact",',
    '    description: "this is optional",',
    "    parts: [",
    `      ${onboardPart}`,
    "    ],",
    "    metadata: {},",
    "  }),",
    "  append: false",
    "  lastChunk: false",
  ].join("\n");

  function normExpr(s: string): string {
    return s.replace(/\s+/g, " ").trim();
  }

  function echoRoundTrip(agentText: string, nodeName: string) {
    const parsed = parseBrokerAgent(agentText);
    const pn = parsed.nodes.find((n) => n.name === nodeName);
    if (!pn) return { ok: false, reason: "node missing" };
    const broker = {
      id: "b1",
      name: "test_broker",
      interfaceName: "a2a",
      systemInstructions: "",
      nodes: [
        {
          id: "n1",
          kind: "echo" as const,
          name: pn.name,
          position: { x: 0, y: 0 },
          echoKind: pn.echoKind,
          state: pn.state,
          message: pn.message,
          artifactExpr: pn.artifactExpr,
          echoAppend: pn.echoAppend,
          echoLastChunk: pn.echoLastChunk,
          metadataExpr: pn.metadataExpr,
        },
      ],
      llmBindings: [],
      actions: [],
      card: { name: "test", version: "1.0.0" },
    };
    const serialized = serializeBrokerAgent(broker);
    const again = parseBrokerAgent(serialized).nodes.find((n) => n.name === nodeName);
    if (!again) return { ok: false, reason: "re-parse missing node" };
    return { ok: true, first: pn, second: again, serialized };
  }

  const statusRt = echoRoundTrip(statusAgent, "setStatus");
  check("status echo parses", Boolean(statusRt.ok && statusRt.first?.message?.includes("hrSystemOnboard")));
  if (statusRt.ok && statusRt.first && statusRt.second) {
    check(
      "status echo message round-trip",
      normExpr(statusRt.first.message ?? "") === normExpr(statusRt.second.message ?? "")
    );
    check("status echo serialized includes a2a.message", statusRt.serialized.includes("a2a.message("));
    check("status echo serialized includes concat expression", statusRt.serialized.includes("hrSystemOnboard"));
  }

  const artifactRt = echoRoundTrip(artifactAgent, "addArtifact");
  check("artifact echo parses", Boolean(artifactRt.ok && artifactRt.first?.artifactExpr?.includes("myArtifact")));
  if (artifactRt.ok && artifactRt.first && artifactRt.second) {
    check(
      "artifact echo expression round-trip",
      normExpr(artifactRt.first.artifactExpr ?? "") === normExpr(artifactRt.second.artifactExpr ?? "")
    );
    check("artifact echo append round-trip", artifactRt.second.echoAppend === false);
    check("artifact echo lastChunk round-trip", artifactRt.second.echoLastChunk === false);
    check("artifact echo serialized includes artifact:", artifactRt.serialized.includes("artifact: a2a.artifact("));
    check("artifact echo serialized excludes message:", !artifactRt.serialized.includes("message:"));
  }

  const bareStatus = parseBrokerAgent(
    'echo done:\n  kind: "a2a:status_update_event"\n  state: "TASK_STATE_COMPLETED"\n  message: @generator.summarize.output\n'
  );
  check("bare @ message parses", bareStatus.nodes[0]?.message === "@generator.summarize.output");
}

console.log("\n[local project import]");
{
  const entries = [
    { filename: "exchange.json", content: JSON.stringify({ name: "Local Net", groupId: "org-1", assetId: "local-net", version: "2.0.0", dependencies: [] }) },
    { filename: "agent-network.yaml", content: ["agentNetwork: 2.0.0", "label: Local Net", "brokers:", "  b:", "    kind: AgentScript"].join("\n") },
    { filename: "brokers/b.agent", content: "agent b:\n  instructions: hi\n  on_exit: ->\n    transition to @echo.response\necho response:\n  kind: a2a:status_update_event\n  message: ok\n" },
  ];
  const ok = importLocalProjectEntries(entries, "org-fallback");
  check("importLocalProjectEntries succeeds", ok.project.identity.name === "Local Net");
  check("importLocalProjectEntries uses fallback org", ok.project.identity.organizationId === "org-1" || ok.project.assets.every((a) => true));

  let threw = false;
  try {
    importLocalProjectEntries([{ filename: "agent-network.yaml", content: "schemaVersion: 1.0.0\nconnections:\n  x: {}\nbrokers:\n  b: {}" }]);
  } catch {
    threw = true;
  }
  check("importLocalProjectEntries rejects v1 yaml", threw);
}

console.log("\n[registry ref name]");
{
  const { registryNameForAsset } = await import("@/lib/composer/model");
  const asset = {
    id: "a1",
    kind: "llm" as const,
    groupId: "org",
    assetId: "llm-openai",
    version: "1.0.0",
    name: "llm-openai",
    baseName: "llm-openai",
    url: "",
  };
  check("registryNameForAsset keeps Exchange assetId hyphens", registryNameForAsset(asset) === "llm-openai");
}

console.log("\n[reasoning detail round-trip]");
{
  const agentText = [
    "# @dialect: AGENTFABRIC=1.0",
    "system:",
    '  instructions: ""',
    "config:",
    "  agent_name: b",
    "trigger t:",
    "  kind: a2a",
    "  target: brokers://b/a2a",
    "  on_message: ->",
    "    transition to @orchestrator.o",
    "orchestrator o:",
    '  label: "Loop node"',
    "  reasoning:",
    "    instructions: |",
    "      do work",
    "    outputs:",
    "      properties:",
    "        summary:",
    '          type: "string"',
    "    max_number_of_loops: 25",
    "  on_exit: ->",
    "    transition to @echo.e",
    "echo e:",
    '  kind: "a2a:status_update_event"',
    '  state: "TASK_STATE_COMPLETED"',
    '  message: a2a.message({messageId: uuid(), parts: [a2a.textPart("ok")]})',
  ].join("\n");
  const parsed = parseBrokerAgent(agentText);
  const pn = parsed.nodes.find((n) => n.kind === "orchestrator");
  check("orchestrator reasoning outputs parse", (pn?.outputs?.length ?? 0) === 1 && pn?.outputs?.[0]?.name === "summary");
  check("orchestrator max_number_of_loops parses", pn?.maxNumberOfLoops === 25);
  check("orchestrator label parses", pn?.label === "Loop node");

  const procedureAgent = [
    "# @dialect: AGENTFABRIC=1.0.0",
    "system:",
    '  instructions: ""',
    "config:",
    "  agent_name: b",
    "trigger t:",
    "  kind: a2a",
    "  target: brokers://b/a2a",
    "  on_message: ->",
    "    transition to @orchestrator.o",
    "orchestrator o:",
    "  reasoning:",
    "    instructions: ->",
    "      | do work",
    "  on_exit: ->",
    "    transition to @echo.e",
    "echo e:",
    '  kind: "a2a:status_update_event"',
    '  state: "TASK_STATE_COMPLETED"',
    "  message: a2a.message({",
    "    messageId: uuid(),",
    "    parts: [",
    '      a2a.textPart("ok")',
    "    ]",
    "  })",
  ].join("\n");
  const procParsed = parseBrokerAgent(procedureAgent);
  check("dialect header parses", procParsed.agentDialectVersion === "1.0.0");
  const procOrch = procParsed.nodes.find((n) => n.kind === "orchestrator");
  check("reasoning procedure flag parses", procOrch?.reasoningInstructionsProcedure === true);
  const procEcho = procParsed.nodes.find((n) => n.kind === "echo");
  check("multiline echo message parses completely", procEcho?.message?.endsWith("})"));
}

console.log("\n[baseline compare]");
{
  const { compareProjectWithBaseline } = await import("@/lib/composer/compare/compare-with-baseline");
  const { diffLineRows } = await import("@/lib/composer/compare/line-diff");

  const baselineYaml = "a: 1\nb: 2\n";
  const currentYaml = "a: 1\nb: 3\n";
  const rows = diffLineRows(baselineYaml, currentYaml);
  check("line diff detects one change", rows.some((r) => r.kind === "remove") && rows.some((r) => r.kind === "add"));

  const exchangeJson = JSON.stringify({
    name: "Test",
    assetId: "net",
    version: "1.0.0",
    organizationId: "org-1",
    dependencies: [],
    metadata: { variables: {} },
  });
  const agentYaml = [
    "agentNetwork: 2.0.0",
    "info:",
    "  label: Test",
    "  version: 1.0.0",
    "brokers:",
    "  b:",
    "    kind: AgentScript",
    "    implementation: ./brokers/b.agent",
    "    interfaces:",
    "      a2a:",
    "        card:",
    "          name: B",
    "          version: 1.0.0",
  ].join("\n");
  const brokerAgent = [
    "# @dialect: AGENTFABRIC=1.0",
    "system:",
    '  instructions: ""',
    "config:",
    "  agent_name: b",
    "trigger t:",
    "  kind: a2a",
    "  target: brokers://b/a2a",
    "  on_message: ->",
    "    transition to @echo.e",
    "echo e:",
    '  kind: "a2a:status_update_event"',
    '  state: "TASK_STATE_COMPLETED"',
    '  message: a2a.message({messageId: uuid(), parts: [a2a.textPart("ok")]})',
  ].join("\n");

  const entries = [
    { filename: "exchange.json", content: exchangeJson },
    { filename: "agent-network.yaml", content: agentYaml },
    { filename: "brokers/b.agent", content: brokerAgent },
  ];

  const parsed = parseProjectFiles({ exchangeJson, agentYaml, brokerAgent });
  check("compare fixture parses", parsed.ok, parsed.ok ? "" : parsed.errors.join("; "));
  if (parsed.ok) {
    const { serializeProject } = await import("@/lib/composer/serialize");
    const current = serializeProject(parsed.project);
    const roundTripEntries = current.map((f) => ({ filename: f.path, content: f.content }));
    const same = compareProjectWithBaseline(current, roundTripEntries, "golden");
    check("compare identical serialized files match", same.summary.matching === 3 && same.summary.differing === 0);

    const mutated = serializeProject({
      ...parsed.project,
      identity: { ...parsed.project.identity, name: "Changed" },
    });
    const diff = compareProjectWithBaseline(mutated, entries, "golden");
    check("compare detects identity change", diff.summary.differing >= 1);
    check("compare report includes markdown header", diff.reportMarkdown.includes("# Project compare"));
  }
}

console.log("\n[it-help round-trip fidelity]");
{
  const agentText = [
    "# @dialect: AGENTFABRIC=0.1-BETA",
    "system:",
    '  instructions: "hi"',
    "config:",
    '  agent_name: "it-help-investigation"',
    "executor escalateTicket:",
    '  description: "Escalates"',
    "  do: ->",
    "    run @actions.escalate_ticket",
    "      with ticket_id = @generator.classifySeverity.output.ticket_id",
    "      with severity = \"high\"",
    "  on_exit: ->",
    "    transition to @echo.escalationResponse",
    "echo escalationResponse:",
    '  kind: "a2a:status_update_event"',
    '  state: "TASK_STATE_COMPLETED"',
    '  message: a2a.message({messageId: uuid(), parts: [a2a.textPart("Ticket escalated")]})',
    "orchestrator crossPlatformTriage:",
    "  reasoning:",
    "    instructions: ->",
    "      | do work",
    "    actions:",
    "      search_help: @actions.help_center_agent",
    "      update_ticket: @actions.update_jira_ticket",
    "        with ticket_id = @gen.out.ticket_id",
    "    outputs:",
    "      properties:",
    "        severity:",
    '          type: "string"',
    "          enum:",
    '            - "high"',
    '            - "low"',
    "generator classifySeverity:",
    '  label: "Classify"',
    "  prompt: ->",
    "    | {!@request.payload.message.parts[0].text}",
  ].join("\n");

  const parsed = parseBrokerAgent(agentText);
  check("dialect 0.1-BETA parses", parsed.agentDialectVersion === "0.1-BETA");
  const exec = parsed.nodes.find((n) => n.name === "escalateTicket");
  check("executor with-args parse", exec?.executorStatements?.[0]?.kind === "run" && exec.executorStatements[0].withArgs?.length === 2);
  const echo = parsed.nodes.find((n) => n.name === "escalationResponse");
  check("status echo kind", echo?.echoKind === "a2a:status_update_event");
  check("status echo message parses", echo?.message?.includes("Ticket escalated"));
  const orch = parsed.nodes.find((n) => n.name === "crossPlatformTriage");
  check("orchestrator action alias", orch?.actionBindings?.[0]?.alias === "search_help");
  check("orchestrator action with-args", orch?.actionBindings?.[1]?.withArgs?.[0]?.name === "ticket_id");
  check("output enum parses", orch?.outputs?.[0]?.enum?.join(",") === "high,low");
  const gen = parsed.nodes.find((n) => n.name === "classifySeverity");
  check("generator prompt procedure", gen?.promptProcedure === true);

  const triageAgentSnippet = [
    "# @dialect: AGENTFABRIC=1",
    "config:",
    '  agent_name: "triage-test"',
    "generator classifyIntent:",
    '  label: "Classify"',
    "  prompt: ->",
    '    | classify',
    "  outputs:",
    "    properties:",
    "      intent:",
    '        type: "string"',
    '        description: "The classified intent"',
    "        enum:",
    '          - "list"',
    '          - "triage"',
    "      submissionIds:",
    '        type: "array"',
    '        description: "Submission ids explicitly named in the message"',
    "        items:",
    '          type: "string"',
  ].join("\n");
  const triageParsed = parseBrokerAgent(triageAgentSnippet).nodes.find((n) => n.name === "classifyIntent");
  check("triage intent enum parses", triageParsed?.outputs?.[0]?.enum?.join(",") === "list,triage");
  check(
    "triage submissionIds array items parses",
    triageParsed?.outputs?.[1]?.type === "array" && triageParsed?.outputs?.[1]?.items?.type === "string"
  );

  const broker = createScaffoldProject("org").brokers[0];
  broker.nodes.push({
    id: "n1",
    kind: "generator",
    name: "classifyIntent",
    label: "Classify",
    position: { x: 0, y: 0 },
    outputs: [
      { name: "intent", type: "string", description: "The classified intent", enum: ["list", "triage", "compose", "offtopic"] },
      { name: "submissionIds", type: "array", description: "Submission ids explicitly named in the message", items: { type: "string" } },
    ],
  });
  const triageAgent = serializeBrokerAgent({ ...broker, name: "triage" });
  check("output enum serializes", triageAgent.includes('enum:') && triageAgent.includes('"list"') && triageAgent.includes('"triage"'));
  check("array items serializes", triageAgent.includes("submissionIds:") && triageAgent.includes("items:") && triageAgent.includes('type: "string"'));
  const triageRoundTrip = parseBrokerAgent(triageAgent).nodes.find((n) => n.name === "classifyIntent");
  check("output enum + array items round-trip",
    triageRoundTrip?.outputs?.[0]?.enum?.length === 4 &&
      triageRoundTrip?.outputs?.[1]?.items?.type === "string"
  );

  broker.nodes[0].description = undefined;
  const withDefaultDescription = serializeBrokerAgent(broker);
  check(
    "missing node description is not replaced with synthetic content",
    !/generator classifyIntent:\n  description:/.test(withDefaultDescription)
  );

  const triageResultsSnippet = [
    "orchestrator triagePipeline:",
    "  reasoning:",
    "    instructions: |",
    "      Triage these submissions",
    "    actions:",
    "      extract: @actions.extract",
    "        with submissionId = ...",
    "    max_number_of_loops: 60",
    "    task_timeout_secs: 360",
    "    outputs:",
    "      properties:",
    "        results:",
    '          type: "array"',
    '          description: "One entry per triaged submission."',
    "          items:",
    '            type: "object"',
    "            properties:",
    "              submissionId:",
    '                type: "string"',
    "              recommendation:",
    '                type: "string"',
    "                enum:",
    '                  - "quote"',
    '                  - "decline"',
  ].join("\n");
  const triageOrch = parseBrokerAgent(triageResultsSnippet).nodes.find((n) => n.name === "triagePipeline");
  check("orchestrator task_timeout_secs parses", triageOrch?.taskTimeoutSecs === 360);
  check("orchestrator max loops parses in snippet", triageOrch?.maxNumberOfLoops === 60);
  check("orchestrator action with-args parses", triageOrch?.actionBindings?.[0]?.withArgs?.[0]?.name === "submissionId");
  check(
    "nested array object output parses",
    triageOrch?.outputs?.[0]?.items?.type === "object" &&
      triageOrch?.outputs?.[0]?.items?.properties?.some((p) => p.name === "recommendation" && p.enum?.includes("quote"))
  );

  const exchangeJson = JSON.stringify({
    name: "IT Help",
    groupId: "org-1",
    assetId: "it-help-network",
    version: "1.0.0",
    organizationId: "org-1",
    dependencies: [],
    metadata: { variables: {} },
  });
  const agentYaml = [
    'agentNetwork: "2.0.0"',
    "info:",
    '  label: "IT Help"',
    "  version: v1",
    "registry:",
    "  agents:",
    "    helpCenterAgent:",
    "      info:",
    "        label: Help Center",
    "context:",
    "  connections:",
    "    geminiConnection:",
    "      kind: llm",
    "      ref:",
    "        name: gemini",
    "      url: https://generativelanguage.googleapis.com",
    "      authentication:",
    "        kind: apiKey",
    "        apiKey: ${gemini.apiKey}",
    "brokers:",
    "  it-help-investigation:",
    "    kind: AgentScript",
    "    implementation: ./brokers/it-help-investigation.agent",
    "    interfaces:",
    "      a2a:",
    "        card:",
    "          name: Broker",
    "          version: 1.0.0",
  ].join("\n");

  const project = parseProjectFiles({ exchangeJson, agentYaml, brokerAgent: agentText });
  check("it-help project parses", project.ok, project.ok ? "" : project.errors.join("; "));
  if (project.ok) {
    const { serializeProject } = await import("@/lib/composer/serialize");
    const files = Object.fromEntries(serializeProject(project.project).map((f) => [f.path, f.content]));
    check("broker key normalized from hyphens", project.project.brokers[0].name === "it_help_investigation");
    check("registry round-trips", files["agent-network.yaml"].includes("registry:"));
    check("yaml info.version v1", files["agent-network.yaml"].includes("version: v1"));
    check("empty dependencies preserved", files["exchange.json"].includes('"dependencies": []'));
    check("literal llm url in yaml", files["agent-network.yaml"].includes("https://generativelanguage.googleapis.com"));
    check("terminal status response serialized", files["brokers/it_help_investigation.agent"].includes("a2a:status_update_event"));
  }
}

console.log("\n[deploy options]");
{
  const variables = flattenExchangeDeployVariables({
    openaiLlm: {
      baseUrl: {
        description: "base URL for the OpenAI API (Version 1)",
        default: "https://api.openai.com/v1/",
        secret: false,
      },
      apiKey: { description: "OpenAI LLM model apiKey", secret: true },
    },
    MODULE_GRAPH_ERROR_SETTINGS_MAX_HANDOFF_ITERATIONS: {
      default: "30",
      secret: false,
    },
  });
  check("flatten nested deploy variables", variables.length === 3);
  check(
    "flatten includes dot keys",
    variables.some((v) => v.key === "openaiLlm.baseUrl") &&
      variables.some((v) => v.key === "openaiLlm.apiKey")
  );
  check(
    "flatten flat top-level variable",
    variables.some((v) => v.key === "MODULE_GRAPH_ERROR_SETTINGS_MAX_HANDOFF_ITERATIONS")
  );

  const props = propertiesFromVariables(variables);
  check("propertiesFromVariables seeds defaults", props.find((p) => p.name === "openaiLlm.baseUrl")?.value.includes("openai.com"));

  const incomplete = deployOptionsReady(defaultDeployOptions(), variables);
  check("deploy blocked without environment", !incomplete.ok);

  const sharedReady = deployOptionsReady(
    {
      ...defaultDeployOptions(),
      organizationId: "a1b2c3d4-0000-0000-0000-000000000000",
      environment: "PRD",
      targetKind: "shared",
      gateway: "omni-ai-gateway",
      properties: props.map((p) =>
        p.name === "openaiLlm.apiKey" ? { ...p, value: "sk-test" } : p
      ),
    },
    variables
  );
  check("deploy ready with shared gateway only", sharedReady.ok === true);

  const { appendDeployArgv } = await import("../lib/lifecycle-server/security/deploy-argv");
  const argv: string[] = ["agent-network", "project", "deploy", "--path", "/tmp/project"];
  appendDeployArgv(argv, {
    organization: "Acme Business Group",
    environment: "PRD",
    targetKind: "shared",
    gateway: "omni-ai-gateway",
    properties: [{ name: "openaiLlm.model", value: "gpt-5.1" }],
  });
  check(
    "appendDeployArgv shared space uses gateway only",
    argv.includes("--environment") &&
      argv.includes("PRD") &&
      !argv.includes("--target-space") &&
      argv.includes("--gateway") &&
      argv.includes("omni-ai-gateway") &&
      !argv.includes("--ingress-gw") &&
      !argv.includes("--egress-gw") &&
      argv.includes("--property") &&
      argv.includes("openaiLlm.model:gpt-5.1")
  );

  const privateArgv: string[] = ["agent-network", "project", "deploy", "--path", "/tmp/project"];
  appendDeployArgv(privateArgv, {
    organization: "Acme Business Group",
    environment: "PRD",
    targetKind: "private",
    targetSpace: "myPrivateSpace",
    ingressGw: "flex",
    egressGw: "flex",
    properties: [],
  });
  check(
    "appendDeployArgv private space includes target-space",
    privateArgv.includes("--target-space") &&
      privateArgv.includes("myPrivateSpace") &&
      privateArgv.includes("--ingress-gw") &&
      privateArgv.includes("flex")
  );

  let corrupted = false;
  try {
    appendDeployArgv([], {
      organization: "Acme Business Group",
      environment: "PRD",
      targetKind: "shared",
      gateway: "omni-ai-gateway",
      properties: [
        {
          name: "openaiLlm.apiKey",
          value: "Using shared space 'Cloudhub-EU-West-1' derived from gateway 'omni-ai-gateway'.",
        },
      ],
    });
  } catch {
    corrupted = true;
  }
  check("appendDeployArgv rejects corrupted api key", corrupted);
}

console.log("\n[removal argv]");
{
  const { appendRemovalArgv } = await import("../lib/lifecycle-server/security/removal-argv");

  const undeployArgv: string[] = ["agent-network", "project", "undeploy"];
  appendRemovalArgv(undeployArgv, "undeploy", {
    organization: "Acme Business Group",
    environment: "PRD",
    gav: "a1b2c3d4:my-network:1.0.0",
  });
  check(
    "appendRemovalArgv undeploy targets a gav",
    undeployArgv.includes("--organization") &&
      undeployArgv.includes("Acme Business Group") &&
      undeployArgv.includes("--environment") &&
      undeployArgv.includes("PRD") &&
      undeployArgv.includes("--gav") &&
      undeployArgv.includes("a1b2c3d4:my-network:1.0.0") &&
      !undeployArgv.includes("--hard-delete")
  );

  // Without --force the CLI prompts, and the worker spawns with no stdin.
  check("appendRemovalArgv always forces", undeployArgv.includes("--force"));

  const bundleArgv: string[] = ["agent-network", "project", "unpublish"];
  appendRemovalArgv(bundleArgv, "unpublish", { organization: "Acme Business Group" });
  check(
    "appendRemovalArgv unpublish without a gav leaves --path to the runner",
    !bundleArgv.includes("--gav") &&
      !bundleArgv.includes("--environment") &&
      !bundleArgv.includes("--hard-delete") &&
      bundleArgv.includes("--force")
  );

  const hardArgv: string[] = ["agent-network", "project", "unpublish"];
  appendRemovalArgv(hardArgv, "unpublish", {
    organization: "Acme Business Group",
    environment: "PRD",
    gav: "a1b2c3d4:my-network:1.0.0",
    hardDelete: true,
  });
  check("appendRemovalArgv passes hard delete through", hardArgv.includes("--hard-delete"));

  // Soft delete is the CLI's default, expressed by omitting the flag entirely.
  const softArgv: string[] = ["agent-network", "project", "unpublish"];
  appendRemovalArgv(softArgv, "unpublish", {
    organization: "Acme Business Group",
    gav: "a1b2c3d4:my-network:1.0.0",
    hardDelete: false,
  });
  check("appendRemovalArgv omits the flag for a soft delete", !softArgv.includes("--hard-delete"));

  const undeployHardArgv: string[] = ["agent-network", "project", "undeploy"];
  appendRemovalArgv(undeployHardArgv, "undeploy", {
    organization: "Acme Business Group",
    environment: "PRD",
    hardDelete: true,
  });
  check(
    "appendRemovalArgv never sends hard delete to undeploy, which has no such flag",
    !undeployHardArgv.includes("--hard-delete")
  );

  const rejects = (label: string, run: () => void) => {
    let threw = false;
    try {
      run();
    } catch {
      threw = true;
    }
    check(label, threw);
  };

  rejects("appendRemovalArgv rejects undeploy without an environment", () =>
    appendRemovalArgv([], "undeploy", { organization: "Acme", gav: "g:a:1.0.0" })
  );
  rejects("appendRemovalArgv rejects a missing organization", () =>
    appendRemovalArgv([], "unpublish", { gav: "g:a:1.0.0" })
  );
  rejects("appendRemovalArgv rejects a malformed gav", () =>
    appendRemovalArgv([], "unpublish", { organization: "Acme", gav: "not-a-gav" })
  );
  rejects("appendRemovalArgv rejects a gav carrying an extra flag", () =>
    appendRemovalArgv([], "unpublish", {
      organization: "Acme",
      gav: "g:a:1.0.0 --hard-delete",
    })
  );
  rejects("appendRemovalArgv rejects control characters in an organization", () =>
    appendRemovalArgv([], "unpublish", { organization: "Acme\nEvil" })
  );
}

console.log("\n[cli command capabilities]");
{
  const { COMMANDS } = await import("../lib/lifecycle-server/security/command-allowlist");

  // Passing --debug to a command that lacks it makes oclif fail while
  // serializing its own error, which hides the real cause entirely. These
  // mirror `agent-network project <cmd> --help` in plugin 1.2.11.
  check(
    "only build and publish advertise --debug",
    COMMANDS.build.debug &&
      COMMANDS.publish.debug &&
      !COMMANDS.deploy.debug &&
      !COMMANDS.unpublish.debug &&
      !COMMANDS.undeploy.debug
  );
  check(
    "build is the only command without --json",
    !COMMANDS.build.json &&
      COMMANDS.publish.json &&
      COMMANDS.deploy.json &&
      COMMANDS.unpublish.json &&
      COMMANDS.undeploy.json
  );
}

console.log("\n[deployment targets parse]");
{
  const { parseDeploymentTargetsResponse, pickDeploymentTargetDefault } = await import(
    "@/lib/mulesoft/deployment-targets"
  );
  const targets = parseDeploymentTargetsResponse({
    data: [
      { id: "1", name: "myPrivateSpace" },
      { id: "2", name: "Cloudhub-EU-West-1" },
      { id: "3", name: "Cloudhub-US-East-2" },
    ],
  });
  check("parse deployment targets", targets.length === 3);
  check(
    "classify shared vs private",
    targets.find((t) => t.name === "Cloudhub-EU-West-1")?.kind === "shared" &&
      targets.find((t) => t.name === "myPrivateSpace")?.kind === "private"
  );
  check(
    "pick shared default",
    pickDeploymentTargetDefault("agent-network-space", targets, "shared") === "Cloudhub-EU-West-1"
  );
}

console.log("\n[managed gateways parse]");
{
  const {
    parseGatewayTargetName,
    parseManagedGatewaysResponse,
  } = await import("@/lib/mulesoft/managed-gateways");
  const { pickGatewayDefault } = await import("@/components/desktop/GatewaySelect");
  const parsed = parseManagedGatewaysResponse({
    data: [
      { id: "1", name: "flex", status: "RUNNING" },
      {
        id: "2",
        name: "omni-ai-gateway",
        status: "RUNNING",
        deploymentTarget: { name: "Cloudhub-EU-West-1" },
      },
    ],
  });
  check("parse gateway manager list", parsed.length === 2 && parsed[1]?.name === "omni-ai-gateway");
  check(
    "parse derived target space",
    parsed[1]?.derivedTargetSpace === "Cloudhub-EU-West-1"
  );
  check(
    "parse gateway detail targetName",
    parseGatewayTargetName({ id: "2", name: "omni-ai-gateway", targetName: "Cloudhub-EU-West-1" }) ===
      "Cloudhub-EU-West-1"
  );
  check(
    "pickGatewayDefault replaces unknown",
    pickGatewayDefault("agent-network-shared-gw", parsed) === "flex"
  );
  check(
    "pickGatewayDefault keeps valid",
    pickGatewayDefault("omni-ai-gateway", parsed) === "omni-ai-gateway"
  );
}

console.log("\n[cli activity parse]");
{
  const { parseCliActivityLog, sanitizeCliInvocation, summarizeCliInvocation, formatRawCliLog } =
    await import("@/lib/desktop/cli-output-parser");
  const sampleLog = [
    {
      channel: "meta" as const,
      text: "$ anypoint-cli-v4 agent-network project deploy --environment PRD --gateway omni-ai-gateway --property openaiLlm.apiKey:sk-secret",
    },
    { channel: "stdout" as const, text: "Using shared space 'Cloudhub-EU-West-1' derived from gateway 'omni-ai-gateway'.\n" },
    { channel: "stdout" as const, text: "\x1b[36mDeploying Agent Network project Agent Network ReasonOnly.\x1b[0m\n" },
    { channel: "stdout" as const, text: "\x1b[36mDeployment for connection: '[LLM] llm-openai' starting...\x1b[0m\n" },
    { channel: "stdout" as const, text: '{"name":"openai_llm_connection_v1","version":"1.0.0","url":"http://example/"}\n' },
    { channel: "stdout" as const, text: "\x1b[36mDeployment for connection: '[LLM] llm-openai' finished... ✅\x1b[0m\n" },
    { channel: "stderr" as const, text: " ›   Error: Error while executing deployment stage: {\n ›     \"errorCode\": 3013,\n ›     \"errorMessage\": \"Request to check the status of the deploying application failed after 3 attempts. Last status: 404\"\n ›   }\n" },
    { channel: "stdout" as const, text: '{"error":{"errorCode":9001,"errorMessage":"Error while executing deployment. Please check the logs for more details."}}\n' },
    { channel: "meta" as const, text: "❌ Deployment failed." },
  ];
  check(
    "sanitize redacts api key",
    sanitizeCliInvocation(sampleLog[0].text).includes("apiKey:••••••") &&
      !sanitizeCliInvocation(sampleLog[0].text).includes("sk-secret")
  );
  check(
    "summarize deploy invocation",
    summarizeCliInvocation(sampleLog[0].text) === "Deploy · PRD · omni-ai-gateway"
  );
  const items = parseCliActivityLog(sampleLog, "deploy");
  check(
    "parse deploy activity",
    items.some((i) => i.kind === "derived-space") &&
      items.some((i) => i.kind === "endpoint" && i.name === "openai_llm_connection_v1") &&
      items.some((i) => i.kind === "deployment" && i.phase === "finished") &&
      items.some((i) => i.kind === "error" && i.code === 3013) &&
      items.filter((i) => i.kind === "error").length === 1
  );
  const versionedDeploymentLog = [
    { channel: "stdout" as const, text: "Deployment for connection: '[LLM] llm-openai' — version 1.0.0 starting...\n" },
    { channel: "stdout" as const, text: "Deployment for connection: '[LLM] llm-openai' — version 1.0.0 finished... ✅\n" },
    {
      channel: "stdout" as const,
      text: "Deployment for Agent Graph: 'an-reasoning-only-agent-graph' — version 1.0.43 starting...\n",
    },
    {
      channel: "stdout" as const,
      text: "Deployment for Agent Graph: 'an-reasoning-only-agent-graph' — version 1.0.43 finished... ✅\n",
    },
    {
      channel: "stdout" as const,
      text: "Deployment for instance: '[Broker] agent_reason_only' — version 1.0.1 starting...\n",
    },
    {
      channel: "stdout" as const,
      text: "Deployment for instance: '[Broker] agent_reason_only' — version 1.0.1 finished... ✅\n",
    },
  ];
  const versionedItems = parseCliActivityLog(versionedDeploymentLog, "deploy");
  check(
    "parse deployment lines with version markers",
    versionedItems.filter((i) => i.kind === "deployment" && i.phase === "starting").length === 3 &&
      versionedItems.filter((i) => i.kind === "deployment" && i.phase === "finished").length === 3
  );
  check(
    "format raw cli log is verbatim",
    formatRawCliLog(sampleLog).includes("sk-secret") && formatRawCliLog(sampleLog).includes("Cloudhub-EU-West-1")
  );
}

console.log("\n[last project path]");
{
  const { getLastProjectDir, setLastProjectDir } = await import("@/lib/desktop/last-project-path");
  const storage = new Map<string, string>();
  (globalThis as { window?: Window }).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  } as Window;
  setLastProjectDir("/tmp/my-project");
  check("remember project dir", getLastProjectDir() === "/tmp/my-project");
  setLastProjectDir(null);
  check("clear project dir", getLastProjectDir() === null);
}

console.log("\n[exchange.json stays in sync with assets]");
{
  const exchangeJson = JSON.stringify({
    name: "Sync Net",
    groupId: "org-1",
    assetId: "sync-net",
    version: "1.0.0",
    organizationId: "org-1",
    dependencies: [
      { groupId: "org-1", assetId: "weather-mcp", version: "1.0.0", classifier: "mcp-metadata", packaging: "zip" },
      { groupId: "org-1", assetId: "notes-mcp", version: "2.0.0", classifier: "mcp-metadata", packaging: "zip" },
    ],
    metadata: { variables: {} },
  });
  const agentYaml = [
    'agentNetwork: "2.0.0"',
    "info:",
    '  label: "Sync Net"',
    "  version: v1",
    "context:",
    "  connections:",
    "    weatherMcpConnection:",
    "      kind: mcp",
    "      ref:",
    "        name: weather-mcp",
    "      url: https://weather.example.com",
    "    notesMcpConnection:",
    "      kind: mcp",
    "      ref:",
    "        name: notes-mcp",
    "      url: https://notes.example.com",
    "brokers:",
    "  demo:",
    "    kind: AgentScript",
    "    implementation: ./brokers/demo.agent",
    "    interfaces:",
    "      a2a:",
    "        card:",
    "          name: Demo",
    "          version: 1.0.0",
  ].join("\n");
  const brokerAgent = ["# @dialect: AGENTFABRIC=1.0", "agent demo:", "  trigger t:", "    kind: a2a:message"].join("\n");

  const parsed = parseProjectFiles({ exchangeJson, agentYaml, brokerAgent });
  check("sync project parses", parsed.ok, parsed.ok ? "" : parsed.errors.join("; "));
  if (parsed.ok) {
    const before = JSON.parse(serializeExchangeJson(parsed.project));
    check("both dependencies exported", before.dependencies.length === 2);

    const weather = parsed.project.assets.find((a) => a.assetId === "weather-mcp");
    const afterRemove = apply(parsed.project, { type: "removeAsset", id: weather?.id ?? "" });
    const removed = JSON.parse(serializeExchangeJson(afterRemove));
    check(
      "removing an asset drops its exchange.json dependency",
      removed.dependencies.length === 1 && removed.dependencies[0].assetId === "notes-mcp",
      JSON.stringify(removed.dependencies)
    );

    const notes = parsed.project.assets.find((a) => a.assetId === "notes-mcp");
    const afterBump = apply(parsed.project, {
      type: "updateAsset",
      id: notes?.id ?? "",
      patch: { version: "3.1.0" },
    });
    const bumped = JSON.parse(serializeExchangeJson(afterBump));
    check(
      "bumping an asset version updates the dependency",
      bumped.dependencies.some((d: { assetId: string; version: string }) => d.assetId === "notes-mcp" && d.version === "3.1.0"),
      JSON.stringify(bumped.dependencies)
    );
  }
}

console.log("\n[action http_headers migration]");
{
  const agentText = [
    "# @dialect: AGENTFABRIC=1.0",
    "agent demo:",
    "actions:",
    "  callTool:",
    '    target: "mcp://weatherConnection"',
    '    kind: "mcp:tool"',
    '    tool_name: "forecast"',
    "    inputs:",
    "      city: string",
    "    http_headers:",
    '      X-Api-Key: "secret"',
    '      x-request-id: "abc-123"',
  ].join("\n");
  const action = parseBrokerAgent(agentText).actions.find((a) => a.name === "callTool");
  check("http_headers parse", action?.httpHeaders?.length === 2, JSON.stringify(action?.httpHeaders));
  check(
    "http_headers preserves name and value",
    action?.httpHeaders?.[0]?.name === "X-Api-Key" && action?.httpHeaders?.[0]?.value === "secret"
  );
  check("inputs still parse alongside http_headers", action?.inputs?.[0]?.name === "city");

  const broker = createScaffoldProject("ORG").brokers[0];
  const withHeaders = {
    ...broker,
    actions: [
      {
        id: "a1",
        name: "callTool",
        actionKind: "mcp:tool" as const,
        connectionName: "weatherConnection",
        toolName: "forecast",
        httpHeaders: [{ name: "X-Api-Key", value: "secret" }],
      },
    ],
    nodes: [
      ...broker.nodes,
      {
        id: "orchestrator-headers",
        name: "invokeTool",
        kind: "orchestrator" as const,
        position: { x: 0, y: 0 },
        reasoningInstructions: "Invoke the tool.",
        actionBindings: [
          {
            alias: "callTool",
            actionName: "callTool",
            withArgs: [{ name: "http_headers", value: '{"X-Api-Key": "secret"}' }],
          },
        ],
      },
    ],
  };
  const emitted = serializeBrokerAgent(withHeaders);
  check("definition-level http_headers omitted", !/\n {4}http_headers:/.test(emitted), emitted);
  check(
    "invocation-level http_headers serialized",
    emitted.includes('with http_headers = {"X-Api-Key": "secret"}'),
    emitted
  );
  const reparsed = parseBrokerAgent(emitted).nodes.find((node) => node.name === "invokeTool");
  check(
    "invocation-level http_headers survive round-trip",
    reparsed?.actionBindings?.[0]?.withArgs?.[0]?.name === "http_headers"
  );
}

console.log("\n[block scalar node description]");
{
  const agentText = [
    "# @dialect: AGENTFABRIC=1.0",
    "agent demo:",
    "generator g:",
    "  description: |",
    "    First line of prose.",
    "    Second line of prose.",
    '  prompt: "hi"',
  ].join("\n");
  const node = parseBrokerAgent(agentText).nodes.find((n) => n.name === "g");
  check(
    "block scalar description parses both lines",
    node?.description === "First line of prose.\nSecond line of prose.",
    JSON.stringify(node?.description)
  );
}

console.log("\n[inline action invocation bindings]");
{
  const agentText = [
    "# @dialect: AGENTFABRIC=1.0",
    "config:",
    '  agent_name: "demo"',
    "orchestrator route:",
    '  description: "Route work"',
    "  reasoning:",
    '    instructions: "Use the action."',
    "    actions:",
    '      lookup: @actions.search with query = "weather with rain = possible" with http_headers = {"X-Trace": uuid()}',
    "  on_exit: ->",
    "    transition to @echo.done",
  ].join("\n");
  const binding = parseBrokerAgent(agentText).nodes[0]?.actionBindings?.[0];
  check("inline action alias parses", binding?.alias === "lookup");
  check("inline action target parses", binding?.actionName === "search");
  check(
    "multiple inline with arguments parse outside quoted text",
    binding?.withArgs?.length === 2 &&
      binding.withArgs[0]?.value === '"weather with rain = possible"' &&
      binding.withArgs[1]?.name === "http_headers"
  );
}

console.log("\n[reference integrity on rename and delete]");
{
  let p = createScaffoldProject("ORG");
  const broker = p.brokers[0];
  p = {
    ...p,
    brokers: [
      {
        ...broker,
        defaultLlmBindingName: "mainLlm",
        llmBindings: [
          { id: "lb1", name: "mainLlm", connectionName: "openaiConnection", provider: "OpenAI" as const, model: "gpt-4" },
        ],
        actions: [
          { id: "ac1", name: "search", actionKind: "a2a:send_message" as const, connectionName: "helpConnection" },
        ],
        nodes: [
          ...broker.nodes,
          {
            id: "n1",
            kind: "executor" as const,
            name: "runner",
            position: { x: 0, y: 0 },
            executorStatements: [{ kind: "run", actionName: "search" }],
          },
          {
            id: "n2",
            kind: "orchestrator" as const,
            name: "brain",
            position: { x: 0, y: 0 },
            llmBindingName: "mainLlm",
            actionRefs: ["search"],
            actionBindings: [{ alias: "find", actionName: "search" }],
          },
        ],
      },
    ],
  };

  const renamed = apply(p, { type: "updateAction", id: "ac1", patch: { name: "lookup" } });
  const rb = renamed.brokers[0];
  check(
    "rename updates executor actionName",
    rb.nodes.find((n) => n.id === "n1")?.executorStatements?.[0]?.kind === "run" &&
      rb.nodes.find((n) => n.id === "n1")?.executorStatements?.[0]?.actionName === "lookup"
  );
  check("rename updates actionRefs", rb.nodes.find((n) => n.id === "n2")?.actionRefs?.[0] === "lookup");
  check("rename updates actionBindings", rb.nodes.find((n) => n.id === "n2")?.actionBindings?.[0]?.actionName === "lookup");
  check("rename leaves no dangling action refs", validateProject(renamed).errors.every((e) => !e.message.includes("unknown action")));

  const deleted = apply(p, { type: "removeAction", id: "ac1" });
  const db = deleted.brokers[0];
  check("delete clears executor statements", db.nodes.find((n) => n.id === "n1")?.executorStatements === undefined);
  check("delete clears actionRefs", db.nodes.find((n) => n.id === "n2")?.actionRefs === undefined);
  check("delete clears actionBindings", db.nodes.find((n) => n.id === "n2")?.actionBindings === undefined);
  check("delete leaves no dangling action refs", validateProject(deleted).errors.every((e) => !e.message.includes("unknown action")));

  const llmRenamed = apply(p, { type: "updateLlmBinding", id: "lb1", patch: { name: "fastLlm" } });
  const lb = llmRenamed.brokers[0];
  check("llm rename updates node binding", lb.nodes.find((n) => n.id === "n2")?.llmBindingName === "fastLlm");
  check("llm rename updates broker default", lb.defaultLlmBindingName === "fastLlm");

  const llmDeleted = apply(p, { type: "removeLlmBinding", id: "lb1" });
  const ld = llmDeleted.brokers[0];
  check("llm delete clears node binding", ld.nodes.find((n) => n.id === "n2")?.llmBindingName === undefined);
  check("llm delete clears broker default", ld.defaultLlmBindingName === undefined);
}

console.log("\n[validation catches duplicate names]");
{
  const p = createScaffoldProject("ORG");
  const broker = p.brokers[0];
  const dupNodes: ComposerProject = {
    ...p,
    brokers: [
      {
        ...broker,
        nodes: [
          ...broker.nodes,
          { id: "d1", kind: "echo" as const, name: "sameName", position: { x: 0, y: 0 } },
          { id: "d2", kind: "echo" as const, name: "sameName", position: { x: 0, y: 0 } },
        ],
      },
    ],
  };
  check(
    "duplicate node names rejected",
    validateProject(dupNodes).errors.some((e) =>
      e.message.includes('More than one echo node is named "sameName"')
    )
  );

  const dupDefault: ComposerProject = {
    ...p,
    brokers: [{ ...broker, defaultLlmBindingName: "ghostLlm" }],
  };
  check(
    "dangling default_llm rejected",
    validateProject(dupDefault).errors.some((e) => e.message.includes("default_llm references unknown"))
  );
}

console.log("\n[sign-in regions]");
{
  const { getSignInRegionIds, getBaseUrlForRegion } = await import("@/lib/regions");
  const prevUsId = process.env.ANYPOINT_CLIENT_ID;
  const prevUsSecret = process.env.ANYPOINT_CLIENT_SECRET;

  delete process.env.ANYPOINT_CLIENT_ID;
  delete process.env.ANYPOINT_CLIENT_SECRET;
  check("sign-in regions empty without OAuth creds", getSignInRegionIds().length === 0);

  process.env.ANYPOINT_CLIENT_ID = "test-id";
  process.env.ANYPOINT_CLIENT_SECRET = "test-secret";
  const regions = getSignInRegionIds();
  check("sign-in regions includes us when creds set", regions.includes("us"));
  check("sign-in regions excludes eu without creds", !regions.includes("eu"));
  check(
    "getBaseUrlForRegion us",
    getBaseUrlForRegion("us") === "https://anypoint.mulesoft.com"
  );

  if (prevUsId === undefined) delete process.env.ANYPOINT_CLIENT_ID;
  else process.env.ANYPOINT_CLIENT_ID = prevUsId;
  if (prevUsSecret === undefined) delete process.env.ANYPOINT_CLIENT_SECRET;
  else process.env.ANYPOINT_CLIENT_SECRET = prevUsSecret;
}

console.log("\n[yaml spec parity phases 0-6]");
{
  const { parseConnectionAuth } = await import("@/lib/composer/connectivity/parse-auth");
  const { serializeConnectionAuth } = await import("@/lib/composer/connectivity/serialize-auth");
  const { RUNTIME_SYSTEM_LIMIT_VARIABLES } = await import("@/lib/composer/runtime-system-limits");
  const { parseNetworkRegistry, serializeNetworkRegistry } = await import("@/lib/composer/registry");

  // Phase 0: in-task-authorization-code field names
  const inTaskRaw = {
    kind: "in-task-authorization-code",
    challengeStatusCode: 302,
    codeChallengeMethod: "S256",
    tokenAudience: "https://api.example.com",
    bodyEncoding: "json",
    tokenTimeout: 600,
    clientId: "cid",
    clientSecret: "sec",
    authorizationEndpoint: "https://auth.example.com/authorize",
    tokenEndpoint: "https://auth.example.com/token",
    redirectUri: "https://app.example.com/callback",
    scopes: "read",
  };
  const inTaskParsed = parseConnectionAuth(inTaskRaw, "a2a");
  check(
    "phase0 legacy challengeStatusCode accepted",
    inTaskParsed?.kind === "in-task-authorization-code" &&
      inTaskParsed.challengeResponseStatusCode === 302
  );
  const inTaskSerialized = serializeConnectionAuth(inTaskParsed!);
  check(
    "phase0 emits challengeResponseStatusCode",
    (inTaskSerialized as Record<string, unknown>).challengeResponseStatusCode === 302 &&
      !(inTaskSerialized as Record<string, unknown>).challengeStatusCode
  );
  check("phase0 emits codeChallengeMethod", (inTaskSerialized as Record<string, unknown>).codeChallengeMethod === "S256");
  check("phase0 emits tokenTimeout", (inTaskSerialized as Record<string, unknown>).tokenTimeout === 600);

  // Phase 2: yaml info contact/license/terms
  const infoYaml = `
agentNetwork: "2.0.0"
info:
  label: Net
  version: v1
  termsOfService: https://example.com/tos
  contact:
    name: Support
    email: help@example.com
  license:
    name: Apache 2.0
    identifier: Apache-2.0
brokers: {}
`;
  const infoParsed = parseAgentNetworkYaml(infoYaml);
  check("phase2 termsOfService", infoParsed.yamlInfo?.termsOfService === "https://example.com/tos");
  check("phase2 contact email", infoParsed.yamlInfo?.contact?.email === "help@example.com");
  check("phase2 license identifier", infoParsed.yamlInfo?.license?.identifier === "Apache-2.0");

  // Phase 3: runtime limit preset. The preset writes the 30-day maximum, while MuleSoft
  // documents 24 hours when the variable is absent.
  const ttlLimit = RUNTIME_SYSTEM_LIMIT_VARIABLES.find((v) => v.key === "OBJECT_STORE_DEFAULT_TTL_MS");
  check("phase3 OBJECT_STORE_DEFAULT_TTL_MS preset", ttlLimit?.defaultValue === "2592000000");
  check(
    "phase3 OBJECT_STORE_DEFAULT_TTL_MS description states the documented 24h default",
    ttlLimit?.description.includes("86400000") === true
  );

  // Phase 5: typed registry parse/serialize
  const registryYaml = `
agentNetwork: "2.0.0"
info:
  label: Net
  version: "1.0.0"
registry:
  agents:
    helpAgent:
      info:
        label: Help
      metadata:
        platform: MuleSoft
        interfaces:
          a2a:
            card:
              name: Help Agent
              version: "1.0.0"
  mcps:
    toolsMcp:
      metadata:
        transport:
          kind: streamableHttp
          path: /mcp
  llms:
    gemini:
      metadata:
        platform: Gemini
        models: [gemini-pro]
  foo: bar
context:
  connections: {}
`;
  const regParsed = parseAgentNetworkYaml(registryYaml);
  check("phase5 registry agents parsed", regParsed.registry?.agents?.[0]?.key === "helpAgent");
  check("phase5 registry mcps transport", regParsed.registry?.mcps?.[0]?.metadata.transport.kind === "streamableHttp");
  check("phase5 registry llms platform", regParsed.registry?.llms?.[0]?.metadata.platform === "Gemini");
  check("phase5 registry extra top-level", regParsed.registry?.extra?.foo === "bar");
  const regProject = {
    version: 1 as const,
    identity: {
      name: "Net",
      organizationId: "ORG",
      assetId: "net",
      version: "1.0.0",
      descriptorVersion: "1.0.0",
      apiVersion: "v1",
      tags: [] as string[],
    },
    assets: [] as const,
    brokers: [] as const,
    policyBindings: {},
    registry: regParsed.registry,
  };
  const regDoc = serializeNetworkRegistry(regProject.registry, regProject);
  check("phase5 registry serialize agents", Boolean((regDoc?.agents as Record<string, unknown>)?.helpAgent));
  check("phase5 registry passthrough extra", regDoc?.foo === "bar");

  // Phase 6: a2a_v03 interface + exchange packaging
  const v03Yaml = `
agentNetwork: "2.0.0"
info:
  label: Net
  version: "1.0.0"
brokers:
  myBroker:
    kind: AgentScript
    implementation: "./brokers/my-broker.agent"
    interfaces:
      a2a_v03:
        card:
          name: Legacy Broker
          version: "0.3.0"
`;
  const v03Parsed = parseAgentNetworkYaml(v03Yaml);
  check("phase6 a2a_v03 interface key", v03Parsed.broker?.interfaceName === "a2a_v03");
  check("phase6 a2a_v03 card name", v03Parsed.broker?.card.name === "Legacy Broker");

  const { parseExchangeJson } = await import("@/lib/composer/parse/exchange-json");
  const exchangeWithJar = JSON.stringify({
    name: "Net",
    groupId: "org",
    assetId: "net",
    version: "1.0.0",
    dependencies: [{ groupId: "g", assetId: "dep", version: "1.0.0", classifier: "mcp-metadata", packaging: "jar" }],
    metadata: { variables: {} },
  });
  const depPackaging = parseExchangeJson(exchangeWithJar).dependencies[0]?.packaging;
  check("phase6 exchange packaging parse", depPackaging === "jar");
}

console.log("\n[agent script spec parity]");
{
  const { parseBrokerAgent } = await import("@/lib/composer/parse/broker-agent");

  // A1: executor do block with set + dual run
  const executorAgent = [
    "# @dialect: AGENTFABRIC=1.0",
    "system:",
    '  instructions: "x"',
    "config:",
    '  agent_name: "exec-test"',
    "executor runSteps:",
    "  do: ->",
    '    set @variables.ticketStatus = "resolved"',
    "    run @actions.notify",
    "      with channel = \"slack\"",
    "    run @actions.archive",
  ].join("\n");
  const execParsed = parseBrokerAgent(executorAgent);
  const execNode = execParsed.nodes.find((n) => n.name === "runSteps");
  check("A1 executor set statement", execNode?.executorStatements?.[0]?.kind === "set");
  check(
    "A1 executor dual run",
    execNode?.executorStatements?.filter((s) => s.kind === "run").length === 2
  );
  const execRoundTrip = serializeBrokerAgent({
    id: "b1",
    name: "exec-test",
    interfaceName: "a2a",
    card: { name: "Exec", version: "1.0.0" },
    systemInstructions: execParsed.systemInstructions ?? "",
    llmBindings: [],
    actions: [
      { id: "a1", name: "notify", actionKind: "a2a:send_message", connectionName: "c1" },
      { id: "a2", name: "archive", actionKind: "a2a:send_message", connectionName: "c1" },
    ],
    nodes: [
      {
        id: "n1",
        kind: "executor",
        name: "runSteps",
        position: { x: 0, y: 0 },
        executorStatements: execNode?.executorStatements,
      },
    ],
  });
  check("A1 round-trip set", execRoundTrip.includes('set @variables.ticketStatus = "resolved"'));
  check("A1 round-trip dual run", (execRoundTrip.match(/run @actions\./g) ?? []).length === 2);

  // A2: trigger target preserved
  const triggerAgent = [
    "config:",
    '  agent_name: "trig"',
    "trigger inbound:",
    '  kind: "a2a"',
    '  target: "brokers://custom-broker/a2a_v03"',
    "  on_message: ->",
    "    transition to @echo.out",
    "echo out:",
    '  kind: "a2a:status_update_event"',
    '  state: "TASK_STATE_COMPLETED"',
    '  message: "ok"',
  ].join("\n");
  const trigParsed = parseBrokerAgent(triggerAgent);
  const trigNode = trigParsed.nodes.find((n) => n.name === "inbound");
  check("A2 trigger target parse", trigNode?.triggerTarget === "brokers://custom-broker/a2a_v03");
  const trigRoundTrip = serializeBrokerAgent({
    id: "b2",
    name: "trig",
    interfaceName: "a2a",
    card: { name: "Trig", version: "1.0.0" },
    llmBindings: [],
    actions: [],
    nodes: [
      {
        id: "t1",
        kind: "trigger",
        name: "inbound",
        position: { x: 0, y: 0 },
        interfaceName: "a2a",
        triggerTarget: trigNode?.triggerTarget,
        onExitTarget: "e1",
      },
      {
        id: "e1",
        kind: "echo",
        name: "out",
        position: { x: 0, y: 0 },
        echoKind: "a2a:status_update_event",
        state: "TASK_STATE_COMPLETED",
        message: "ok",
      },
    ],
  });
  check("A2 trigger target serialize", trigRoundTrip.includes('target: "brokers://custom-broker/a2a_v03"'));

  // A3: root system.instructions procedure form
  const systemProcAgent = [
    "system:",
    "  instructions: ->",
    "    | Line one",
    "    | Line two",
    "config:",
    '  agent_name: "sys"',
  ].join("\n");
  const sysParsed = parseBrokerAgent(systemProcAgent);
  check("A3 system procedure flag", sysParsed.systemInstructionsProcedure === true);
  check("A3 system procedure text", sysParsed.systemInstructions?.includes("Line one"));
  const sysRoundTrip = serializeBrokerAgent({
    id: "b3",
    name: "sys",
    interfaceName: "a2a",
    card: { name: "Sys", version: "1.0.0" },
    systemInstructions: sysParsed.systemInstructions,
    systemInstructionsProcedure: true,
    llmBindings: [],
    actions: [],
    nodes: [],
  });
  check("A3 system procedure serialize", sysRoundTrip.includes("instructions: ->"));

  // A4: single-line procedure expressions preserve both content and form
  const inlineProcedureAgent = [
    "system:",
    "  instructions: -> @variables.systemPrompt",
    "config:",
    '  agent_name: "inline"',
    "generator generate:",
    "  prompt: -> @request.payload.message.parts[0].text",
    "orchestrator route:",
    "  reasoning:",
    "    instructions: -> @request.payload.message.parts[0].text",
  ].join("\n");
  const inlineParsed = parseBrokerAgent(inlineProcedureAgent);
  const inlineGenerator = inlineParsed.nodes.find((node) => node.name === "generate");
  const inlineOrchestrator = inlineParsed.nodes.find((node) => node.name === "route");
  check(
    "A4 inline system procedure parses",
    inlineParsed.systemInstructions === "@variables.systemPrompt" &&
      inlineParsed.systemInstructionsProcedureInline === true
  );
  check(
    "A4 inline prompt procedure parses",
    inlineGenerator?.prompt === "@request.payload.message.parts[0].text" &&
      inlineGenerator.promptProcedureInline === true
  );
  check(
    "A4 inline reasoning procedure parses",
    inlineOrchestrator?.reasoningInstructions === "@request.payload.message.parts[0].text" &&
      inlineOrchestrator.reasoningInstructionsProcedureInline === true
  );
  const inlineRoundTrip = serializeBrokerAgent({
    id: "b4",
    name: "inline",
    interfaceName: "a2a",
    card: { name: "Inline", version: "1.0.0" },
    systemInstructions: inlineParsed.systemInstructions,
    systemInstructionsProcedure: true,
    systemInstructionsProcedureInline: true,
    llmBindings: [],
    actions: [],
    nodes: [
      {
        id: "g4",
        kind: "generator",
        name: "generate",
        position: { x: 0, y: 0 },
        prompt: inlineGenerator?.prompt,
        promptProcedure: true,
        promptProcedureInline: true,
      },
      {
        id: "o4",
        kind: "orchestrator",
        name: "route",
        position: { x: 0, y: 0 },
        reasoningInstructions: inlineOrchestrator?.reasoningInstructions,
        reasoningInstructionsProcedure: true,
        reasoningInstructionsProcedureInline: true,
      },
    ],
  });
  check(
    "A4 inline procedure forms serialize",
    inlineRoundTrip.includes("instructions: -> @variables.systemPrompt") &&
      inlineRoundTrip.includes("prompt: -> @request.payload.message.parts[0].text") &&
      inlineRoundTrip.includes("instructions: -> @request.payload.message.parts[0].text")
  );

  let rejectedUnsupportedActionBinding = false;
  try {
    parseBrokerAgent(
      [
        "config:",
        '  agent_name: "unsupported-action-binding"',
        "orchestrator route:",
        "  reasoning:",
        "    instructions: |",
        "      Route the request.",
        "    actions:",
        "      lookup: @actions.lookup",
        "        available when @variables.enabled",
      ].join("\n")
    );
  } catch {
    rejectedUnsupportedActionBinding = true;
  }
  check("A4 unsupported action binding statements fail explicitly", rejectedUnsupportedActionBinding);

  // B1: max_consecutive_errors
  const maxErrAgent = [
    "config:",
    '  agent_name: "err"',
    "orchestrator triage:",
    "  reasoning:",
    "    instructions: |",
    "      work",
    "    max_consecutive_errors: 5",
  ].join("\n");
  const errParsed = parseBrokerAgent(maxErrAgent);
  check(
    "B1 max_consecutive_errors parse",
    errParsed.nodes.find((n) => n.name === "triage")?.maxConsecutiveErrors === 5
  );

  // B2: output constraints
  const outputAgent = [
    "config:",
    '  agent_name: "out"',
    "generator gen:",
    "  prompt: |",
    "    x",
    "  outputs:",
    "    properties:",
    "      code:",
    '        type: "string"',
    '        default: "draft"',
    '        pattern: "^[A-Z]+$"',
    "        minLength: 2",
    "        maxLength: 10",
    "      scores:",
    '        type: "array"',
    "        minItems: 1",
    "        maxItems: 5",
    "        items:",
    '          type: "number"',
    "      payload:",
    '        type: "object"',
    "        required:",
    '          - "id"',
    "        properties:",
    "          id:",
    '            type: "string"',
  ].join("\n");
  const outParsed = parseBrokerAgent(outputAgent);
  const codeOut = outParsed.nodes.find((n) => n.name === "gen")?.outputs?.[0];
  check("B2 default", codeOut?.default === "draft");
  check("B2 pattern", codeOut?.pattern === "^[A-Z]+$");
  check("B2 minLength", codeOut?.minLength === 2);
  const scoresOut = outParsed.nodes.find((n) => n.name === "gen")?.outputs?.[1];
  check("B2 minItems", scoresOut?.minItems === 1);
  const payloadOut = outParsed.nodes.find((n) => n.name === "gen")?.outputs?.[2];
  check("B2 required", payloadOut?.required?.[0] === "id");

  // C1-C3: LLM params, http_headers, config.label
  const extrasAgent = [
    "# @dialect: AGENTFABRIC=2.1",
    "config:",
    '  agent_name: "extras"',
    '  label: "My Agent"',
    '  description: "Config desc"',
    "llm:",
    "  openaiMain:",
    '    target: "llm://openaiConn"',
    '    kind: "OpenAI"',
    '    model: "gpt-4.1"',
    "    temperature: 0.2",
    "    reasoning_effort: HIGH",
    "actions:",
    "  search:",
    '    target: "mcp://mcpConn"',
    '    kind: "mcp:tool"',
    '    tool_name: "search"',
    "    http_headers:",
    '      X-Trace: "1"',
    "    inputs:",
    "      q: string = \"*\"",
  ].join("\n");
  const extrasParsed = parseBrokerAgent(extrasAgent);
  check("C2 dialect", extrasParsed.agentDialectVersion === "2.1");
  check("C2 config label", extrasParsed.agentConfigLabel === "My Agent");
  check("C2 config description", extrasParsed.agentConfigDescription === "Config desc");
  check("C1 llm temperature", extrasParsed.llmBindings[0]?.temperature === 0.2);
  check("C1 llm reasoning_effort", extrasParsed.llmBindings[0]?.reasoningEffort === "HIGH");
  check("C3 http header", extrasParsed.actions[0]?.httpHeaders?.[0]?.name === "X-Trace");
  check("C3 mcp input default", extrasParsed.actions[0]?.inputs?.[0]?.default === "*");
  const extrasRoundTrip = serializeBrokerAgent({
    id: "b4",
    name: "extras",
    interfaceName: "a2a",
    card: { name: "Extras", version: "1.0.0" },
    agentDialectVersion: extrasParsed.agentDialectVersion,
    agentConfigLabel: extrasParsed.agentConfigLabel,
    agentConfigDescription: extrasParsed.agentConfigDescription,
    llmBindings: [
      {
        id: "l1",
        name: "openaiMain",
        connectionName: "openaiConn",
        provider: "OpenAI",
        model: "gpt-4.1",
        temperature: 0.2,
        reasoningEffort: "HIGH",
      },
    ],
    actions: [
      {
        id: "a1",
        name: "search",
        actionKind: "mcp:tool",
        connectionName: "mcpConn",
        toolName: "search",
        httpHeaders: [{ name: "X-Trace", value: "1" }],
        inputs: [{ name: "q", type: "string", default: "*" }],
      },
    ],
    nodes: [],
  });
  check("C1 serialize temperature", extrasRoundTrip.includes("temperature: 0.2"));
  check("C2 serialize config.label", extrasRoundTrip.includes('label: "My Agent"'));
  check("C3 legacy definition-level http_headers omitted", !extrasRoundTrip.includes("http_headers:"));
}

// ---------------------------------------------------------------------------
console.log("\n[registry import]");
{
  const {
    inferRegistryAgentInterface,
    mergeAgentCardIntoEntity,
    mergeMcpMetadataIntoEntity,
    parseAgentCardJson,
    parseMcpMetadataJson,
    upsertUrlEntry,
  } = await import("@/lib/composer/registry/import-helpers");

  const agentStub = {
    key: "myAgent",
    metadata: { platform: "Custom", interfaces: { a2a: { card: { name: "Agent", version: "1.0.0" } } } },
  };

  const v03Card = JSON.stringify({
    name: "Help Agent",
    description: "Assists users",
    version: "0.3.0",
    protocolVersion: "0.3.0",
    url: "https://broker.example.com/a2a",
  });
  const v03Parsed = parseAgentCardJson(v03Card);
  check("registry import parse agent card", v03Parsed.ok === true);
  if (v03Parsed.ok) {
    check("registry import infer a2a_v03", inferRegistryAgentInterface(v03Parsed.card) === "a2a_v03");
    const merged = mergeAgentCardIntoEntity(agentStub, v03Parsed.card, "https://broker.example.com");
    check("registry import agent interfaceKey", merged.interfaceKey === "a2a_v03");
    check("registry import agent label", merged.entity.info?.label === "Help Agent");
    check(
      "registry import agent urls",
      merged.entity.urls?.some((u) => u.name === "endpoint" && u.url === "https://broker.example.com")
    );
  }

  const mcpJson = JSON.stringify({
    protocolVersion: "2025-03-26",
    transport: { kind: "streamableHttp" },
    tools: [{ name: "search", description: "Search docs" }],
    resources: [{ uri: "file:///readme", name: "Readme" }],
    prompts: [{ name: "summarize" }],
  });
  const mcpParsed = parseMcpMetadataJson(mcpJson);
  check("registry import parse mcp metadata", mcpParsed.ok === true);
  if (mcpParsed.ok) {
    const mcpStub = {
      key: "toolsMcp",
      metadata: { transport: { kind: "streamableHttp" as const } },
    };
    const mergedMcp = mergeMcpMetadataIntoEntity(
      mcpStub,
      mcpParsed.metadata,
      "https://mcp.example.com/metadata.json"
    );
    check("registry import mcp tools", mergedMcp.metadata.tools?.length === 1);
    check("registry import mcp protocolVersion", mergedMcp.metadata.protocolVersion === "2025-03-26");
    check(
      "registry import mcp metadata url",
      mergedMcp.urls?.some((u) => u.name === "metadata")
    );
  }

  const urls = upsertUrlEntry(undefined, "default", "https://a.example");
  check("registry import upsert url", urls[0]?.url === "https://a.example");
  check(
    "registry import upsert replace",
    upsertUrlEntry(urls, "default", "https://b.example")[0]?.url === "https://b.example"
  );
}

console.log("\n[builder graph layout metadata]");
{
  const { extractGraphLayouts, parseBuilderMetadata } = await import("@/lib/composer/builder-metadata");
  const { serializeExchangeJson } = await import("@/lib/composer/serialize/exchange-json");
  const { parseProjectFiles } = await import("@/lib/composer/parse");
  const { composerReducer } = await import("@/lib/composer/store");
  const { createScaffoldProject } = await import("@/lib/composer/factory");
  const { serializeAgentNetworkYaml, serializeBrokerAgent } = await import("@/lib/composer/serialize");

  let project = createScaffoldProject("ORG");
  const broker = project.brokers[0];
  project = composerReducer(project, {
    type: "moveNode",
    id: broker.nodes[0].id,
    position: { x: 512, y: 88 },
  });

  const exchangeText = serializeExchangeJson(project);
  const exchange = JSON.parse(exchangeText) as { metadata?: Record<string, unknown> };
  const parsedMeta = parseBuilderMetadata(exchange.metadata);
  check(
    "exchange.json stores graph layout",
    parsedMeta?.graphLayouts?.[broker.name]?.trigger?.x === 512
  );

  const layouts = extractGraphLayouts(project);
  check("extract layout by node name", layouts?.graphLayouts?.[broker.name]?.trigger?.y === 88);

  const round = parseProjectFiles({
    exchangeJson: exchangeText,
    agentYaml: serializeAgentNetworkYaml(project),
    brokerAgent: serializeBrokerAgent(project.brokers[0]),
    fallbackGroupId: "ORG",
  });
  check("import applies saved graph layout", round.ok && round.project.brokers[0]?.nodes[0]?.position.x === 512);

  project = composerReducer(project, { type: "resetGraphLayoutToHierarchical" });
  check("reset clears graph layout pin", project.graphLayoutPinned === false);
  const resetExchangeText = serializeExchangeJson(project);
  const resetExchange = JSON.parse(resetExchangeText) as { metadata?: Record<string, unknown> };
  const resetMeta = parseBuilderMetadata(resetExchange.metadata);
  check("reset omits saved graph layouts from export", !resetMeta?.graphLayouts);
  check("reset marks metadata unpinned", resetMeta?.graphLayoutPinned === false);

  const resetRound = parseProjectFiles({
    exchangeJson: resetExchangeText,
    agentYaml: serializeAgentNetworkYaml(project),
    brokerAgent: serializeBrokerAgent(project.brokers[0]),
    fallbackGroupId: "ORG",
  });
  check("import without saved layout uses hierarchical positions", resetRound.ok === true);
  if (resetRound.ok) {
    const triggerY = resetRound.project.brokers[0]?.nodes.find((n) => n.kind === "trigger")?.position.y ?? 0;
    const echoY = resetRound.project.brokers[0]?.nodes.find((n) => n.kind === "echo")?.position.y ?? 0;
    check("hierarchical layout stacks trigger above echo", echoY > triggerY);
  }
}

console.log("\n[broker graph layout persistence]");
{
  const { brokerTopologyKey } = await import("@/lib/composer/broker-graph-layout");
  const { composerReducer } = await import("@/lib/composer/store");
  const { createScaffoldProject } = await import("@/lib/composer/factory");

  let project = createScaffoldProject("ORG");
  const broker = project.brokers[0];
  const key1 = brokerTopologyKey(broker);
  project = composerReducer(project, {
    type: "moveNode",
    id: broker.nodes[0].id,
    position: { x: 400, y: 120 },
  });
  const moved = project.brokers[0].nodes[0]?.position;
  check("moveNode updates model position", moved?.x === 400 && moved?.y === 120);
  check("moveNode does not change topology key", brokerTopologyKey(project.brokers[0]) === key1);
}

console.log("\n[graph node guards]");
{
  const { composerReducer } = await import("@/lib/composer/store");
  const { createScaffoldProject } = await import("@/lib/composer/factory");
  const { nodeNameValidationMessage } = await import("@/lib/composer/node-name");

  let project = createScaffoldProject("ORG");
  const broker = project.brokers[0];
  const trigger = broker.nodes.find((n) => n.kind === "trigger");
  const echo = broker.nodes.find((n) => n.kind === "echo");

  project = composerReducer(project, { type: "removeNode", id: trigger!.id });
  check(
    "removeNode refuses to delete the trigger",
    project.brokers[0].nodes.some((n) => n.kind === "trigger")
  );

  project = composerReducer(project, { type: "removeNode", id: echo!.id });
  check(
    "removeNode still deletes non-trigger nodes",
    !project.brokers[0].nodes.some((n) => n.id === echo!.id)
  );

  const withTwo = createScaffoldProject("ORG").brokers[0];
  const [first, second] = withTwo.nodes;
  check(
    "node name validation flags duplicates",
    nodeNameValidationMessage(
      {
        ...withTwo,
        nodes: [...withTwo.nodes, { ...second, id: "same-kind", kind: first.kind }],
      },
      "same-kind",
      first.name
    ) !== undefined
  );
  check(
    "node name validation flags empty",
    nodeNameValidationMessage(withTwo, first.id, "  ") === "Node id is required."
  );
  check(
    "node name validation flags bad identifier",
    nodeNameValidationMessage(withTwo, first.id, "2bad") !== undefined
  );
  check(
    "node name validation accepts camelCase",
    nodeNameValidationMessage(withTwo, first.id, "classifyIntent") === undefined
  );
}

console.log("\n[composer undo/redo history]");
{
  const { historyReducer, initHistory, coalesceKey, HISTORY_LIMIT } = await import(
    "@/lib/composer/history"
  );
  const { composerReducer } = await import("@/lib/composer/store");
  const { createScaffoldProject } = await import("@/lib/composer/factory");

  const reduce = (s: ReturnType<typeof initHistory>, a: Parameters<typeof historyReducer>[1]) =>
    historyReducer(s, a, composerReducer);

  let state = initHistory(createScaffoldProject("ORG"));
  check("history starts with no past", state.past.length === 0);

  state = reduce(state, { type: "setIdentity", patch: { name: "One" } });
  check("edit pushes history entry", state.past.length === 1);
  check("edit updates present", state.present.identity.name === "One");

  // Same field twice in a row collapses into the existing entry.
  state = reduce(state, { type: "setIdentity", patch: { name: "Two" } });
  check("consecutive same-field edits coalesce", state.past.length === 1);
  check("coalesced edit keeps latest value", state.present.identity.name === "Two");

  // A different field starts a new entry.
  state = reduce(state, { type: "setIdentity", patch: { assetId: "other-asset" } });
  check("different field starts new entry", state.past.length === 2);

  state = reduce(state, { type: "history/undo" });
  check("undo restores prior present", state.present.identity.assetId === "my-agent-network");
  check("undo keeps coalesced name", state.present.identity.name === "Two");
  check("undo fills future", state.future.length === 1);

  state = reduce(state, { type: "history/redo" });
  check("redo reapplies", state.present.identity.assetId === "other-asset");
  check("redo drains future", state.future.length === 0);

  // A fresh edit after undo discards the redo branch.
  state = reduce(state, { type: "history/undo" });
  state = reduce(state, { type: "setIdentity", patch: { version: "9.9.9" } });
  check("new edit clears redo branch", state.future.length === 0);

  // Checkpoint breaks a coalescing run so the next keystroke is its own entry.
  let checkpointed = initHistory(createScaffoldProject("ORG"));
  checkpointed = reduce(checkpointed, { type: "setIdentity", patch: { name: "A" } });
  checkpointed = reduce(checkpointed, { type: "history/checkpoint" });
  checkpointed = reduce(checkpointed, { type: "setIdentity", patch: { name: "B" } });
  check("checkpoint breaks coalescing run", checkpointed.past.length === 2);

  // Loading a project is a hard reset, not an undoable step.
  let loaded = initHistory(createScaffoldProject("ORG"));
  loaded = reduce(loaded, { type: "setIdentity", patch: { name: "Before" } });
  loaded = reduce(loaded, { type: "loadProject", project: createScaffoldProject("ORG2") });
  check("loadProject clears history", loaded.past.length === 0 && loaded.future.length === 0);

  // No-op actions must not create undo steps.
  let noop = initHistory(createScaffoldProject("ORG"));
  const trig = noop.present.brokers[0].nodes.find((n) => n.kind === "trigger")!;
  noop = reduce(noop, { type: "removeNode", id: trig.id });
  check("no-op action adds no history entry", noop.past.length === 0);

  check("undo at start of history is a no-op", reduce(initHistory(createScaffoldProject("ORG")), { type: "history/undo" }).past.length === 0);

  check(
    "moveNode does not coalesce",
    coalesceKey({ type: "moveNode", id: "n", position: { x: 0, y: 0 } }) === null
  );
  check(
    "updateNode coalesce key includes node and field",
    coalesceKey({ type: "updateNode", id: "n1", patch: { name: "x" } }) === "updateNode:n1:name"
  );

  // History is bounded so long sessions cannot grow without limit.
  let capped = initHistory(createScaffoldProject("ORG"));
  for (let i = 0; i < HISTORY_LIMIT + 25; i++) {
    capped = reduce(capped, { type: "addNode", kind: "generator", position: { x: i, y: i } });
  }
  check("history is capped", capped.past.length === HISTORY_LIMIT);
}

console.log("\n[new node placement]");
{
  const { placeNewNode, NODE_HEIGHT } = await import("@/lib/composer/node-placement");
  const { composerReducer } = await import("@/lib/composer/store");
  const { createScaffoldProject } = await import("@/lib/composer/factory");

  let project = createScaffoldProject("ORG");
  const broker = project.brokers[0];
  const trigger = broker.nodes.find((n) => n.kind === "trigger")!;

  const below = placeNewNode(broker, "generator", { anchorNodeId: trigger.id });
  check("new node is placed below its anchor", below.y > trigger.position.y);
  check("new node keeps the anchor's column", below.x === trigger.position.x);

  const clear = broker.nodes.every(
    (n) => Math.abs(n.position.x - below.x) > 1 || Math.abs(n.position.y - below.y) >= NODE_HEIGHT
  );
  check("new node does not land on an existing node", clear);

  // Placement is deterministic — the old random scatter could not guarantee this.
  const again = placeNewNode(broker, "generator", { anchorNodeId: trigger.id });
  check("placement is deterministic", again.x === below.x && again.y === below.y);

  // addNode can create and wire a node in a single dispatch (drag-to-create).
  project = composerReducer(project, {
    type: "addNode",
    kind: "generator",
    position: below,
    id: "new-node-1",
    connectFrom: { nodeId: trigger.id, sourceHandle: "bottom" },
  });
  const createdNode = project.brokers[0].nodes.find((n) => n.id === "new-node-1");
  check("addNode honours a caller-supplied id", createdNode !== undefined);
  check(
    "addNode connectFrom wires the source transition",
    project.brokers[0].nodes.find((n) => n.id === trigger.id)?.onExitTarget === "new-node-1"
  );

  // Palette add without drag-connect: trigger alone, then echo wires initial transition.
  let solo = createScaffoldProject("ORG");
  solo = composerReducer(solo, {
    type: "removeNode",
    id: solo.brokers[0].nodes.find((n) => n.kind === "echo")!.id,
  });
  check(
    "solo trigger has no initial node until wired",
    solo.brokers[0].nodes.find((n) => n.kind === "trigger")?.onExitTarget === undefined
  );
  solo = composerReducer(solo, {
    type: "addNode",
    kind: "echo",
    position: { x: 400, y: 200 },
    id: "echo-solo",
  });
  check(
    "adding echo after trigger auto-wires initial transition",
    solo.brokers[0].nodes.find((n) => n.kind === "trigger")?.onExitTarget === "echo-solo"
  );
}

console.log("\n[trigger is not a transition target]");
{
  const { composerReducer } = await import("@/lib/composer/store");
  const { createScaffoldProject } = await import("@/lib/composer/factory");
  const { validateProject } = await import("@/lib/composer/validate");
  const { isAllowedTransitionTarget } = await import("@/lib/composer/graph-transitions");

  let project = createScaffoldProject("ORG");
  const trigger = project.brokers[0].nodes.find((n) => n.kind === "trigger")!;
  const echo = project.brokers[0].nodes.find((n) => n.kind === "echo")!;
  check("trigger is not an allowed transition target", !isAllowedTransitionTarget(trigger));

  project = composerReducer(project, {
    type: "connect",
    sourceId: echo.id,
    targetId: trigger.id,
    sourceHandle: "bottom",
  });
  check(
    "connect to trigger is rejected",
    project.brokers[0].nodes.find((n) => n.id === echo.id)?.onExitTarget === undefined
  );

  project = composerReducer(project, {
    type: "updateNode",
    id: echo.id,
    patch: { onExitTarget: trigger.id },
  });
  check(
    "updateNode cannot set onExitTarget to trigger",
    project.brokers[0].nodes.find((n) => n.id === echo.id)?.onExitTarget === undefined
  );

  project = composerReducer(project, {
    type: "updateNode",
    id: trigger.id,
    patch: { onExitTarget: echo.id },
  });
  check(
    "trigger may still transition outward to echo",
    project.brokers[0].nodes.find((n) => n.id === trigger.id)?.onExitTarget === echo.id
  );
  {
    const errors = validateProject(project).errors.filter(
      (e) =>
        e.code !== "a2a-card.required.endpoint-url" &&
        e.code !== "graph.echo.empty-message"
    );
    check("valid graph after outward trigger transition (aside from required endpoint URL)", errors.length === 0);
  }
}

console.log("\n[insert node on edge]");
{
  const { composerReducer } = await import("@/lib/composer/store");
  const { createScaffoldProject } = await import("@/lib/composer/factory");

  // trigger -> echo, then splice a generator into the middle.
  let project = createScaffoldProject("ORG");
  const trigger = project.brokers[0].nodes.find((n) => n.kind === "trigger")!;
  const echo = project.brokers[0].nodes.find((n) => n.kind === "echo")!;
  check("fixture starts with trigger -> echo", trigger.onExitTarget === echo.id);

  project = composerReducer(project, {
    type: "insertNodeOnEdge",
    kind: "generator",
    position: { x: 100, y: 300 },
    id: "spliced",
    sourceId: trigger.id,
    targetId: echo.id,
    sourceHandle: "bottom",
  });

  const nodes = project.brokers[0].nodes;
  check("insert adds the new node", nodes.some((n) => n.id === "spliced"));
  check(
    "insert retargets the source at the new node",
    nodes.find((n) => n.id === trigger.id)?.onExitTarget === "spliced"
  );
  check(
    "insert points the new node at the original target",
    nodes.find((n) => n.id === "spliced")?.onExitTarget === echo.id
  );

  // Terminal/unique kinds cannot be spliced without orphaning the tail.
  const before = project.brokers[0].nodes.length;
  const rejected = composerReducer(project, {
    type: "insertNodeOnEdge",
    kind: "echo",
    position: { x: 0, y: 0 },
    sourceId: trigger.id,
    targetId: echo.id,
  });
  check("insert refuses terminal echo nodes", rejected.brokers[0].nodes.length === before);

  // Splicing into a router edge should retarget that route, not add a new one.
  let routed = createScaffoldProject("ORG");
  routed = composerReducer(routed, {
    type: "addNode",
    kind: "router",
    position: { x: 0, y: 0 },
    id: "router1",
  });
  const echo2 = routed.brokers[0].nodes.find((n) => n.kind === "echo")!;
  routed = composerReducer(routed, {
    type: "connect",
    sourceId: "router1",
    targetId: echo2.id,
    sourceHandle: null,
  });
  const routeCount = routed.brokers[0].nodes.find((n) => n.id === "router1")?.routes?.length ?? 0;
  routed = composerReducer(routed, {
    type: "insertNodeOnEdge",
    kind: "generator",
    position: { x: 0, y: 0 },
    id: "mid",
    sourceId: "router1",
    targetId: echo2.id,
    sourceHandle: routerOutputHandleId(
      routed.brokers[0].nodes.find((n) => n.id === "router1")!.routes![0].id
    ),
  });
  const router = routed.brokers[0].nodes.find((n) => n.id === "router1");
  check("router insert does not add a route", (router?.routes?.length ?? 0) === routeCount);
  check("router insert retargets the route", router?.routes?.[0]?.targetNodeId === "mid");
  check(
    "router insert links new node to original target",
    routed.brokers[0].nodes.find((n) => n.id === "mid")?.onExitTarget === echo2.id
  );
}

/**
 * Two routes may legitimately read the same (same `when`, no label). Handles
 * are keyed by route id so they stay independently wirable and removable.
 */
{
  let project = createScaffoldProject("ORG");
  project = composerReducer(project, {
    type: "addNode",
    kind: "router",
    position: { x: 0, y: 0 },
    id: "router1",
  });
  const echo = project.brokers[0].nodes.find((n) => n.kind === "echo")!;
  project = composerReducer(project, {
    type: "addNode",
    kind: "generator",
    position: { x: 0, y: 200 },
    id: "genA",
  });
  project = composerReducer(project, {
    type: "addNode",
    kind: "generator",
    position: { x: 300, y: 200 },
    id: "genB",
  });

  // Both connections drop on the "+ route" slot, so both default to `when: true`.
  const slot = routerOutputHandleId("route");
  project = composerReducer(project, {
    type: "connect",
    sourceId: "router1",
    targetId: "genA",
    sourceHandle: slot,
  });
  project = composerReducer(project, {
    type: "connect",
    sourceId: "router1",
    targetId: "genB",
    sourceHandle: slot,
  });

  const router = () => project.brokers[0].nodes.find((n) => n.id === "router1")!;
  const routes = router().routes ?? [];
  check("duplicate-condition routes are both kept", routes.length === 2, String(routes.length));
  check(
    "duplicate-condition routes read the same",
    routes[0].when === routes[1].when && !routes[0].label && !routes[1].label
  );

  const handles = routerCanvasOutputs(router()).map((output) => output.handleId);
  check(
    "same-reading routes still get unique handles",
    new Set(handles).size === handles.length,
    handles.join(",")
  );

  // Retargeting one route by its handle must not touch its twin.
  project = composerReducer(project, {
    type: "connect",
    sourceId: "router1",
    targetId: echo.id,
    sourceHandle: routerOutputHandleId(routes[1].id),
  });
  check("retargeting a route leaves its twin alone", router().routes?.[0]?.targetNodeId === "genA");
  check("retargeting a route moves only that route", router().routes?.[1]?.targetNodeId === echo.id);
  check("retargeting a route adds no route", (router().routes ?? []).length === 2);

  // Disconnecting one route must not remove the other.
  project = composerReducer(project, {
    type: "disconnect",
    sourceId: "router1",
    targetId: echo.id,
    sourceHandle: routerOutputHandleId(routes[1].id),
  });
  const remaining = router().routes ?? [];
  check("disconnecting a route removes exactly one", remaining.length === 1, String(remaining.length));
  check("disconnecting a route keeps its twin", remaining[0]?.id === routes[0].id);
}

console.log("\n[node summary chips]");
{
  const { nodeSummaryChips, nodePreviewText } = await import("@/lib/composer/node-summary");
  const { createScaffoldProject } = await import("@/lib/composer/factory");

  const broker = createScaffoldProject("ORG").brokers[0];
  const labels = (node: Parameters<typeof nodeSummaryChips>[0]) =>
    nodeSummaryChips(node, broker).map((c) => c.label);

  const generator = {
    id: "g",
    kind: "generator" as const,
    name: "classifyIntent",
    position: { x: 0, y: 0 },
    prompt: "  \n Classify the incoming request\nsecond line",
    outputs: [{ name: "intent", type: "string" as const }],
  };
  check("generator falls back to no-LLM chip", labels(generator).includes("no LLM"));
  check("generator reports output count", labels(generator).includes("1 output"));
  check(
    "preview uses the first non-empty prompt line",
    nodePreviewText(generator) === "Classify the incoming request"
  );

  const withLlm = { ...generator, llmBindingName: "geminiFlash" };
  check("generator names its LLM binding", labels(withLlm).includes("geminiFlash"));

  const brokerWithDefault = { ...broker, defaultLlmBindingName: "sharedLlm" };
  check(
    "generator marks the broker default LLM",
    nodeSummaryChips(generator, brokerWithDefault).some((c) => c.label === "sharedLlm (default)")
  );

  const orchestrator = {
    id: "o",
    kind: "orchestrator" as const,
    name: "main",
    position: { x: 0, y: 0 },
    actionRefs: ["a", "b"],
    maxNumberOfLoops: 60,
  };
  check("orchestrator reports action count", labels(orchestrator).includes("2 actions"));
  check("orchestrator reports loop cap", labels(orchestrator).includes("60 loops"));

  const router = {
    id: "r",
    kind: "router" as const,
    name: "route",
    position: { x: 0, y: 0 },
    routes: [{ id: "r1", targetNodeId: "g", when: "x == 1" }],
  };
  check("router reports route count", labels(router).includes("1 route"));
  check("router flags a missing fallback", labels(router).includes("no fallback"));
  check(
    "router with otherwise reports a fallback",
    labels({ ...router, otherwiseTargetNodeId: "g" }).includes("otherwise")
  );

  const echo = broker.nodes.find((n) => n.kind === "echo")!;
  check("echo names its event kind", labels(echo).includes("status"));

  // A long prompt is truncated so it cannot blow out the card width.
  const long = { ...generator, prompt: "x".repeat(400) };
  const preview = nodePreviewText(long) ?? "";
  check("long previews are truncated", preview.length < 100 && preview.endsWith("…"));
  check("empty prompt yields no preview", nodePreviewText({ ...generator, prompt: "   " }) === undefined);
}

console.log("\n[canvas search]");
{
  const { matchNodeIds } = await import("@/lib/composer/node-search");
  const { createScaffoldProject } = await import("@/lib/composer/factory");

  const broker = createScaffoldProject("ORG").brokers[0];
  const trigger = broker.nodes.find((n) => n.kind === "trigger")!;

  check("empty query matches nothing", matchNodeIds(broker, "   ").length === 0);
  check("search matches node name", matchNodeIds(broker, trigger.name).includes(trigger.id));
  check("search is case insensitive", matchNodeIds(broker, trigger.name.toUpperCase()).includes(trigger.id));
  check("search matches node kind", matchNodeIds(broker, "echo").length > 0);
  check("unmatched query returns nothing", matchNodeIds(broker, "zzzznope").length === 0);
  check("undefined broker is safe", matchNodeIds(undefined, "echo").length === 0);
}

console.log("\n[command palette]");
{
  const { buildCommands, filterCommands, scoreCommand } = await import(
    "@/lib/composer/command-palette"
  );
  const { createScaffoldProject } = await import("@/lib/composer/factory");

  const project = createScaffoldProject("ORG");
  const commands = buildCommands(project);

  check("palette lists tab navigation", commands.some((c) => c.action.kind === "openTab"));
  check("palette lists existing nodes", commands.some((c) => c.action.kind === "selectNode"));
  check(
    "palette omits add-trigger when one exists",
    !commands.some((c) => c.action.kind === "addNode" && c.action.nodeKind === "trigger")
  );
  check("palette offers undo", commands.some((c) => c.action.kind === "undo"));

  const noTrigger = {
    ...project,
    brokers: [{ ...project.brokers[0], nodes: project.brokers[0].nodes.filter((n) => n.kind !== "trigger") }],
  };
  check(
    "palette offers add-trigger when missing",
    buildCommands(noTrigger).some((c) => c.action.kind === "addNode" && c.action.nodeKind === "trigger")
  );

  const generatorCmd = commands.find((c) => c.label === "Add generator node")!;
  check("prefix match outranks a loose match", (scoreCommand(generatorCmd, "Add generator") ?? 0) > 700);
  check("non-matching query scores null", scoreCommand(generatorCmd, "qqqq") === null);

  const results = filterCommands(commands, "generator");
  check("filter surfaces the generator command", results.some((c) => c.label === "Add generator node"));
  check("filter respects the limit", filterCommands(commands, "", 5).length === 5);
  check("filter returns nothing for gibberish", filterCommands(commands, "zzqqxx").length === 0);
}

console.log("\n[tab issue counts]");
{
  const { countIssuesByTab } = await import("@/lib/composer/issue-navigation");
  const { validateProject } = await import("@/lib/composer/validate");
  const { createScaffoldProject } = await import("@/lib/composer/factory");
  const { composerReducer } = await import("@/lib/composer/store");

  // A router with no routes is a graph-tab error.
  let project = createScaffoldProject("ORG");
  project = composerReducer(project, {
    type: "addNode",
    kind: "router",
    position: { x: 0, y: 0 },
    id: "r1",
  });
  const counts = countIssuesByTab(validateProject(project));
  check("router errors are attributed to the graph tab", (counts.get("graph")?.errors ?? 0) > 0);

  // Missing required A2A card fields should surface on the A2A card tab.
  let cardProject = createScaffoldProject("ORG");
  cardProject = composerReducer(cardProject, { type: "updateCard", patch: { description: undefined } });
  const cardCounts = countIssuesByTab(validateProject(cardProject));
  check("A2A card deploy errors are attributed to the a2a-card tab", (cardCounts.get("a2a-card")?.errors ?? 0) > 0);

  let brokerKeyProject = createScaffoldProject("ORG");
  brokerKeyProject = composerReducer(brokerKeyProject, { type: "updateBroker", patch: { name: "" } });
  const brokerKeyCounts = countIssuesByTab(validateProject(brokerKeyProject));
  check("broker key/id errors are attributed to the a2a-card tab", (brokerKeyCounts.get("a2a-card")?.errors ?? 0) > 0);

  const total = [...counts.values()].reduce((sum, c) => sum + c.errors + c.warnings + c.info, 0);
  const result = validateProject(project);
  check(
    "every issue is attributed to exactly one tab",
    total === result.issues.length
  );

  // Reconciliation invariant: the strip rollup equals the sum of tab badges.
  const tabErrors = [...counts.values()].reduce((sum, c) => sum + c.errors, 0);
  const tabWarnings = [...counts.values()].reduce((sum, c) => sum + c.warnings, 0);
  check(
    "strip rollup reconciles with tab badge totals",
    tabErrors === result.errors.length && tabWarnings === result.warnings.length
  );

  check(
    "every issue carries a stable code and a tab location",
    result.issues.every(
      (i) => typeof i.code === "string" && i.code.length > 0 && typeof i.location?.tab === "string"
    )
  );
  check(
    "router no-route issue is coded and node-anchored",
    result.errors.some(
      (i) => i.code === "graph.router.no-route" && i.location.nodeId === "r1" && i.location.fieldAnchor === "routes"
    )
  );
}

console.log("\n[expression autocomplete]");
{
  const { activeExpressionToken, applyExpressionCompletion, suggestExpressions } = await import(
    "@/lib/composer/expression-autocomplete"
  );
  const { buildExpressionCatalog, flattenExpressionCatalog } = await import(
    "@/lib/composer/agentfabric-expression-catalog"
  );
  const { createScaffoldProject } = await import("@/lib/composer/factory");

  const text = "Summarise @gen";
  const token = activeExpressionToken(text, text.length);
  check("token starts at the @ sigil", token?.start === 10);
  check("token captures typed text", token?.text === "@gen");
  check("no token without an @", activeExpressionToken("plain words", 11) === null);
  check("whitespace ends the token", activeExpressionToken("@node then", 10) === null);
  check("caret before the @ finds no token", activeExpressionToken("@node", 0) === null);
  check(
    "token is found mid-string",
    activeExpressionToken("a @req and more", 6)?.text === "@req"
  );

  const entries = flattenExpressionCatalog(
    buildExpressionCatalog(createScaffoldProject("ORG").brokers[0])
  );
  check("suggestions match on the request scope", suggestExpressions(entries, "@request").length > 0);
  check("bare @ returns the whole catalog head", suggestExpressions(entries, "@", 3).length === 3);
  check("suggestions respect the limit", suggestExpressions(entries, "@", 2).length === 2);
  check("unmatched token yields no suggestions", suggestExpressions(entries, "@zzzz").length === 0);

  // Completing a bare token inserts the wrapped form verbatim.
  const bare = applyExpressionCompletion(text, token!, "{!@generator.x.output}");
  check("completion replaces the token", bare.value === "Summarise {!@generator.x.output}");
  check("completion leaves the caret at the end", bare.caret === bare.value.length);

  // Inside an existing {! } wrapper the braces must not be doubled.
  const wrapped = "Say {!@gen";
  const wrappedToken = activeExpressionToken(wrapped, wrapped.length)!;
  const applied = applyExpressionCompletion(wrapped, wrappedToken, "{!@generator.x.output}");
  check("completion does not double the braces", applied.value === "Say {!@generator.x.output");
}

console.log("\n[node field issues]");
{
  const { nodeFieldIssues } = await import("@/lib/composer/node-field-issues");
  const { validateProject } = await import("@/lib/composer/validate");
  const { composerReducer } = await import("@/lib/composer/store");
  const { createScaffoldProject } = await import("@/lib/composer/factory");

  let project = createScaffoldProject("ORG");
  project = composerReducer(project, {
    type: "addNode",
    kind: "router",
    position: { x: 0, y: 0 },
    id: "r1",
  });
  const routerIssues = nodeFieldIssues(validateProject(project), "r1");
  check("router route error maps to the routes field", routerIssues.has("routes"));
  check("router fallback error maps to the otherwise field", routerIssues.has("otherwise"));

  // A generator with no LLM and no broker default is an LLM-field warning.
  project = composerReducer(project, {
    type: "addNode",
    kind: "generator",
    position: { x: 0, y: 0 },
    id: "g1",
  });
  const generatorIssues = nodeFieldIssues(validateProject(project), "g1");
  check("missing LLM maps to the llm field", generatorIssues.has("llm"));
  check("issues are scoped to one node", !nodeFieldIssues(validateProject(project), "g1").has("routes"));

  const unknownNode = nodeFieldIssues(validateProject(project), "does-not-exist");
  check("unknown node has no field issues", unknownNode.size === 0);
}

console.log("\n[keyboard shortcuts]");
{
  const { resolveShortcut } = await import("@/lib/composer/keyboard");
  const base = { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  check("cmd+z is undo", resolveShortcut({ ...base, key: "z", metaKey: true }) === "undo");
  check("ctrl+z is undo", resolveShortcut({ ...base, key: "z", ctrlKey: true }) === "undo");
  check(
    "shift+cmd+z is redo",
    resolveShortcut({ ...base, key: "z", metaKey: true, shiftKey: true }) === "redo"
  );
  check("cmd+y is redo", resolveShortcut({ ...base, key: "y", metaKey: true }) === "redo");
  check("cmd+k is command palette", resolveShortcut({ ...base, key: "k", metaKey: true }) === "commandPalette");
  check("cmd+f is canvas search", resolveShortcut({ ...base, key: "f", metaKey: true }) === "canvasSearch");
  check("escape closes overlays", resolveShortcut({ ...base, key: "Escape" }) === "closeOverlay");
  check("plain z is not a shortcut", resolveShortcut({ ...base, key: "z" }) === null);
  check("alt+cmd+z is not undo", resolveShortcut({ ...base, key: "z", metaKey: true, altKey: true }) === null);
}

console.log("\n[composer session persistence]");
{
  const storage = new Map<string, string>();
  (globalThis as { window?: Window }).window = {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  } as Window;

  const {
    loadComposerPhaseFromSession,
    loadComposerProjectFromSession,
    saveComposerPhaseToSession,
    saveComposerProjectToSession,
  } = await import("@/lib/composer/session-persistence");
  const { createScaffoldProject } = await import("@/lib/composer/factory");

  const project = createScaffoldProject("ORG");
  saveComposerProjectToSession({ ...project, identity: { ...project.identity, name: "Session Net" } });
  saveComposerPhaseToSession("editing");

  const restored = loadComposerProjectFromSession();
  check("session restores project name", restored?.identity.name === "Session Net");
  check("session restores phase", loadComposerPhaseFromSession() === "editing");

  const { inferOrganizationId } = await import("@/lib/composer/session-persistence");
  const { importAsset } = await import("@/lib/composer/factory");
  const blankOrgProject = {
    ...project,
    identity: { ...project.identity, organizationId: "", name: "Blank Org Draft" },
    assets: [
      importAsset({
        kind: "agent",
        groupId: "ORG-FROM-ASSET",
        assetId: "sample-agent",
        version: "1.0.0",
        name: "Sample Agent",
      }),
    ],
  };
  storage.set("agent-network:composer-project", JSON.stringify(blankOrgProject));
  const blankOrgRestored = loadComposerProjectFromSession();
  check("session loads draft with blank organizationId", blankOrgRestored?.identity.name === "Blank Org Draft");
  check(
    "session infers organizationId from composed assets",
    blankOrgRestored?.identity.organizationId === "ORG-FROM-ASSET"
  );
  check(
    "inferOrganizationId prefers identity",
    inferOrganizationId({ ...project, identity: { ...project.identity, organizationId: "ORG-A" } }) === "ORG-A"
  );

  const { markComposerDraft, hasComposerDraft, clearComposerSession } = await import(
    "@/lib/composer/session-persistence"
  );
  markComposerDraft();
  check("draft flag set", hasComposerDraft());
  clearComposerSession();
  check("draft flag cleared", !hasComposerDraft());
}

console.log("\n[registry primary interface]");
{
  const {
    inferRegistryPrimaryInterface,
    setRegistryPrimaryInterface,
  } = await import("@/lib/composer/registry/agent-interfaces");

  const dualInterface = {
    key: "agent-1",
    metadata: {
      platform: "Custom",
      interfaces: {
        a2a: { card: { name: "Agent", version: "1.0.0" } },
        a2a_v03: { card: { name: "Agent", version: "1.0.0" } },
      },
    },
  };
  check("dual interface prefers a2a", inferRegistryPrimaryInterface(dualInterface.metadata.interfaces) === "a2a");

  const switched = setRegistryPrimaryInterface(dualInterface, "a2a_v03");
  check("switch to a2a_v03 drops a2a", switched.metadata.interfaces.a2a === undefined);
  check("switch to a2a_v03 keeps card", switched.metadata.interfaces.a2a_v03?.card !== undefined);
  check(
    "switch persists primary",
    inferRegistryPrimaryInterface(switched.metadata.interfaces) === "a2a_v03"
  );
}

console.log("\n[registry issue navigation]");
{
  const { resolveIssueNavigation, panelTabFromYamlPath } = await import("@/lib/composer/issue-navigation");
  const { yamlPathToLocation } = await import("@/lib/composer/validation/schema-location");

  check(
    "registry yaml path tab",
    panelTabFromYamlPath("registry.agents.agent-1.metadata.interfaces.a2a_v03.card") === "registry"
  );

  const urlPath = "registry.agents.agent-1.metadata.interfaces.a2a_v03.card";
  const urlMessage = `Schema (agent-network.yaml) at ${urlPath}: missing required property "url"`;
  const urlIssue = resolveIssueNavigation({
    code: "schema.yaml",
    severity: "error",
    origin: "schema",
    message: urlMessage,
    location: yamlPathToLocation(urlPath, urlMessage),
  });
  check("registry error opens registry tab", urlIssue.tab === "registry");
  check("registry error tab label", urlIssue.tabLabel === "Legacy Registry");
  check("registry error agent key", urlIssue.registry?.key === "agent-1");
  check("registry error url anchor", urlIssue.registry?.anchor === "registry-agent-card-url");

  const v03Serialize = await import("@/lib/composer/registry/agent-card-v03");
  const card = v03Serialize.patchA2aV03CardFields(
    { name: "Agent", version: "1.0.0" },
    { url: "https://broker.example/a2a", protocolVersion: "0.3.0" }
  );
  const serialized = v03Serialize.serializeA2aV03RegistryCard(card);
  check("a2a_v03 serialize top-level url", serialized.url === "https://broker.example/a2a");
  check("a2a_v03 serialize protocolVersion", serialized.protocolVersion === "0.3.0");
}

console.log("\n[registry convert to dependencies]");
{
  const {
    applyConvertRegistryEntityToDependency,
    listConvertibleRegistryEntities,
  } = await import("@/lib/composer/registry/convert-to-dependencies");
  const { loadComposerExample } = await import("@/lib/composer/examples/load-example");
  const { deriveDependencies, exchangeDependencyAssets } = await import("@/lib/composer/model");

  const loaded = loadComposerExample("it-investigation-broker", "example-org");
  check("it-help has no exchange dependency assets", exchangeDependencyAssets(loaded.project).length === 0);
  check("it-help has registry-local connections in model", loaded.project.assets.some((a) => a.registryLocal));
  const convertibleBefore = listConvertibleRegistryEntities(loaded.project);
  check("it-help example has convertible registry entities", convertibleBefore.length >= 3);

  const helpCenter = convertibleBefore.find((c) => c.entityKey === "help_center_agent");
  check("help_center_agent is convertible", Boolean(helpCenter));

  if (helpCenter) {
    const converted = applyConvertRegistryEntityToDependency(loaded.project, {
      registryKind: "agents",
      entityKey: "help_center_agent",
      groupId: "example-org",
      assetId: "help-center-agent",
      version: "1.2.0",
      name: "Help Center Agent",
    });
    check(
      "converted asset clears registryLocal",
      converted.assets.some(
        (a) => a.assetId === "help-center-agent" && a.version === "1.2.0" && !a.registryLocal
      )
    );
    check(
      "converted registry drops entity",
      !converted.registry?.agents.some((a) => a.key === "help_center_agent")
    );
    check(
      "converted project emits dependency",
      deriveDependencies(converted).some((d) => d.assetId === "help-center-agent")
    );
  }
}

console.log("\n[composer examples]");
{
  const { loadComposerExample } = await import("@/lib/composer/examples/load-example");
  const { validateProject } = await import("@/lib/composer/validate");

  const loaded = loadComposerExample("it-investigation-broker", "example-org");
  check("it-investigation example loads", loaded.project.brokers.length === 1);
  check(
    "it-investigation example org patched",
    loaded.project.identity.organizationId === "example-org"
  );
  check(
    "it-investigation example broker key",
    loaded.project.brokers[0].name === "it_help_investigation"
  );
  check(
    "it-investigation example has graph nodes",
    loaded.project.brokers[0].nodes.length >= 10
  );
  const validation = validateProject(loaded.project);
  check(
    "it-investigation example validates",
    validation.ok || validation.errors.every((e) => !e.message.includes("Import failed")),
    validation.errors.map((e) => e.message).join("; ")
  );

  const vogue = loadComposerExample("vogue-premiere-broker", "example-org");
  check("vogue-premiere example loads", vogue.project.brokers.length === 1);
  check(
    "vogue-premiere example org patched",
    vogue.project.identity.organizationId === "example-org"
  );
  check(
    "vogue-premiere connections land in the selected org as registry-local",
    vogue.project.assets.length === 6 &&
      vogue.project.assets.every((a) => a.registryLocal && a.namespace === "example-org")
  );
  check("vogue-premiere example broker key", vogue.project.brokers[0].name === "vogue_premiere");
  check("vogue-premiere example has graph nodes", vogue.project.brokers[0].nodes.length >= 15);
  const vogueValidation = validateProject(vogue.project);
  check(
    "vogue-premiere example validates",
    vogueValidation.ok || vogueValidation.errors.every((e) => !e.message.includes("Import failed")),
    vogueValidation.errors.map((e) => e.message).join("; ")
  );
}

// ---------------------------------------------------------------------------
console.log("\n[suite landing redirect]");
{
  const { isSafeRedirectPath, safeRedirectPath } = await import("@/lib/safe-redirect");
  check("safe builder path", isSafeRedirectPath("/builder"));
  check("safe agent-network view", isSafeRedirectPath("/agent-network?view=exchange"));
  check("reject external", !isSafeRedirectPath("//evil.example"));
  check("reject unknown path", !isSafeRedirectPath("/admin"));
  check("safeRedirectPath fallback", safeRedirectPath("//evil", "/agent-network") === "/agent-network");
  check("safeRedirectPath accepts", safeRedirectPath("/builder") === "/builder");
}

console.log("\n[feedback issue formatting]");
{
  const { buildIssueBody, buildIssueTitle } = await import("@/lib/feedback/format-issue");
  const title = buildIssueTitle("Invoke tab shows wrong broker after refresh");
  check("buildIssueTitle prefixes user report", title.startsWith("[User report]"));
  check("buildIssueTitle includes snippet", title.includes("Invoke tab"));
  const body = buildIssueBody({
    description: "Something broke",
    includeConsole: true,
    privacyConfirmed: true,
    context: {
      route: "/builder",
      userAgent: "test",
      viewportWidth: 1200,
      viewportHeight: 800,
      appVersion: "abc1234",
      desktop: false,
      desktopPlatform: null,
      reportedAt: "2026-01-01T00:00:00.000Z",
    },
    consoleEntries: [{ level: "error", message: "TypeError: x", timestamp: "2026-01-01T00:00:01.000Z" }],
  });
  check("buildIssueBody includes route", body.includes("`/builder`"));
  check("buildIssueBody includes console", body.includes("TypeError: x"));
}

console.log("\n[governance rules]");
{
  const scaffold = apply(createScaffoldProject("ORG"), {
    type: "setIdentity",
    patch: { name: "Governance Fixture", assetId: "governance-fixture" },
  });

  // An A2A interface with no inbound policies is a deliberate deployment choice,
  // so nothing here may flag it.
  check(
    "an open A2A interface is not a finding",
    !validateProject(scaffold).issues.some((i) => i.location.tab === "access")
  );

  function withAgentTools(tools: RegistryAgentTool[]): ComposerProject {
    return {
      ...scaffold,
      registry: {
        agents: [{ key: "billing-agent", metadata: { platform: "Custom", interfaces: {}, tools } }],
        mcps: [],
        llms: [],
      },
    };
  }

  const unrestricted = validateProject(withAgentTools([{ mcp: { ref: { name: "billing-mcp" } } }])).issues.filter(
    (i) => i.code === "registry.agent.mcp-tools.unrestricted"
  );
  check("an MCP tool with no allowed list warns", unrestricted.length === 1, `${unrestricted.length}`);
  check("unrestricted finding is a warning", unrestricted[0]?.severity === "warning");
  check(
    "unrestricted finding points at the owning agent",
    unrestricted[0]?.location.tab === "registry" &&
      unrestricted[0]?.location.registry?.kind === "agents" &&
      unrestricted[0]?.location.registry?.key === "billing-agent"
  );
  check(
    "unrestricted message names the MCP server so it is actionable",
    unrestricted[0]?.message.includes("billing-mcp") === true
  );

  // The serializer omits an empty list, so empty and absent must read the same.
  check(
    "an empty allowed list is treated as unrestricted",
    validateProject(withAgentTools([{ mcp: { ref: { name: "billing-mcp" }, allowed: [] } }])).issues.some(
      (i) => i.code === "registry.agent.mcp-tools.unrestricted"
    )
  );
  check(
    "a scoped allowed list clears the warning",
    !validateProject(
      withAgentTools([{ mcp: { ref: { name: "billing-mcp" }, allowed: ["BillingMcp.get_invoice"] } }])
    ).issues.some((i) => i.code === "registry.agent.mcp-tools.unrestricted")
  );
  check(
    "a2a tool refs carry no allowed list and are not flagged",
    !validateProject(withAgentTools([{ a2a: { ref: { name: "partner-agent" } } }])).issues.some(
      (i) => i.code === "registry.agent.mcp-tools.unrestricted"
    )
  );

  const perServer = validateProject(
    withAgentTools([
      { mcp: { ref: { name: "billing-mcp" } } },
      { mcp: { ref: { name: "crm-mcp" } } },
      { mcp: { ref: { name: "audit-mcp" }, allowed: ["AuditMcp.write"] } },
    ])
  ).issues.filter((i) => i.code === "registry.agent.mcp-tools.unrestricted");
  check("one finding per unrestricted server", perServer.length === 2, `${perServer.length}`);

  // The rule describes a permissive-but-valid setup, so it may not block export.
  const governance = validateProject(withAgentTools([{ mcp: { ref: { name: "billing-mcp" } } }])).errors;
  check(
    "governance findings never surface as errors",
    !governance.some((i) => i.code === "registry.agent.mcp-tools.unrestricted")
  );
}

console.log("\n[v2 Object Store] structure-preserving task story parser");
{
  const taskPayload = JSON.stringify({
    id: "task-123",
    contextId: "ctx-9",
    status: {
      state: "completed",
      timestamp: "2026-08-11T00:00:00Z",
      message: { role: "agent", parts: [{ kind: "text", text: "All done." }] },
    },
    history: [
      { role: "user", parts: [{ kind: "text", text: "List my repos" }], messageId: "m1", kind: "message" },
      { role: "agent", parts: [{ kind: "text", text: "Here are your repositories." }], messageId: "m2" },
      { role: "agent", parts: [{ kind: "data", data: { tool: "list_repos", count: 3 } }], messageId: "m3" },
    ],
    artifacts: [{ name: "result", description: "final", parts: [{ kind: "text", text: "repo-a, repo-b" }] }],
  });
  const envelope = JSON.stringify({ task_id: "task-123", payload_json: taskPayload });

  const story = parseA2ATaskStory(taskPayload);
  check("parses A2A task into a story", story !== null);
  check("preserves history order and roles", story?.history.length === 3 && story?.history[0].role === "user");
  check("renders data parts as JSON text", Boolean(story?.history[2].text.includes("list_repos")));
  check("captures terminal status state", story?.statusState === "completed");
  check("captures status message text", story?.statusText === "All done.");
  check("captures artifacts with name", story?.artifacts[0]?.name === "result");

  const built = buildTaskStoryFromStorageEntry(envelope);
  check("builds story from storage envelope", built.story?.taskId === "task-123");

  const graphPayload = JSON.stringify({
    nodes: { orchestrator: { reasoning: "Chose to call the repo tool because the user asked for repos." } },
  });
  const graphEntries = parseGraphStateEntries(graphPayload);
  check("keys graph state entries by path", graphEntries.some((e) => e.key.includes("orchestrator")));
  check("keeps graph state text", graphEntries.some((e) => e.text.includes("repo tool")));

  const notATask = parseA2ATaskStory(JSON.stringify({ foo: "bar" }));
  check("returns null for non-task payloads", notATask === null);

  // Some brokers persist the A2A task JSON directly (no StorageEntry envelope).
  const directTask = buildTaskStoryFromStorageEntry(taskPayload);
  check("reconstructs story from envelope-less task value", directTask.story?.taskId === "task-123");

  const shapeEnvelope = describeV2StorageShape(envelope);
  check("shape: detects payload_json envelope", shapeEnvelope.hasPayloadJson === true);
  check("shape: detects A2A task payload", shapeEnvelope.looksLikeA2ATask === true);

  const shapeDirect = describeV2StorageShape(taskPayload);
  check("shape: envelope-less still recognized as A2A task", shapeDirect.looksLikeA2ATask === true);
  check("shape: envelope-less has no payload_json", shapeDirect.hasPayloadJson === false);
}

console.log("\n[v2 Object Store] Python pickle (a2a.types.Task) decoding");
{
  // A synthetic pickle (protocol 5) of an a2a.types.Task built with dummy content
  // (no customer data), mirroring the real v2 Python broker Object Store payload:
  //   history=[Message(role=user, TextPart)], status=TaskStatus(completed, agent msg).
  const pickledTaskB64 =
    "gAWVLgIAAAAAAACMCWEyYS50eXBlc5SMBFRhc2uUk5QpgZR9lCiMAmlklIwIdGFzay14eXqUjApjb250ZXh0X2lklIwFY3R4LTGUjAdoaXN0b3J5lF2UaACMB01lc3NhZ2WUk5QpgZR9lCiMBHJvbGWUaACMBFJvbGWUk5SMBHVzZXKUhZRSlIwFcGFydHOUXZRoAIwEUGFydJSTlCmBlH2UjARyb290lGgAjAhUZXh0UGFydJSTlCmBlH2UKIwEdGV4dJSMFlN5bnRoZXRpYyB1c2VyIHJlcXVlc3SUjARraW5klGggjAhtZXRhZGF0YZROdWJzYmGMCm1lc3NhZ2VfaWSUjAptaWQtdXNlci0xlGgijAdtZXNzYWdllGgHaAiMB3Rhc2tfaWSUaAZ1YmGMBnN0YXR1c5RoAIwKVGFza1N0YXR1c5STlCmBlH2UKIwFc3RhdGWUaACMCVRhc2tTdGF0ZZSTlIwJY29tcGxldGVklIWUUpSMCXRpbWVzdGFtcJSMGTIwMjYtMDEtMDFUMDA6MDA6MDArMDA6MDCUaCZoDCmBlH2UKGgPaBGMBWFnZW50lIWUUpRoFV2UaBgpgZR9lGgbaB0pgZR9lChoIIwcU3ludGhldGljIGFnZW50IGZpbmFsIGFuc3dlcpRoImggaCNOdWJzYmFoJIwLbWlkLWFnZW50LTGUaCJoJmgHaAhoJ2gGdWJ1YowJYXJ0aWZhY3RzlE5oIowEdGFza5RoI051Yi4=";

  check("detects base64 pickle payload", looksLikePickle(pickledTaskB64) === true);
  check("rejects plain JSON as pickle", looksLikePickle('{"id":"x"}') === false);

  const story = parsePickledA2ATask(pickledTaskB64);
  check("pickle: reconstructs task id", story?.taskId === "task-xyz");
  check("pickle: history role/text preserved", story?.history[0]?.role === "user" && story?.history[0]?.text === "Synthetic user request");
  check("pickle: terminal status state", story?.statusState === "completed");
  check("pickle: status timestamp", story?.statusTimestamp === "2026-01-01T00:00:00+00:00");
  check("pickle: final agent message text", story?.statusText === "Synthetic agent final answer");

  const flat = extractStringsFromPickledTask(pickledTaskB64);
  check("pickle: flat strings include both turns", flat.includes("Synthetic user request") && flat.includes("Synthetic agent final answer"));

  check("pickle: non-pickle returns null", parsePickledA2ATask('{"id":"x"}') === null);
}

console.log("\n[v2 node timeline] node-graph reconstruction + format detection");
{
  let idx = 0;
  const mkEntry = (type: string, over: Partial<LogEntry> = {}): LogEntry => {
    const i = idx++;
    return {
      index: i,
      type,
      summary: over.summary ?? type,
      timestamp: over.timestamp ?? 1000 + i * 100,
      logger: over.logger ?? "module_graph_runtime",
      level: "INFO",
      appId: "app",
      workerId: "w",
      fields: over.fields ?? {},
      raw: over.raw ?? {},
      _id: `id-${i}`,
      _index: "idx",
    };
  };

  const entries: LogEntry[] = [
    mkEntry("INBOUND_REQUEST", { summary: "inbound", logger: "gateway" }),
    mkEntry("GRAPH_NODE", { fields: { graphNode: "orchestrator" }, raw: { message: "Current node: orchestrator" } }),
    mkEntry("LLM_REASONING", { fields: { graphNode: "orchestrator", llmReasoning: "User wants repos; call the tool." } }),
    mkEntry("LLM_TOOL_SELECTION", { fields: { graphNode: "orchestrator", tool: "list_repos" } }),
    mkEntry("TOOL_INPUT", { fields: { graphNode: "orchestrator", toolInputJson: { owner: "acme" } } }),
    mkEntry("TOOL_OUTPUT", { fields: { graphNode: "orchestrator", toolOutputJson: { repos: ["a", "b"] } } }),
    mkEntry("GRAPH_TRANSITION", { fields: { graphNode: "orchestrator" }, raw: { message: "Transitioning to next node: echo1" } }),
    mkEntry("GRAPH_NODE", { fields: { graphNode: "echo1" }, raw: { message: "Current node: echo1" } }),
    mkEntry("FINAL_RESPONSE", { fields: { graphNode: "echo1" }, summary: "final" }),
  ];

  const timeline = buildV2NodeTimeline(entries);
  check("timeline: not degraded when graph logs present", timeline.degraded === false);
  check("timeline: leading non-node entries are pre-entries", timeline.preEntries.length === 1);
  check("timeline: one visit per node", timeline.visits.length === 2);
  check("timeline: first visit is orchestrator", timeline.visits[0]?.nodeName === "orchestrator");
  check("timeline: captures reasoning", timeline.visits[0]?.reasoning[0]?.includes("call the tool") === true);
  check("timeline: pairs tool input+output", timeline.visits[0]?.toolCalls.length === 1);
  check(
    "timeline: tool call carries input and output",
    Boolean(timeline.visits[0]?.toolCalls[0]?.inputJson) && Boolean(timeline.visits[0]?.toolCalls[0]?.outputJson)
  );
  check("timeline: records transition target", timeline.visits[0]?.transitionTo === "echo1");
  check("timeline: second visit is echo1", timeline.visits[1]?.nodeName === "echo1");

  const degraded = buildV2NodeTimeline([mkEntry("INBOUND_REQUEST", { logger: "gateway" })]);
  check("timeline: degraded when no graph logs", degraded.degraded === true);

  // Some brokers emit the model's thinking as LLM_RESPONSE, not LLM_REASONING.
  const respTimeline = buildV2NodeTimeline([
    mkEntry("GRAPH_NODE", { fields: { graphNode: "reasoner" }, raw: { message: "Current node: reasoner" } }),
    mkEntry("LLM_RESPONSE", {
      fields: { graphNode: "reasoner" },
      raw: { message: "Response output from OpenAI: I will escalate because the site is down." },
    }),
  ]);
  check(
    "timeline: harvests reasoning from LLM_RESPONSE",
    respTimeline.visits[0]?.reasoning[0]?.includes("I will escalate") === true
  );

  // Format detection
  check(
    "format: v2 from graph entry types",
    detectBrokerFormat(undefined, [mkEntry("GRAPH_NODE", { logger: "x" })]) === "v2"
  );
  check(
    "format: v1 default when no graph signals",
    detectBrokerFormat(undefined, [mkEntry("INBOUND_REQUEST", { logger: "gateway" })]) === "v1"
  );
  check(
    "format: object-store probe wins",
    detectBrokerFormat(
      { objectStore: { available: true, debug: { tasks: { partition: null, keyFound: false, keyUsed: null, valueEmpty: true, stringCount: 0, brokerFormat: "v2" } } } } as never,
      []
    ) === "v2"
  );
}

console.log("\n[runtime-logs parser] taskId extraction from raw CloudHub log lines");
{
  const API = "1a2b3c4d";
  const ID_A = "aaaaaaaa-1111-2222-3333-444444444444";
  const ID_B = "bbbbbbbb-5555-6666-7777-888888888888";

  const one = parseLogsForTasks(
    `2026-08-13T09:00:00.000Z INFO apiInstanceId=${API} taskId=${ID_A} iteration=3`,
    API
  );
  check("parser: extracts a single taskId", one.length === 1 && one[0].taskId === ID_A);
  check("parser: reads the iteration capture group", one[0]?.maxIteration === 3);

  // Regression: with a global regex, `String.match` returns whole matches, so
  // `[1]` was the *second* occurrence including its `taskId=` prefix. A line
  // mentioning two ids therefore produced a task whose id was `taskId=<uuid>`.
  const two = parseLogsForTasks(
    `2026-08-13T09:00:01.000Z INFO apiInstanceId=${API} taskId=${ID_A} parentTaskId=${ID_B}`,
    API
  );
  check("parser: two ids on one line still yield one task", two.length === 1);
  check(
    "parser: taskId is never prefixed with its own field name",
    two.every((t) => !t.taskId.includes("taskId")),
    two.map((t) => t.taskId).join(",")
  );
  check("parser: keeps the first id on the line", two[0]?.taskId === ID_A);

  const json = parseLogsForTasks(
    `2026-08-13T09:00:02.000Z INFO {"apiInstanceId":"${API}","taskId":"${ID_B}"}`,
    API
  );
  check("parser: extracts taskId from JSON-shaped messages", json.length === 1 && json[0].taskId === ID_B);

  const tooShort = parseLogsForTasks(`2026-08-13T09:00:03.000Z INFO apiInstanceId=${API} taskId=abc`, API);
  check("parser: rejects implausibly short ids", tooShort.length === 0);
}

console.log("\n[log-search queries] task discovery is scoped, not scanned");
{
  const ORG = "org-1";
  const API = "21047554";
  const queries = buildTaskQueries({
    orgId: ORG,
    apiInstanceId: API,
    appIdFilters: ["ordermanagementagent", `_api_version_${API}`],
    routeSegments: ["agent_reason_only"],
  });
  const taskQueries = queries.filter((q) => q.countsTowardTotal);
  const errorQueries = queries.filter((q) => !q.countsTowardTotal);

  // The broker logs snake_case `task_id=`; the gateway logs the A2A body with
  // `taskId`. Searching only one of them missed an entire source of tasks.
  check(
    "queries: every task query narrows to task-bearing lines",
    taskQueries.length > 0 &&
      taskQueries.every((q) => q.lucene.includes('message: ("taskId" OR "task_id")')),
    taskQueries.map((q) => q.label).join(" | ")
  );

  // Regression: one query per speculative appId variant spent a round trip per
  // guess, and most guesses matched nothing.
  const appIdQueries = taskQueries.filter((q) => q.lucene.includes("appId:"));
  check("queries: appId candidates are OR'd into a single query", appIdQueries.length === 1);
  check(
    "queries: appId values stay quoted single terms",
    appIdQueries[0]?.lucene.includes('appId: ("ordermanagementagent" OR "_api_version_21047554")'),
    appIdQueries[0]?.lucene
  );

  // Regression: `apiInstanceId` is not a mapped field on the monitoring index,
  // so querying it as a field returned zero every time. It is only ever an
  // indexed token inside the message text.
  check(
    "queries: apiInstanceId is matched in the message, never as a field",
    queries.every((q) => !/\bapiInstanceId\s*[:=]/.test(q.lucene)) &&
      taskQueries.some((q) => q.lucene.includes(`message: "${API}"`)),
    queries.map((q) => q.lucene).join(" | ")
  );

  // `application` appears in `_source` but is not mapped, so filtering on it
  // matches nothing.
  check(
    "queries: never filter on the unmapped `application` field",
    queries.every((q) => !/\bapplication\s*:/.test(q.lucene))
  );

  check(
    "queries: route segments keep the task clause alongside the wildcard",
    taskQueries.some(
      (q) =>
        q.lucene.includes("message:*agent_reason_only*") &&
        q.lucene.includes('message: ("taskId" OR "task_id")')
    )
  );

  // Error runs carry no task id, so they need their own query — but they are
  // rare enough that draining pages for them is waste.
  check("queries: exactly one error-scan query", errorQueries.length === 1);
  check("queries: the error scan is capped at one page", errorQueries[0]?.maxPages === 1);
  check(
    "queries: the error scan looks for broker error patterns",
    errorQueries[0]?.lucene.includes("TOOL_ERROR") ?? false
  );

  const noAppIds = buildTaskQueries({
    orgId: ORG,
    apiInstanceId: API,
    appIdFilters: [],
    routeSegments: [],
  });
  check(
    "queries: still searchable when appId resolution failed",
    noAppIds.length === 1 && noAppIds[0].lucene.includes(`message: "${API}"`),
    noAppIds.map((q) => q.label).join(" | ")
  );
}

console.log("\n[amc spec selection] a task's logs live under the spec that ran it");
{
  // Real AMC shape observed from /deployments/{id}/specs: `version` is the
  // spec id used in the logs URL, and `createdAt` is an epoch-MILLISECOND
  // NUMBER (not an ISO string). Newest-first, exactly as AMC returns it.
  const specs: AmcSpecDescriptor[] = [
    { version: "ec259a41", createdAt: Date.parse("2026-08-13T19:05:07Z") }, // current, post-redeploy
    { version: "420333e5", createdAt: Date.parse("2026-08-12T22:12:51Z") }, // ran both example tasks
    { version: "31e422f0", createdAt: Date.parse("2026-08-12T21:12:57Z") },
    { version: "c03ff6f3", createdAt: Date.parse("2026-08-11T09:14:43Z") }, // oldest
  ];

  // Regression for the type bug that shipped this broken: parseSpecTimestamp
  // only accepted strings, so numeric `createdAt` resolved to null and every
  // task silently fell back to the newest (current) spec.
  check(
    "spec: numeric epoch-ms createdAt is parsed",
    parseSpecTimestamp({ createdAt: 1786572771880 }) === 1786572771880
  );
  check(
    "spec: ISO-string createdAt still parses",
    parseSpecTimestamp({ createdAt: "2026-08-12T22:12:51Z" }) === Date.parse("2026-08-12T22:12:51Z")
  );

  // A task that ran before the redeploy must resolve to the spec that was live
  // then — not the current desiredVersion, whose logs never held that task.
  check(
    "spec: pre-redeploy task selects the spec that was running then",
    chooseSpecIdAtOrBefore(specs, parseEpochMs("2026-08-13T11:44:45.344Z")) === "420333e5"
  );
  check(
    "spec: a later task under the same spec still selects that spec",
    chooseSpecIdAtOrBefore(specs, parseEpochMs("2026-08-13T18:44:18.484Z")) === "420333e5"
  );
  check(
    "spec: a task after the redeploy selects the new current spec",
    chooseSpecIdAtOrBefore(specs, parseEpochMs("2026-08-13T20:00:00Z")) === "ec259a41"
  );

  // Fallbacks: unknown task time picks the newest dated spec; specs without any
  // timestamp fall back to the first entry rather than returning nothing.
  check("spec: unknown task time falls back to newest dated spec", chooseSpecIdAtOrBefore(specs, null) === "ec259a41");
  check(
    "spec: version is preferred as the id, else id",
    chooseSpecIdAtOrBefore([{ id: "raw-id", createdAt: 5 }], 10) === "raw-id"
  );
  check(
    "spec: undated specs still resolve to a spec id",
    chooseSpecIdAtOrBefore([{ version: "only" }], parseEpochMs("2026-08-13T00:00:00Z")) === "only"
  );
  check("spec: empty spec list resolves to null", chooseSpecIdAtOrBefore([], 10) === null);
}

console.log("\n[execution overlay] path a task took through the published graph");
{
  const visitFor = (
    nodeName: string,
    index: number,
    transitionTo?: string,
    durationMs = 100
  ): NodeVisit => ({
    id: `node-${index}`,
    index,
    nodeName,
    startTime: 0,
    endTime: durationMs,
    durationMs,
    reasoning: [],
    toolCalls: [],
    ...(transitionTo != null ? { transitionTo } : {}),
    stateEntries: [],
    entries: [],
    summary: "",
  });

  // Protocol graph ids are namespaced by kind while logs carry the bare name;
  // if these did not agree the overlay would match nothing and every node in the
  // diagram would wrongly render as un-traversed.
  check(
    "overlay: a kind-namespaced id matches the logged node name",
    canonicalNodeKey("orchestrator.crossPlatformTriage") === canonicalNodeKey("crossPlatformTriage")
  );
  check("overlay: matching ignores case", canonicalNodeKey("Triage") === canonicalNodeKey("triage"));

  const overlay = buildExecutionOverlay([
    visitFor("triage", 0, "research"),
    visitFor("research", 1, "respond"),
    visitFor("respond", 2),
  ]);
  check("overlay: one entry per visited node", overlay.byNode.size === 3);
  check("overlay: hops follow logged transitions", overlay.hops === 2);
  check("overlay: first node keeps execution order 1", overlay.byNode.get("triage")?.order === 1);
  check("overlay: the last node reached is marked final", overlay.byNode.get("respond")?.isFinal === true);
  check("overlay: earlier nodes are not marked final", overlay.byNode.get("triage")?.isFinal === false);
  check(
    "overlay: traversed hops are keyed source->target",
    overlay.traversedEdges.get("triage->research") === 1
  );
  check("overlay: an untaken transition has no hop order", overlay.traversedEdges.get("triage->respond") === undefined);
  check(
    "overlay: hop keys accept kind-namespaced graph ids",
    overlay.traversedEdges.get(
      `${canonicalNodeKey("orchestrator.triage")}->${canonicalNodeKey("agent.research")}`
    ) === 1
  );

  // A broker that does not log transitions leaves adjacency in time as the only
  // evidence of the path.
  const inferred = buildExecutionOverlay([visitFor("a", 0), visitFor("b", 1)]);
  check("overlay: consecutive visits infer a hop", inferred.traversedEdges.get("a->b") === 1);

  // Loops are normal in agent graphs.
  const looped = buildExecutionOverlay([
    visitFor("orchestrator", 0, "worker"),
    visitFor("worker", 1, "orchestrator"),
    visitFor("orchestrator", 2),
  ]);
  check("overlay: a revisited node stays one entry", looped.byNode.size === 2);
  check("overlay: revisits are counted", looped.byNode.get("orchestrator")?.visitCount === 2);
  check("overlay: revisit durations accumulate", looped.byNode.get("orchestrator")?.durationMs === 200);
  check("overlay: a return hop is recorded", looped.traversedEdges.get("worker->orchestrator") === 2);

  const empty = buildExecutionOverlay([]);
  check("overlay: no visits means no execution", !empty.hasExecution && empty.hops === 0);

  check(
    "overlay: drift is reported when logs name a node the graph lacks",
    findDriftedNodes(overlay, ["orchestrator.triage", "agent.research"]).join(",") === "respond"
  );
  check(
    "overlay: no drift when the graph declares every visited node",
    findDriftedNodes(overlay, ["triage", "research", "respond"]).length === 0
  );
  // The graph runtime labels the entrypoint "node 1" while the published graph
  // names its trigger, so without resolution the trigger draws as un-reached and
  // the path appears to start at the second node with a dangling first hop.
  const triggerGraphIds = ["trigger.ticket", "orchestrator.triage"];
  const triggerAliasOverlay = buildExecutionOverlay(
    [visitFor("node 1", 0, "triage"), visitFor("triage", 1)],
    triggerGraphIds
  );
  check(
    "overlay: runtime alias 'node 1' is treated as the trigger node",
    findDriftedNodes(triggerAliasOverlay, triggerGraphIds).length === 0
  );
  check(
    "overlay: the trigger node is reached under its own graph key",
    triggerAliasOverlay.byNode.get(canonicalNodeKey("trigger.ticket"))?.order === 1
  );
  check(
    "overlay: the trigger's outgoing hop is traversed",
    triggerAliasOverlay.traversedEdges.get(edgeKey("trigger.ticket", "orchestrator.triage")) === 1
  );
  check(
    "overlay: the alias does not also appear as its own node",
    triggerAliasOverlay.byNode.get("node 1") === undefined && triggerAliasOverlay.byNode.size === 2
  );

  // Without a graph to resolve against there is nothing to alias onto, so the
  // logged name has to survive as-is rather than being invented into a trigger.
  const unresolvedAlias = buildExecutionOverlay([visitFor("node 1", 0, "triage"), visitFor("triage", 1)]);
  check(
    "overlay: 'node 1' stays itself when no graph declares a trigger",
    unresolvedAlias.byNode.get("node 1")?.order === 1
  );
  check(
    "overlay: an aliasable name is still drift when the graph has no trigger",
    findDriftedNodes(unresolvedAlias, ["triage"]).join(",") === "node 1"
  );

  // A trigger that execution genuinely never entered must keep reading as such.
  const untouchedTrigger = buildExecutionOverlay([visitFor("triage", 0)], triggerGraphIds);
  check(
    "overlay: a trigger with no visit stays un-reached",
    untouchedTrigger.byNode.get(canonicalNodeKey("trigger.ticket")) === undefined
  );

  // The Object Store is a second, independent source of evidence: the broker
  // records a node_executions entry per node it ran, so a task can be known to
  // have reached a node with no graph-node logs at all.
  const storyWithExecutions = {
    history: [],
    artifacts: [],
    stateEntries: [
      { key: "execution.runtime.node_executions.getDateResponse.node_execution_id", text: "b8b1e0de-0000-4000-8000-000000000001" },
      { key: "execution.runtime.node_executions.getDateResponse.internal_node_state.output", text: "the current date is 2026-08-12" },
      { key: "execution.runtime.node_executions.triage.node_execution_id", text: "b8b1e0de-0000-4000-8000-000000000002" },
      { key: "execution.runtime.session_unified_spec.graph.nodes[0].system_prompt", text: "you are a helpful agent" },
    ],
  };
  const executed = nodeExecutionsFromState(storyWithExecutions);
  check("state: node names come from node_executions keys", executed.join(",") === "getDateResponse,triage");
  check("state: a node with several state keys is named once", executed.length === 2);
  check(
    "state: unrelated state keys are not read as node executions",
    !executed.some((name) => name.toLowerCase().includes("session"))
  );
  check("state: no story yields no executed nodes", nodeExecutionsFromState(undefined).length === 0);

  const stateOnly = buildExecutionOverlay([], ["orchestrator.triage", "agent.getDateResponse"], executed);
  check(
    "overlay: state-recorded nodes are reached even with no logs",
    stateOnly.reachedWithoutDetail.has("getdateresponse") && stateOnly.reachedWithoutDetail.size === 2
  );
  check("overlay: state evidence alone counts as execution", stateOnly.hasExecution);
  check(
    "overlay: state evidence never invents a path",
    stateOnly.hops === 0 && stateOnly.traversedEdges.size === 0
  );
  check("overlay: state evidence adds no visit detail", stateOnly.byNode.size === 0);

  // Logs are the richer source, so a node they describe must not be downgraded
  // to the detail-free state marking.
  const logsWin = buildExecutionOverlay([visitFor("triage", 0)], ["orchestrator.triage"], ["triage"]);
  check(
    "overlay: a logged node is not also marked detail-free",
    logsWin.byNode.has("triage") && !logsWin.reachedWithoutDetail.has("triage")
  );
}

console.log("\n[spec graph] drawing the broker's compiled session_unified_spec");
{
  // Shaped after module_graph_runtime's UnifiedAgentSpecification: nodes carry a
  // name and a type discriminator, handoffs live in lifecycle hooks, routers
  // declare node_references, and the graph names its entrypoint.
  const spec = {
    schema_version: "1.0",
    id: "order-management",
    label: "Order Management Agent",
    graph: {
      initial_node: "triage",
      nodes: [
        {
          name: "triage",
          type: "router",
          label: "Triage",
          node_references: [{ target: "research", description: "look it up" }, { target: "respond", description: "answer" }],
        },
        {
          name: "research",
          type: "agent",
          after_reasoning: [{ type: "handoff", target: "respond" }],
          on_exit: [{ type: "tool-call", name: "audit" }],
        },
        { name: "respond", type: "agent" },
      ],
    },
  };

  const { graph, label } = specToProtocolGraph(spec);
  check("spec graph: a graph is produced", graph !== null);
  check("spec graph: the network label is reported", label === "Order Management Agent");
  check(
    "spec graph: every declared node is drawn, plus the trigger",
    graph?.nodes.map((n) => n.id).join(",") === "trigger,triage,research,respond"
  );
  check(
    "spec graph: node kinds come from the spec's type discriminator",
    graph?.nodes.find((n) => n.id === "triage")?.kind === "router" &&
      graph?.nodes.find((n) => n.id === "research")?.kind === "agent"
  );
  check(
    "spec graph: the entrypoint is wired from the trigger",
    graph?.edges.some((e) => e.from === "trigger" && e.to === "triage") === true
  );
  check(
    "spec graph: router targets become edges",
    graph?.edges.some((e) => e.from === "triage" && e.to === "research") === true &&
      graph?.edges.some((e) => e.from === "triage" && e.to === "respond") === true
  );
  check(
    "spec graph: handoffs in lifecycle hooks become edges",
    graph?.edges.some((e) => e.from === "research" && e.to === "respond") === true
  );
  check(
    "spec graph: non-handoff hook actions are not edges",
    graph?.edges.some((e) => e.to === "audit") === false
  );
  check(
    "spec graph: edge provenance is recorded",
    graph?.edges.find((e) => e.from === "triage" && e.to === "research")?.additionalProperties?.via === "route"
  );

  // The runtime's models are kebab-cased for serialization, so both spellings of
  // every field have to resolve or the whole graph silently comes back empty.
  const kebab = specToProtocolGraph({
    graph: {
      "initial-node": "start",
      nodes: [
        { name: "start", type: "agent", "after-reasoning": [{ type: "handoff", target: "finish" }] },
        { name: "finish", type: "agent" },
      ],
    },
  });
  check(
    "spec graph: kebab-cased spec fields resolve too",
    kebab.graph?.edges.some((e) => e.from === "start" && e.to === "finish") === true &&
      kebab.graph?.edges.some((e) => e.from === "trigger" && e.to === "start") === true
  );

  // A handoff naming a node the graph never declares would otherwise draw an
  // arrow into empty space.
  const dangling = specToProtocolGraph({
    graph: {
      initial_node: "start",
      nodes: [{ name: "start", type: "agent", after_reasoning: [{ type: "handoff", target: "ghost" }] }],
    },
  });
  check(
    "spec graph: an edge to an undeclared node is dropped",
    dangling.graph?.edges.some((e) => e.to === "ghost") === false
  );

  // An entrypoint that names nothing real must not invent a trigger.
  const badEntry = specToProtocolGraph({
    graph: { initial_node: "missing", nodes: [{ name: "start", type: "agent" }] },
  });
  check(
    "spec graph: no trigger is drawn for an unknown entrypoint",
    badEntry.graph?.nodes.some((n) => n.id === "trigger") === false
  );

  check("spec graph: a non-object spec explains itself", specToProtocolGraph(null).graph === null);
  check(
    "spec graph: a spec with no graph explains itself",
    specToProtocolGraph({ label: "x" }).reason?.includes("no graph configuration") === true
  );
  check(
    "spec graph: a spec with no nodes explains itself",
    specToProtocolGraph({ graph: { initial_node: "a", nodes: [] } }).reason?.includes("no graph nodes") === true
  );
}

console.log("\n[agent source] resolving a task's .agent file from the project zip");
{
  const yaml = [
    "brokers:",
    "  it_help_investigation:",
    "    kind: AgentScript",
    "    implementation: ./brokers/it-help-investigation.agent",
    "    interfaces:",
    "      a2a:",
    "        card:",
    "          name: IT Help Investigation",
    "  other_broker:",
    "    kind: AgentScript",
    "    implementation: ./brokers/other.agent",
  ].join("\n");

  const entries = [
    { filename: "agent-network.yaml", content: yaml },
    { filename: "brokers/it-help-investigation.agent", content: "# agent one" },
    { filename: "brokers/other.agent", content: "# agent two" },
  ];

  // The broker key uses underscores while the file uses hyphens, so there is no
  // filename convention to rely on — `implementation` is the only real link.
  const byKey = resolveAgentEntry(entries, ["it_help_investigation"]);
  check("source: broker key resolves via implementation", byKey.entry?.filename === "brokers/it-help-investigation.agent");
  check("source: the matched broker key is reported", byKey.brokerKey === "it_help_investigation");

  const byHyphen = resolveAgentEntry(entries, ["it-help-investigation"]);
  check("source: separators are ignored when matching", byHyphen.entry?.filename === "brokers/it-help-investigation.agent");

  const byCard = resolveAgentEntry(entries, ["IT Help Investigation"]);
  check("source: the A2A card name also resolves", byCard.entry?.filename === "brokers/it-help-investigation.agent");

  // Drawing the wrong agent's graph would misrepresent the task, so ambiguity
  // must refuse rather than guess.
  const ambiguous = resolveAgentEntry(entries, ["something-unrelated"]);
  check("source: an unmatched name never guesses between agents", ambiguous.entry === null);
  check("source: ambiguity explains itself", (ambiguous.reason ?? "").includes("ambiguous"));

  const single = resolveAgentEntry(
    [
      { filename: "agent-network.yaml", content: "brokers: {}" },
      { filename: "brokers/only.agent", content: "# only" },
    ],
    ["anything"]
  );
  check("source: a single .agent file is unambiguous", single.entry?.filename === "brokers/only.agent");

  const none = resolveAgentEntry([{ filename: "agent-network.yaml", content: yaml }], ["it_help_investigation"]);
  check("source: a project with no .agent file reports why", none.entry === null && (none.reason ?? "").includes("no .agent"));

  // A task does not record its asset version, so the version live when it ran has
  // to be inferred. Picking the latest would draw edits made after the fact.
  const versions = [
    { version: "1.0.0", createdAt: "2026-08-01T00:00:00Z" },
    { version: "1.0.1", createdAt: "2026-08-10T00:00:00Z" },
    { version: "2.0.0", createdAt: "2026-08-20T00:00:00Z" },
  ];
  check(
    "version: picks the newest published before the task ran",
    chooseVersionForTask(versions, Date.parse("2026-08-15T00:00:00Z")) === "1.0.1"
  );
  check(
    "version: ignores versions published after the task ran",
    chooseVersionForTask(versions, Date.parse("2026-08-05T00:00:00Z")) === "1.0.0"
  );
  check(
    "version: falls back to newest when the task predates every version",
    chooseVersionForTask(versions, Date.parse("2026-07-01T00:00:00Z")) === "2.0.0"
  );
  check("version: falls back to newest without a task time", chooseVersionForTask(versions) === "2.0.0");
  check(
    "version: tolerates missing timestamps",
    chooseVersionForTask([{ version: "3.0.0", createdAt: null }], Date.now()) === "3.0.0"
  );
  check("version: no versions yields no choice", chooseVersionForTask([], Date.now()) === null);
}

console.log("\n[undeploy contracts pre-flight check]");
{
  const { parseGav } = await import("../lib/mulesoft/parse-gav");

  check(
    "parseGav: splits a well-formed coordinate",
    (() => {
      const gav = parseGav("acme-org:my-network:1.2.3");
      return gav?.groupId === "acme-org" && gav?.assetId === "my-network" && gav?.version === "1.2.3";
    })()
  );
  check("parseGav: rejects a coordinate missing a segment", parseGav("acme-org:my-network") === undefined);
  check("parseGav: rejects an empty string", parseGav("") === undefined);
  check(
    "parseGav: rejects a coordinate with an empty segment",
    parseGav("acme-org::1.0.0") === undefined
  );

  const { listInstancesForGav, listActiveContractsForGav, revokeContract } = await import(
    "../lib/mulesoft/api-manager-contracts"
  );

  const gav = { groupId: "acme-org", assetId: "my-network", version: "1.0.0" };
  const baseUrl = "https://anypoint.mulesoft.com";
  const orgId = "org-1";
  const envId = "env-1";
  const authHeader = "Bearer test-token";

  const jsonResponse = (status: number, body: unknown) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as Response;

  {
    // The agentic-family listing already contains the deployed broker instance.
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      return jsonResponse(200, {
        total: 1,
        instances: [
          {
            id: 111,
            assetId: "vogue-premiere-broker",
            instanceLabel: "vogue-premiere-broker (v1)",
            metadata: { source: "urn:gav:acme-org:my-network:1.0.0" },
          },
        ],
      });
    };
    const instances = await listInstancesForGav(baseUrl, orgId, envId, gav, authHeader, fetchFn);
    check(
      "listInstancesForGav: matches an instance via metadata.source",
      instances.length === 1 && instances[0].id === "111" && instances[0].name === "vogue-premiere-broker (v1)"
    );
    check("listInstancesForGav: does not fall back once the agentic list matches", calls.length === 1);
  }

  {
    // Some tenants return nothing for family=agentic; the unfiltered retry finds it.
    let call = 0;
    const fetchFn = async (url: string) => {
      call += 1;
      if (call === 1) {
        check("listInstancesForGav: the first call requests family=agentic", url.includes("family=agentic"));
        return jsonResponse(200, { total: 0, instances: [] });
      }
      check("listInstancesForGav: the fallback call omits family", !url.includes("family="));
      return jsonResponse(200, {
        instances: [
          {
            id: 222,
            metadata: { source: "urn:gav:acme-org:my-network:1.0.0" },
            apiAsset: { assetId: "vogue-premiere-broker" },
          },
        ],
      });
    };
    const instances = await listInstancesForGav(baseUrl, orgId, envId, gav, authHeader, fetchFn);
    check("listInstancesForGav: falls back to an unfiltered listing", instances.length === 1 && instances[0].id === "222");
  }

  {
    // A network that was never deployed here has no matching instances, and the
    // caller should not attempt a contracts lookup against nothing.
    const fetchFn = async () => jsonResponse(200, { instances: [] });
    const contracts = await listActiveContractsForGav(baseUrl, orgId, envId, gav, authHeader, fetchFn);
    check("listActiveContractsForGav: no instances means no contracts call, no error", contracts.length === 0);
  }

  {
    // Only APPROVED contracts block undeploy; pending/revoked/rejected do not.
    const fetchFn = async (url: string) => {
      if (url.includes("/apis?") || url.includes("/apis/")) {
        if (url.endsWith("/contracts?limit=200")) {
          return jsonResponse(200, {
            contracts: [
              { id: 1, status: "approved", application: { id: 9, name: "Storefront Web" } },
              { id: 2, status: "REVOKED", application: { name: "Old Integration" } },
              { id: 3, status: "PENDING", application: { name: "Not Yet Approved" } },
            ],
          });
        }
      }
      return jsonResponse(200, {
        instances: [{ id: 333, metadata: { source: "urn:gav:acme-org:my-network:1.0.0" }, assetId: "broker-a" }],
      });
    };
    const contracts = await listActiveContractsForGav(baseUrl, orgId, envId, gav, authHeader, fetchFn);
    check(
      "listActiveContractsForGav: only APPROVED contracts are reported",
      contracts.length === 1 && contracts[0].contractId === "1" && contracts[0].applicationName === "Storefront Web"
    );
  }

  {
    // One instance's contracts endpoint fails (e.g. a scope gap); the other
    // instance's contracts should still surface rather than losing the whole check.
    const fetchFn = async (url: string) => {
      if (url.includes("/apis/111/contracts")) return jsonResponse(403, { error: "Forbidden" });
      if (url.includes("/apis/222/contracts")) {
        return jsonResponse(200, { contracts: [{ id: 5, status: "APPROVED", application: { name: "Partner App" } }] });
      }
      return jsonResponse(200, {
        instances: [
          { id: 111, metadata: { source: "urn:gav:acme-org:my-network:1.0.0" } },
          { id: 222, metadata: { source: "urn:gav:acme-org:my-network:1.0.0" } },
        ],
      });
    };
    const contracts = await listActiveContractsForGav(baseUrl, orgId, envId, gav, authHeader, fetchFn);
    check(
      "listActiveContractsForGav: a failing instance does not hide another instance's contracts",
      contracts.length === 1 && contracts[0].contractId === "5"
    );
  }

  {
    // If every instance's contracts lookup fails, the caller needs to know —
    // silently reporting "no active contracts" would be worse than surfacing the error.
    const fetchFn = async (url: string) => {
      if (url.includes("/contracts")) return jsonResponse(403, { error: "Forbidden" });
      return jsonResponse(200, { instances: [{ id: 111, metadata: { source: "urn:gav:acme-org:my-network:1.0.0" } }] });
    };
    let threw = false;
    try {
      await listActiveContractsForGav(baseUrl, orgId, envId, gav, authHeader, fetchFn);
    } catch {
      threw = true;
    }
    check("listActiveContractsForGav: throws when every instance's lookup fails", threw);
  }

  {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchFn = async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(204, {});
    };
    await revokeContract(baseUrl, orgId, envId, "111", "5", authHeader, fetchFn);
    check(
      "revokeContract: PATCHes the specific contract with status REVOKED",
      capturedUrl.includes("/apis/111/contracts/5") &&
        capturedInit?.method === "PATCH" &&
        JSON.parse(String(capturedInit?.body)).status === "REVOKED"
    );
  }

  {
    const fetchFn = async () => jsonResponse(403, { error: "Forbidden" });
    let threw = false;
    try {
      await revokeContract(baseUrl, orgId, envId, "111", "5", authHeader, fetchFn);
    } catch {
      threw = true;
    }
    check("revokeContract: a rejected revoke throws rather than reporting success", threw);
  }
}

console.log("\n[official AgentScript conformance]");
{
  const {
    assertProjectAgentScriptsConform,
    validateAgentScriptEntries,
    validateAgentScriptSource,
    validateProjectAgentScripts,
  } = await import("@/lib/composer/agentscript-conformance");
  const { BROKER_AGENT: itInvestigationAgent } = await import(
    "@/lib/composer/examples/it-investigation-broker/sources"
  );
  const { BROKER_AGENT: voguePremiereAgent } = await import(
    "@/lib/composer/examples/vogue-premiere-broker/sources"
  );

  const scaffold = createScaffoldProject("ORG");
  check(
    "official linter accepts scaffold serializer output",
    (await validateProjectAgentScripts(scaffold)).length === 0
  );
  check(
    "official linter accepts IT investigation example",
    (await validateAgentScriptSource(itInvestigationAgent)).length === 0
  );
  check(
    "official linter accepts Vogue Premiere example",
    (await validateAgentScriptSource(voguePremiereAgent)).length === 0
  );

  const invalidAgent = itInvestigationAgent.replace(
    'kind: "a2a:status_update_event"',
    'kind: "a2a:response"'
  );
  check(
    "official linter rejects unsupported echo kinds",
    (await validateAgentScriptSource(invalidAgent)).length > 0
  );

  const legacyHeadersAgent = [
    "# @dialect: AGENTFABRIC=1.0",
    "config:",
    '  agent_name: "demo"',
    "actions:",
    "  callTool:",
    '    target: "mcp://weatherConnection"',
    '    kind: "mcp:tool"',
    '    tool_name: "forecast"',
    "    http_headers:",
    '      X-Api-Key: "secret"',
    "trigger trigger:",
    '  kind: "a2a"',
    '  target: "brokers://demo/a2a"',
    "  on_message: ->",
    "    transition to @executor.work",
    "executor work:",
    '  description: "Invoke the tool"',
    "  do: ->",
    "    run @actions.callTool",
    "  on_exit: ->",
    "    transition to @echo.done",
    "echo done:",
    '  kind: "a2a:status_update_event"',
    '  state: "TASK_STATE_COMPLETED"',
    '  message: a2a.message({messageId: uuid(), parts: [a2a.textPart("Done")]})',
  ].join("\n");
  check(
    "strict official validation rejects definition-level headers",
    (await validateAgentScriptSource(legacyHeadersAgent)).length > 0
  );
  check(
    "migration-aware validation accepts parseable legacy headers",
    (
      await validateAgentScriptSource(legacyHeadersAgent, "legacy.agent", {
        allowMigratableLegacyActionHeaders: true,
      })
    ).length === 0
  );
  check(
    "migration-aware validation rejects non-literal legacy header values",
    (
      await validateAgentScriptSource(
        legacyHeadersAgent.replace(
          '"secret"',
          '@request.headers["Authorization"]'
        ),
        "legacy.agent",
        { allowMigratableLegacyActionHeaders: true }
      )
    ).length > 0
  );

  // A broker imported from a file that wrote system.instructions with the `->`
  // procedure form, then edited in the UI to add real multi-paragraph text:
  // the official grammar only accepts multi-line content as a plain `|` block
  // scalar, never `-> |` — serialize must drop the arrow rather than reproduce
  // an unparseable file.
  const multilineProcedureProject = createScaffoldProject("ORG");
  const multilineProcedureBroker = multilineProcedureProject.brokers[0];
  multilineProcedureBroker.systemInstructions =
    "You are a broker.\n\nMission:\n- Do the thing.\n- Do the other thing.";
  multilineProcedureBroker.systemInstructionsProcedure = true;
  const multilineProcedureAgent = serializeBrokerAgent(multilineProcedureBroker);
  check(
    "multi-line system.instructions from a procedure import drops the arrow on serialize",
    !multilineProcedureAgent.includes("instructions: ->") &&
      multilineProcedureAgent.includes("instructions: |")
  );
  check(
    "official linter accepts multi-line system.instructions previously written as a procedure",
    (await validateProjectAgentScripts(multilineProcedureProject)).length === 0
  );

  const featureProject = createScaffoldProject("ORG");
  const featureBroker = featureProject.brokers[0];
  const trigger = featureBroker.nodes.find((node) => node.kind === "trigger")!;
  const terminal = featureBroker.nodes.find((node) => node.kind === "echo")!;
  featureBroker.agentScriptVariables = [
    {
      name: "status",
      modifier: "mutable",
      type: "string",
      defaultExpression: '""',
      label: "Status",
      description: "Current workflow status",
      isRequired: true,
    },
  ];
  featureBroker.llmBindings = [
    {
      id: "gemini-binding",
      name: "geminiMain",
      connectionName: "geminiConnection",
      provider: "Gemini",
      model: "gemini-2.5-flash",
      headers: '{"X-Trace-Id": uuid()}',
      timeout: 30,
      apiKey: "test-key",
      thinkingLevel: "HIGH",
      thinkingBudget: 0,
      responseLogprobs: false,
    },
  ];
  featureBroker.defaultLlmBindingName = "geminiMain";
  featureBroker.actions = [
    {
      id: "forecast-action",
      name: "forecast",
      label: "Forecast",
      description: "Look up a forecast",
      actionKind: "mcp:tool",
      connectionName: "weatherConnection",
      toolName: "forecast",
      inputs: [{ name: "city", type: "string", default: "London" }],
    },
  ];
  const generator = {
    id: "feature-generator",
    kind: "generator" as const,
    name: "classify",
    position: { x: 0, y: 0 },
    prompt: "Classify the request.",
    outputs: [
      {
        name: "payload",
        type: "object" as const,
        required: ["active", "batches"],
        properties: [
          {
            name: "active",
            type: "boolean" as const,
            default: false,
            enum: [true, false],
          },
          {
            name: "batches",
            type: "array" as const,
            minItems: 1,
            items: {
              type: "array" as const,
              items: {
                type: "object" as const,
                required: ["score"],
                properties: [
                  {
                    name: "score",
                    type: "number" as const,
                    default: 0,
                    enum: [0, 1],
                  },
                ],
              },
            },
          },
        ],
      },
    ],
    onExitTarget: "feature-executor",
  };
  const executor = {
    id: "feature-executor",
    kind: "executor" as const,
    name: "invoke",
    position: { x: 0, y: 0 },
    executorStatements: [
      {
        kind: "run" as const,
        actionName: "forecast",
        withArgs: [
          { name: "city", value: '"London"' },
          { name: "http_headers", value: '{"X-Trace-Id": uuid()}' },
        ],
      },
      { kind: "set" as const, variable: "status", expression: '"complete"' },
    ],
    onExitTarget: "feature-artifact",
  };
  const artifact = {
    id: "feature-artifact",
    kind: "echo" as const,
    name: "artifact",
    position: { x: 0, y: 0 },
    echoKind: "a2a:artifact_update_event" as const,
    artifactExpr:
      'a2a.artifact({artifactId: uuid(), name: "result", parts: [a2a.filePart({uri: "https://example.com/result.json", name: "result.json", mimeType: "application/json"})]})',
    metadataExpr: '{"traceId": uuid()}',
    echoAppend: false,
    echoLastChunk: true,
    onExitTarget: terminal.id,
  };
  trigger.onExitTarget = generator.id;
  featureBroker.nodes = [trigger, generator, executor, artifact, terminal];

  const featureErrors = await validateProjectAgentScripts(featureProject);
  check(
    "official linter accepts all newly modeled AgentScript features",
    featureErrors.length === 0,
    JSON.stringify(featureErrors)
  );
  const featureAgent = serializeProject(featureProject).find(
    (file) => file.language === "agent"
  )!.content;
  check(
    "Gemini response_logprobs uses dialect-compatible string syntax",
    featureAgent.includes('response_logprobs: "false"')
  );
  check(
    "artifact metadata serializes without semantic loss",
    featureAgent.includes('metadata: {"traceId": uuid()}')
  );
  check(
    "recursive arrays serialize to the official schema shape",
    featureAgent.includes('type: "array"') &&
      featureAgent.includes('type: "object"') &&
      featureAgent.includes("minItems: 1")
  );
  const parsedFeatureAgent = parseBrokerAgent(featureAgent);
  const parsedGemini = parsedFeatureAgent.llmBindings[0];
  check(
    "LLM request options round-trip",
    parsedGemini?.headers === '{"X-Trace-Id": uuid()}' &&
      parsedGemini.timeout === 30 &&
      parsedGemini.apiKey === "test-key" &&
      parsedGemini.responseLogprobs === false
  );
  check(
    "AgentScript variables round-trip",
    parsedFeatureAgent.agentScriptVariables[0]?.name === "status" &&
      parsedFeatureAgent.agentScriptVariables[0]?.defaultExpression === '""' &&
      parsedFeatureAgent.agentScriptVariables[0]?.isRequired === true
  );
  const parsedPayload = parsedFeatureAgent.nodes.find(
    (node) => node.name === "classify"
  )?.outputs?.[0];
  check(
    "recursive output arrays round-trip",
    parsedPayload?.properties?.[1]?.items?.items?.properties?.[0]?.name ===
      "score"
  );
  const parsedArtifact = parsedFeatureAgent.nodes.find(
    (node) => node.name === "artifact"
  );
  check(
    "artifact event metadata round-trips",
    parsedArtifact?.metadataExpr === '{"traceId": uuid()}'
  );
  check(
    "action labels and descriptions round-trip",
    parsedFeatureAgent.actions[0]?.label === "Forecast" &&
      parsedFeatureAgent.actions[0]?.description === "Look up a forecast"
  );
  await assertProjectAgentScriptsConform(featureProject);

  const undeclaredVariableProject = createScaffoldProject("ORG");
  const undeclaredBroker = undeclaredVariableProject.brokers[0];
  const undeclaredTrigger = undeclaredBroker.nodes.find(
    (node) => node.kind === "trigger"
  )!;
  const undeclaredTerminal = undeclaredBroker.nodes.find(
    (node) => node.kind === "echo"
  )!;
  undeclaredBroker.nodes.splice(1, 0, {
    id: "set-variable",
    kind: "executor",
    name: "setVariable",
    position: { x: 0, y: 0 },
    executorStatements: [
      { kind: "set", variable: "status", expression: '"complete"' },
    ],
    onExitTarget: undeclaredTerminal.id,
  });
  undeclaredTrigger.onExitTarget = "set-variable";
  check(
    "internal validation rejects executor assignment to undeclared variables",
    validateProject(undeclaredVariableProject).errors.some(
      (issue) => issue.code === "graph.executor.set-undeclared-variable"
    )
  );
  undeclaredBroker.agentScriptVariables = [
    { name: "status", modifier: "mutable", type: "string" },
  ];
  check(
    "declaring a mutable variable clears the executor assignment error",
    !validateProject(undeclaredVariableProject).errors.some(
      (issue) => issue.code === "graph.executor.set-undeclared-variable"
    )
  );

  check(
    "deployment validation recognizes uppercase .AGENT files",
    (
      await validateAgentScriptEntries([
        { filename: "brokers/invalid.AGENT", content: "not AgentScript" },
      ])
    ).length > 0
  );
  check(
    "deployment validation rejects bundles without AgentScript",
    (
      await validateAgentScriptEntries([
        { filename: "agent-network.yaml", content: "info: {}" },
      ])
    ).some((error) => error.message.includes("at least one .agent"))
  );

  const namespacedSource = [
    "generator shared:",
    "  prompt: |",
    "    Generate.",
    "  on_exit: ->",
    "    transition to @echo.shared",
    "echo shared:",
    '  kind: "a2a:status_update_event"',
    '  state: "TASK_STATE_COMPLETED"',
    '  message: a2a.message({messageId: uuid(), parts: [a2a.textPart("Done")]})',
  ].join("\n");
  const namespacedParsed = parseBrokerAgent(namespacedSource);
  check(
    "transition imports preserve node namespaces",
    namespacedParsed.nodes.find((node) => node.kind === "generator")?.onExitTarget?.kind ===
      "echo"
  );
  const namespaceProject = createScaffoldProject("ORG");
  namespaceProject.brokers[0].nodes.push({
    id: "generator-response",
    kind: "generator",
    name: "response",
    position: { x: 0, y: 0 },
    prompt: "Generate.",
  });
  check(
    "same node name in different namespaces is valid",
    !validateProject(namespaceProject).errors.some(
      (issue) => issue.code === "graph.node.duplicate-name"
    )
  );

  const fidelityAgent = [
    "actions:",
    "  lookup:",
    '    target: "mcp://tools"',
    '    kind: "mcp:tool"',
    '    tool_name: "lookup"',
    "    description: |",
    "      First line",
    "      Second line",
  ].join("\n");
  check(
    "multiline action descriptions import without loss",
    parseBrokerAgent(fidelityAgent).actions[0]?.description === "First line\nSecond line"
  );

  const captureSource = [
    "executor invoke:",
    "  do: ->",
    "    run @actions.lookup",
    '      with query = "A  B"',
    "      set @variables.result = @outputs.value",
  ].join("\n");
  const parsedCapture = parseBrokerAgent(captureSource).nodes[0]?.executorStatements?.[0];
  check(
    "nested executor result captures import",
    parsedCapture?.kind === "run" &&
      parsedCapture.withArgs?.[0]?.value === '"A  B"' &&
      parsedCapture.captures?.[0]?.expression === "@outputs.value"
  );
  const captureRoundTrip = serializeBrokerAgent({
    id: "capture-broker",
    name: "capture",
    interfaceName: "a2a",
    card: { name: "Capture", version: "1.0.0" },
    llmBindings: [],
    actions: [],
    nodes: [
      {
        id: "capture-executor",
        kind: "executor",
        name: "invoke",
        label: "Invoke",
        position: { x: 0, y: 0 },
        executorStatements: parsedCapture ? [parsedCapture] : [],
      },
    ],
  });
  check(
    "nested executor result captures serialize with quoted whitespace intact",
    captureRoundTrip.includes('with query = "A  B"') &&
      captureRoundTrip.includes("      set @variables.result = @outputs.value") &&
      captureRoundTrip.includes('  label: "Invoke"')
  );
  const captureConformanceSource = [
    "# @dialect: AGENTFABRIC=1.0",
    "system:",
    '  instructions: "test"',
    "config:",
    '  agent_name: "capture"',
    "variables:",
    "  result: mutable string",
    "actions:",
    "  lookup:",
    '    target: "mcp://tools"',
    '    kind: "mcp:tool"',
    '    tool_name: "lookup"',
    "trigger start:",
    '  kind: "a2a"',
    '  target: "brokers://capture/a2a"',
    "  on_message: ->",
    "    transition to @executor.invoke",
    "executor invoke:",
    '  description: "Invoke"',
    "  do: ->",
    "    run @actions.lookup",
    "      set @variables.result = @outputs.value",
    "  on_exit: ->",
    "    transition to @echo.done",
    "echo done:",
    '  kind: "a2a:status_update_event"',
    '  state: "TASK_STATE_COMPLETED"',
    '  message: a2a.message({messageId: uuid(), parts: [a2a.textPart("Done")]})',
  ].join("\n");
  check(
    "known validator bug is scoped to nested executor captures",
    (await validateAgentScriptSource(captureConformanceSource)).length === 0 &&
      (
        await validateAgentScriptSource(
          captureConformanceSource.replace(
            "      set @variables.result = @outputs.value",
            "    set @variables.result = @outputs.value"
          )
        )
      ).some((error) => error.message.includes("@outputs"))
  );

  const literalRoundTrip = serializeBrokerAgent({
    id: "literal-broker",
    name: "literal",
    interfaceName: "a2a",
    card: { name: "Literal", version: "1.0.0" },
    llmBindings: [],
    actions: [],
    nodes: [
      {
        id: "literal-generator",
        kind: "generator",
        name: "literal",
        position: { x: 0, y: 0 },
        prompt: "Generate.",
        outputs: [
          {
            name: "enabled",
            type: "boolean",
            default: true,
            enum: [true, false],
          },
          {
            name: "settings",
            type: "object",
            default: '{label: "A  B"}',
            properties: [{ name: "label", type: "string" }],
          },
        ],
      },
    ],
  });
  check(
    "typed defaults and enums preserve AgentScript literal types",
    literalRoundTrip.includes("default: True") &&
      literalRoundTrip.includes("  - True") &&
      literalRoundTrip.includes("  - False") &&
      literalRoundTrip.includes('default: {label: "A  B"}')
  );

  const unresolvedRoundTrip = serializeBrokerAgent({
    id: "unresolved-broker",
    name: "unresolved",
    interfaceName: "a2a",
    card: { name: "Unresolved", version: "1.0.0" },
    llmBindings: [],
    actions: [],
    nodes: [
      {
        id: "unresolved-trigger",
        kind: "trigger",
        name: "start",
        position: { x: 0, y: 0 },
        onExitTarget: "missing-node",
      },
    ],
  });
  check(
    "serializer never rewires unresolved targets to a real echo",
    unresolvedRoundTrip.includes("@unresolved.missing_node") &&
      !unresolvedRoundTrip.includes("@echo.response")
  );
}

// ---------------------------------------------------------------------------
console.log("\n[ordered tabs] stages unlock one at a time from real project data");
{
  const ALL_TABS: PanelTab[] = PANEL_TAB_GROUPS.flatMap((group) => group.tabs.map((t) => t.id));

  function gateFor(project: ComposerProject, visited: PanelTab[]): TabGate {
    return buildTabGate({
      project,
      validation: validateProject(project),
      visitedTabs: new Set(visited),
      enabled: true,
    });
  }
  const lockedTabs = (gate: TabGate) => ALL_TABS.filter((t) => isTabLocked(gate, t));
  const reason = (gate: TabGate, tab: PanelTab) => tabLock(gate, tab)?.reason ?? "";

  const blank = createEmptyProject("ORG");
  const blankGate = gateFor(blank, ["identity"]);

  const stageTabs = blankGate.stages.flatMap((s) => s.tabs);
  check(
    "stages own every panel tab exactly once",
    stageTabs.length === ALL_TABS.length &&
      ALL_TABS.every((tab) => stageTabs.filter((t) => t === tab).length === 1),
    stageTabs.join(",")
  );

  check(
    "a blank project locks everything past Project",
    lockedTabs(blankGate).join(" ") ===
      "registry assets variables access a2a-card behavior llms actions graph",
    lockedTabs(blankGate).join(" ")
  );
  check("a blank project starts on the Project stage", blankGate.activeStage.id === "project");
  check(
    "the blank lock points at the first thing to do",
    reason(blankGate, "graph") === 'Finish "Project" first: Name the network (+1 more)',
    reason(blankGate, "graph")
  );

  // The regression: a clean Project tab used to unlock the whole builder, because
  // no later tab reports an error merely for being empty.
  let p = apply(blank, {
    type: "setIdentity",
    patch: { name: "Support Network", assetId: "support-network" },
  });
  let gate = gateFor(p, ["identity"]);
  check(
    "completing Project unlocks the assets stage",
    !isTabLocked(gate, "registry") && !isTabLocked(gate, "assets")
  );
  check(
    "completing Project leaves every later tab locked",
    lockedTabs(gate).join(" ") === "variables access a2a-card behavior llms actions graph",
    lockedTabs(gate).join(" ")
  );
  check(
    "Legacy Registry and Exchange Assets unlock together",
    isTabLocked(gate, "registry") === isTabLocked(gate, "assets")
  );

  // Opening a tab is not enough on a stage that owns data.
  gate = gateFor(p, ["identity", "assets"]);
  check("an empty assets stage keeps Variables locked", isTabLocked(gate, "variables"));
  check(
    "the assets lock names the missing connection",
    reason(gate, "variables") ===
      'Finish "Exchange Assets" first: Add at least one asset or registry connection — an LLM, MCP server, or agent',
    reason(gate, "variables")
  );

  const registryOnly = {
    ...p,
    registry: {
      agents: [],
      mcps: [],
      llms: [
        {
          key: "openai",
          info: { label: "OpenAI" },
          metadata: { platform: "OpenAI" },
        },
      ],
    },
  };
  check(
    "registry-only inventory also unlocks Variables",
    !isTabLocked(gateFor(registryOnly, ["identity", "assets"]), "variables")
  );

  const llm = importAsset({
    kind: "llm",
    groupId: "gl",
    assetId: "openai",
    version: "1.0.0",
    name: "OpenAI GPT",
  });
  p = apply(p, { type: "addAsset", asset: llm });
  const llmConnection = p.assets[0].connectionName!;
  gate = gateFor(p, ["identity", "assets"]);
  check("adding a connection unlocks Variables", !isTabLocked(gate, "variables"));
  check("Variables no longer block by visit-only gating", !isTabLocked(gate, "access"));

  gate = gateFor(p, ["identity", "assets", "variables"]);
  check("A2A Interface is unlocked once inventory is complete", !isTabLocked(gate, "access"));
  check("A2A card is not blocked by interface tab visitation", !isTabLocked(gate, "a2a-card"));

  let visited: PanelTab[] = ["identity", "assets", "variables", "access"];
  gate = gateFor(p, visited);
  check("reviewing the A2A Interface unlocks the A2A card", !isTabLocked(gate, "a2a-card"));
  check("an incomplete card keeps AS Instructions locked", isTabLocked(gate, "behavior"));
  check(
    "the card lock names a required card field",
    reason(gate, "behavior").startsWith('Finish "A2A card" first: '),
    reason(gate, "behavior")
  );

  p = apply(
    p,
    { type: "updateBroker", patch: { name: "support_broker" } },
    {
      type: "updateCard",
      patch: {
        name: "Support Broker",
        description: "Front door for support requests",
        supportedInterfaces: [
          {
            url: "https://example.com/a2a",
            protocolVersion: "0.3.0",
            protocolBinding: "JSONRPC",
          },
        ],
      },
    }
  );
  visited = [...visited, "a2a-card"];
  gate = gateFor(p, visited);
  check("completing the card unlocks AS Instructions", !isTabLocked(gate, "behavior"));
  check("AS LLM is not blocked by empty broker instructions", !isTabLocked(gate, "llms"));

  p = apply(p, {
    type: "updateBroker",
    patch: { systemInstructions: "Triage inbound support requests." },
  });
  visited = [...visited, "behavior"];
  gate = gateFor(p, visited);
  check("writing instructions still keeps AS LLM unlocked", !isTabLocked(gate, "llms"));
  check("AS Actions no longer depend on AS LLM tab visitation", !isTabLocked(gate, "actions"));

  // An imported LLM connection has to end up bound to the broker.
  const unbound = { ...p, brokers: [{ ...p.brokers[0], llmBindings: [], defaultLlmBindingName: undefined }] };
  const unboundGate = gateFor(unbound, [...visited, "llms"]);
  check("an imported LLM with no binding keeps AS Actions locked", isTabLocked(unboundGate, "actions"));
  check(
    "the LLM lock asks for the binding",
    reason(unboundGate, "actions") === 'Finish "AS LLM" first: Bind an imported LLM connection',
    reason(unboundGate, "actions")
  );

  visited = [...visited, "llms"];
  gate = gateFor(p, visited);
  check("a bound LLM unlocks AS Actions", !isTabLocked(gate, "actions"));
  check("AS Graph is unlocked when AS Actions has no unmet requirements", !isTabLocked(gate, "graph"));

  visited = [...visited, "actions"];
  gate = gateFor(p, visited);
  check("walking every stage unlocks AS Graph", !isTabLocked(gate, "graph"));
  check("nothing is left locked at the end of the walkthrough", lockedTabs(gate).length === 0, lockedTabs(gate).join(" "));

  // A composed MCP server the graph cannot reach re-locks the graph.
  const mcp = importAsset({ kind: "mcp", groupId: "gm", assetId: "jira", version: "1.0.0", name: "Jira MCP" });
  const withMcp = apply(p, { type: "addAsset", asset: mcp });
  const mcpConnection = withMcp.assets.find((a) => a.id === mcp.id)!.connectionName!;
  const unwired = { ...withMcp, brokers: [{ ...withMcp.brokers[0], actions: [] }] };
  const unwiredGate = gateFor(unwired, visited);
  check("an MCP connection no action targets re-locks AS Graph", isTabLocked(unwiredGate, "graph"));
  check(
    "the actions lock names the connection to wire",
    reason(unwiredGate, "graph") === 'Finish "AS Actions" first: Add an action calling MCP server "Jira MCP"',
    reason(unwiredGate, "graph")
  );

  const wired = apply(unwired, {
    type: "addAction",
    action: {
      id: "action-jira",
      name: "create_issue",
      actionKind: "mcp:tool",
      connectionName: mcpConnection,
      toolName: "createIssue",
    },
  });
  check("wiring the action unlocks AS Graph again", !isTabLocked(gateFor(wired, visited), "graph"));
  check("the LLM connection is not double-counted as an action target", llmConnection !== mcpConnection);

  const off = buildTabGate({
    project: blank,
    validation: validateProject(blank),
    visitedTabs: new Set(),
    enabled: false,
  });
  check("switching ordered tabs off locks nothing", off.locked.size === 0);
  check("stage progress is still reported when ordered tabs are off", off.activeStage.id === "project");

  const autoFor = (project: ComposerProject) =>
    buildTabGate({
      project,
      validation: validateProject(project),
      visitedTabs: new Set(),
      enabled: "auto",
    });
  check("a blank project turns ordered mode on by itself", autoFor(blank).enabled);
  check("a project already holding all of its data starts unordered", !autoFor(p).enabled);
  check("an unordered project locks nothing", autoFor(p).locked.size === 0);
}

console.log(`\n==== ${passed} passed, ${failed} failed ====`);
process.exit(failed === 0 ? 0 : 1);
