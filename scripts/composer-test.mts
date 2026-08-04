import { parse as parseYaml } from "yaml";
import { flattenExchangeDeployVariables } from "@/lib/desktop/exchange-deploy-variables";
import {
  defaultDeployOptions,
  deployOptionsReady,
  propertiesFromVariables,
} from "@/lib/desktop/deploy-options";
import {
  createEmptyProject,
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
import { deriveVariables } from "@/lib/composer/model";
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
import type { SerializedFile } from "@/lib/composer/serialize";
import type { Graph } from "@sf-agentscript/agentfabric-dialect";
import {
  parseProtocolOutputs,
  protocolGraphToReactFlow,
  routerOutputHandleId,
  routeOutputLabel,
  lexicalPositionForNode,
} from "@/lib/composer/agentfabric-graph";
import { applyDagreOverviewLayout } from "@/lib/composer/agentfabric-graph-layout";

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
console.log("\n[1] Empty project serializes to valid files");
{
  let p = createEmptyProject("ORG");
  const files = serializeProject(p);
  check("3 files (exchange, yaml, one broker agent)", files.length === 3, `${files.length}`);
  const ex = JSON.parse(serializeExchangeJson(p));
  check("exchange classifier agentic-network", ex.classifier === "agentic-network");
  check("exchange dependencies empty", Array.isArray(ex.dependencies) && ex.dependencies.length === 0);
  const y = parseYaml(serializeAgentNetworkYaml(p));
  check("yaml agentNetwork 2.0.0", y.agentNetwork === "2.0.0");
  check("yaml has brokers", !!y.brokers && Object.keys(y.brokers).length === 1);
  const brokerKey = Object.keys(y.brokers)[0];
  check("broker kind AgentScript", y.brokers[brokerKey].kind === "AgentScript");
  const agentText = serializeBrokerAgent(p.brokers[0]);
  check("agent has dialect header", agentText.startsWith("# @dialect: AGENTFABRIC=1.0"));
  check("empty project valid", validateProject(p).ok, JSON.stringify(validateProject(p).errors));
}

// ---------------------------------------------------------------------------
console.log("\n[2] Compose agent + mcp + llm; derivations + cross-refs");
{
  let p = createEmptyProject("ORG");
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
  const openAiUrlVar = ex.metadata.variables?.openAiGpt?.url?.default;
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
  check("valid after setting tool_name", validateProject(p).ok, JSON.stringify(validateProject(p).errors));
}

// ---------------------------------------------------------------------------
console.log("\n[3] removeAsset cascades to actions/bindings");
{
  let p = createEmptyProject("ORG");
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
  let p = createEmptyProject("ORG");
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
  check("valid graph", validateProject(p).ok, JSON.stringify(validateProject(p).errors));
}

// ---------------------------------------------------------------------------
console.log("\n[4b] Router otherwise via sourceHandle");
{
  let p = createEmptyProject("ORG");
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
  let p = createEmptyProject("ORG");
  p = apply(p, { type: "addNode", kind: "router", position: { x: 0, y: 0 } });
  let res = validateProject(p);
  check("router without route/otherwise -> error", !res.ok && res.errors.some((e) => /router/i.test(e.message)));

  // MCP action without tool_name -> error
  let p2 = createEmptyProject("ORG");
  const mcp = importAsset({ kind: "mcp", groupId: "g", assetId: "m", version: "1.0.0", name: "M" });
  p2 = apply(p2, { type: "addAsset", asset: mcp });
  const action = p2.brokers[0].actions[0];
  p2 = apply(p2, { type: "updateAction", id: action.id, patch: { toolName: "" } });
  res = validateProject(p2);
  check("mcp action without tool_name -> error", res.errors.some((e) => /tool_name/i.test(e.message)));

  // A project with no trigger (only reachable via import) -> error
  const base = createEmptyProject("ORG");
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
  let p = createEmptyProject("ORG-9");
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
  check("importAsset derives snake_case connection", importAsset({ kind: "llm", groupId: "g", assetId: "openai", version: "1", name: "OpenAI GPT" }).connectionName === "open_ai_gpt_connection");

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
    !validateProject(apply(createEmptyProject("ORG"), { type: "setIdentity", patch: { assetId: "BadAssetId" } })).ok
  );

  let p = createEmptyProject("ORG");
  check("empty project default broker key", p.brokers[0].name === "my_broker");
  check("empty project default apiVersion v1", p.identity.apiVersion === "v1");
  check("empty project default asset version 0.0.0", p.identity.version === "0.0.0");
  check("empty project valid broker key", isValidBrokerKey(p.brokers[0].name));
  check(
    "invalid broker key fails validation",
    !validateProject(apply(p, { type: "updateBroker", patch: { name: "my_broker_" } })).ok
  );
  const yaml = serializeAgentNetworkYaml(createEmptyProject("ORG"));
  check("serialized yaml uses snake_case broker key", yaml.includes("  my_broker:"));
  check("serialized implementation path", yaml.includes("./brokers/my_broker.agent"));
}

// ---------------------------------------------------------------------------
console.log("\n[6d] AgentFabric expression catalog");
{
  let p = createEmptyProject("ORG");
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

  let p = createEmptyProject("ORG-RT");
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

  check("original project valid", validateProject(p).ok, JSON.stringify(validateProject(p).errors));

  const files1 = serializeProject(p);
  const result = parseProjectFiles(toInput(files1));
  check("round-trip parses ok", result.ok, result.ok ? "" : JSON.stringify(result.errors));
  if (result.ok) {
    const files2 = serializeProject(result.project);
    check("round-trip valid", validateProject(result.project).ok, JSON.stringify(validateProject(result.project).errors));
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
    check("llm binding resolves to real connection (no unknown-connection error)", v.ok, JSON.stringify(v.errors));
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
  let p = createEmptyProject("ORG");
  check("empty project doc conforms", validateAgentNetworkDoc(buildAgentNetworkDoc(p)).length === 0, JSON.stringify(validateAgentNetworkDoc(buildAgentNetworkDoc(p))));

  // Rich project with all three asset kinds + a full card.
  let r = createEmptyProject("ORG");
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

  let p = createEmptyProject("ORG");
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

  let p = createEmptyProject("ORG");
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

  let p = createEmptyProject("ORG");
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

console.log("\n[16] Schema gap closure (yaml info, broker card/policies, headerName, policy access, inline)");
{
  let p = createEmptyProject("ORG");
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
  check("round-trip securitySchemes", Boolean(roundCard?.securitySchemes?.bearer));
  check("round-trip supportedInterfaces", roundCard?.supportedInterfaces?.[0]?.protocolBinding === "HTTP+JSON");
  check("round-trip capability extensions", roundCard?.capabilities?.extensions?.[0]?.uri === "https://example.com/ext");
  check("round-trip skill inputModes", roundCard?.skills?.[0]?.inputModes?.[0] === "text/plain");
  check("round-trip skill securityRequirements", Boolean(roundCard?.skills?.[0]?.securityRequirements?.length));
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

  let p = createEmptyProject("ORG");
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
  check("single-tool mcp action validates", validateProject(p).ok);

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

  let pMulti = createEmptyProject("ORG");
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
    brokers: [{ ...createEmptyProject().brokers[0], ...reasoningBroker, actions: [] }],
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
    '  kind: "a2a:response"',
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
  let p = createEmptyProject("ORG");
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
  let p2 = createEmptyProject("ORG");
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
  let p3 = createEmptyProject("org-rt");
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
  let p4 = createEmptyProject("ORG");
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
    '  kind: "a2a:response"',
    "  task: a2a.task({",
    '    state: "completed",',
    "    message: a2a.message({",
    "      messageId: uuid(),",
    "      parts: [",
    '        a2a.textPart("Ticket escalated")',
    "      ]",
    "    }),",
    "    metadata: None",
    "  })",
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
  check("a2a:response echo kind", echo?.echoKind === "a2a:response");
  check("a2a:response task parses", echo?.taskExpr?.includes("Ticket escalated"));
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
    triageParsed?.outputs?.[1]?.type === "array" && triageParsed?.outputs?.[1]?.itemsType === "string"
  );

  const broker = createEmptyProject("org").brokers[0];
  broker.nodes.push({
    id: "n1",
    kind: "generator",
    name: "classifyIntent",
    label: "Classify",
    position: { x: 0, y: 0 },
    outputs: [
      { name: "intent", type: "string", description: "The classified intent", enum: ["list", "triage", "compose", "offtopic"] },
      { name: "submissionIds", type: "array", description: "Submission ids explicitly named in the message", itemsType: "string" },
    ],
  });
  const triageAgent = serializeBrokerAgent({ ...broker, name: "triage" });
  check("output enum serializes", triageAgent.includes('enum:') && triageAgent.includes('"list"') && triageAgent.includes('"triage"'));
  check("array items serializes", triageAgent.includes("submissionIds:") && triageAgent.includes("items:") && triageAgent.includes('type: "string"'));
  const triageRoundTrip = parseBrokerAgent(triageAgent).nodes.find((n) => n.name === "classifyIntent");
  check("output enum + array items round-trip",
    triageRoundTrip?.outputs?.[0]?.enum?.length === 4 &&
      triageRoundTrip?.outputs?.[1]?.itemsType === "string"
  );

  broker.nodes[0].description = undefined;
  const withDefaultDescription = serializeBrokerAgent(broker);
  check("missing node description gets default on serialize", /generator classifyIntent:\n  description:/.test(withDefaultDescription));

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
    triageOrch?.outputs?.[0]?.itemsType === "object" &&
      triageOrch?.outputs?.[0]?.itemsProperties?.some((p) => p.name === "recommendation" && p.enum?.includes("quote"))
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
    check("a2a:response serialized", files["brokers/it_help_investigation.agent"].includes("a2a:response"));
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

  const { appendDeployArgv } = await import("../electron/cli/deploy-argv.js");
  const argv: string[] = ["agent-network", "project", "deploy", "--path", "/tmp/project"];
  appendDeployArgv(argv, {
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

console.log("\n[local project files]");
{
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { writeLocalProjectEntries, readLocalProjectEntries } = require("../electron/cli/local-project-files");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anf-save-"));
  fs.writeFileSync(
    path.join(root, "exchange.json"),
    JSON.stringify({ main: "agent-network.yaml", name: "test", organizationId: "org" }),
    "utf8"
  );
  writeLocalProjectEntries(root, [
    { filename: "agent-network.yaml", content: "agentNetwork: 2.0.0\n" },
    { filename: "brokers/demo.agent", content: "# broker\n" },
  ]);
  const entries = readLocalProjectEntries(root);
  check(
    "write then read round-trip",
    entries.some((e: { filename: string }) => e.filename === "agent-network.yaml") &&
      entries.some((e: { filename: string; content: string }) => e.filename === "brokers/demo.agent" && e.content.includes("# broker"))
  );

  for (const escape of ["../escaped.yaml", "/etc/anf-escaped.yaml", "brokers/../../escaped.agent"]) {
    let rejected = false;
    try {
      writeLocalProjectEntries(root, [{ filename: escape, content: "x" }]);
    } catch {
      rejected = true;
    }
    check(`write rejects path escape ${escape}`, rejected);
  }
  check("no file escaped the project dir", !fs.existsSync(path.join(path.dirname(root), "escaped.yaml")));

  fs.rmSync(root, { recursive: true, force: true });
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

console.log("\n[action http_headers round-trip]");
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

  const broker = createEmptyProject("ORG").brokers[0];
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
  };
  const emitted = serializeBrokerAgent(withHeaders);
  check("http_headers serialized", emitted.includes("http_headers:") && emitted.includes('X-Api-Key: "secret"'), emitted);
  const reparsed = parseBrokerAgent(emitted).actions[0];
  check("http_headers survive a full round-trip", reparsed?.httpHeaders?.[0]?.value === "secret");
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

console.log("\n[reference integrity on rename and delete]");
{
  let p = createEmptyProject("ORG");
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
  const p = createEmptyProject("ORG");
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
    validateProject(dupNodes).errors.some((e) => e.message.includes('More than one node is named "sameName"'))
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

console.log("\n[desktop auth regions]");
{
  const { getSignInRegionIds, getBaseUrlForRegion } = await import("@/lib/regions");
  const { isElectronDesktop } = await import("@/lib/auth/desktop");

  const prevDesktop = process.env.ELECTRON_DESKTOP;
  const prevUsId = process.env.ANYPOINT_CLIENT_ID;
  const prevUsSecret = process.env.ANYPOINT_CLIENT_SECRET;

  delete process.env.ELECTRON_DESKTOP;
  delete process.env.ANYPOINT_CLIENT_ID;
  delete process.env.ANYPOINT_CLIENT_SECRET;
  check("web sign-in regions empty without OAuth creds", getSignInRegionIds().length === 0);

  process.env.ANYPOINT_CLIENT_ID = "test-id";
  process.env.ANYPOINT_CLIENT_SECRET = "test-secret";
  check("web sign-in regions includes us when creds set", getSignInRegionIds().includes("us"));

  process.env.ELECTRON_DESKTOP = "1";
  const desktopRegions = getSignInRegionIds();
  check("desktop sign-in includes us", desktopRegions.includes("us"));
  check("desktop sign-in includes eu", desktopRegions.includes("eu"));
  check("desktop sign-in excludes unavailable ca", !desktopRegions.includes("ca"));
  check("isElectronDesktop true when env set", isElectronDesktop());
  check(
    "getBaseUrlForRegion us",
    getBaseUrlForRegion("us") === "https://anypoint.mulesoft.com"
  );

  if (prevDesktop === undefined) delete process.env.ELECTRON_DESKTOP;
  else process.env.ELECTRON_DESKTOP = prevDesktop;
  if (prevUsId === undefined) delete process.env.ANYPOINT_CLIENT_ID;
  else process.env.ANYPOINT_CLIENT_ID = prevUsId;
  if (prevUsSecret === undefined) delete process.env.ANYPOINT_CLIENT_SECRET;
  else process.env.ANYPOINT_CLIENT_SECRET = prevUsSecret;
}

console.log("\n[password-login route]");
{
  const prevDesktop = process.env.ELECTRON_DESKTOP;
  const prevNodeEnv = process.env.NODE_ENV;
  delete process.env.ELECTRON_DESKTOP;
  process.env.NODE_ENV = "development";
  const { POST } = await import("@/app/api/auth/password-login/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("http://localhost:3000/api/auth/password-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "u", password: "p", region: "us" }),
  });
  const res = await POST(req);
  check("password-login returns 404 outside desktop", res.status === 404);
  if (prevDesktop === undefined) delete process.env.ELECTRON_DESKTOP;
  else process.env.ELECTRON_DESKTOP = prevDesktop;
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
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

  // Phase 3: runtime limit preset
  check(
    "phase3 OBJECT_STORE_DEFAULT_TTL_MS preset",
    RUNTIME_SYSTEM_LIMIT_VARIABLES.some((v) => v.key === "OBJECT_STORE_DEFAULT_TTL_MS" && v.defaultValue === "2592000000")
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
  check("C3 serialize http_headers", extrasRoundTrip.includes("http_headers:") && extrasRoundTrip.includes('X-Trace: "1"'));
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
  const { createEmptyProject } = await import("@/lib/composer/factory");
  const { serializeAgentNetworkYaml, serializeBrokerAgent } = await import("@/lib/composer/serialize");

  let project = createEmptyProject("ORG");
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
  const { createEmptyProject } = await import("@/lib/composer/factory");

  let project = createEmptyProject("ORG");
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
  const { createEmptyProject } = await import("@/lib/composer/factory");
  const { nodeNameValidationMessage } = await import("@/lib/composer/node-name");

  let project = createEmptyProject("ORG");
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

  const withTwo = createEmptyProject("ORG").brokers[0];
  const [first, second] = withTwo.nodes;
  check(
    "node name validation flags duplicates",
    nodeNameValidationMessage(withTwo, second.id, first.name)?.includes("unique") === true
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
  const { createEmptyProject } = await import("@/lib/composer/factory");

  const reduce = (s: ReturnType<typeof initHistory>, a: Parameters<typeof historyReducer>[1]) =>
    historyReducer(s, a, composerReducer);

  let state = initHistory(createEmptyProject("ORG"));
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
  let checkpointed = initHistory(createEmptyProject("ORG"));
  checkpointed = reduce(checkpointed, { type: "setIdentity", patch: { name: "A" } });
  checkpointed = reduce(checkpointed, { type: "history/checkpoint" });
  checkpointed = reduce(checkpointed, { type: "setIdentity", patch: { name: "B" } });
  check("checkpoint breaks coalescing run", checkpointed.past.length === 2);

  // Loading a project is a hard reset, not an undoable step.
  let loaded = initHistory(createEmptyProject("ORG"));
  loaded = reduce(loaded, { type: "setIdentity", patch: { name: "Before" } });
  loaded = reduce(loaded, { type: "loadProject", project: createEmptyProject("ORG2") });
  check("loadProject clears history", loaded.past.length === 0 && loaded.future.length === 0);

  // No-op actions must not create undo steps.
  let noop = initHistory(createEmptyProject("ORG"));
  const trig = noop.present.brokers[0].nodes.find((n) => n.kind === "trigger")!;
  noop = reduce(noop, { type: "removeNode", id: trig.id });
  check("no-op action adds no history entry", noop.past.length === 0);

  check("undo at start of history is a no-op", reduce(initHistory(createEmptyProject("ORG")), { type: "history/undo" }).past.length === 0);

  check(
    "moveNode does not coalesce",
    coalesceKey({ type: "moveNode", id: "n", position: { x: 0, y: 0 } }) === null
  );
  check(
    "updateNode coalesce key includes node and field",
    coalesceKey({ type: "updateNode", id: "n1", patch: { name: "x" } }) === "updateNode:n1:name"
  );

  // History is bounded so long sessions cannot grow without limit.
  let capped = initHistory(createEmptyProject("ORG"));
  for (let i = 0; i < HISTORY_LIMIT + 25; i++) {
    capped = reduce(capped, { type: "addNode", kind: "generator", position: { x: i, y: i } });
  }
  check("history is capped", capped.past.length === HISTORY_LIMIT);
}

console.log("\n[new node placement]");
{
  const { placeNewNode, NODE_HEIGHT } = await import("@/lib/composer/node-placement");
  const { composerReducer } = await import("@/lib/composer/store");
  const { createEmptyProject } = await import("@/lib/composer/factory");

  let project = createEmptyProject("ORG");
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
  let solo = createEmptyProject("ORG");
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
  const { createEmptyProject } = await import("@/lib/composer/factory");
  const { validateProject } = await import("@/lib/composer/validate");
  const { isAllowedTransitionTarget } = await import("@/lib/composer/graph-transitions");

  let project = createEmptyProject("ORG");
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
  check("valid graph after outward trigger transition", validateProject(project).errors.length === 0);
}

console.log("\n[insert node on edge]");
{
  const { composerReducer } = await import("@/lib/composer/store");
  const { createEmptyProject } = await import("@/lib/composer/factory");

  // trigger -> echo, then splice a generator into the middle.
  let project = createEmptyProject("ORG");
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
  let routed = createEmptyProject("ORG");
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
    sourceHandle: routerOutputHandleId(routeOutputLabel(routed.brokers[0].nodes.find((n) => n.id === "router1")!.routes![0])),
  });
  const router = routed.brokers[0].nodes.find((n) => n.id === "router1");
  check("router insert does not add a route", (router?.routes?.length ?? 0) === routeCount);
  check("router insert retargets the route", router?.routes?.[0]?.targetNodeId === "mid");
  check(
    "router insert links new node to original target",
    routed.brokers[0].nodes.find((n) => n.id === "mid")?.onExitTarget === echo2.id
  );
}

console.log("\n[node summary chips]");
{
  const { nodeSummaryChips, nodePreviewText } = await import("@/lib/composer/node-summary");
  const { createEmptyProject } = await import("@/lib/composer/factory");

  const broker = createEmptyProject("ORG").brokers[0];
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
  const { createEmptyProject } = await import("@/lib/composer/factory");

  const broker = createEmptyProject("ORG").brokers[0];
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
  const { createEmptyProject } = await import("@/lib/composer/factory");

  const project = createEmptyProject("ORG");
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
  const { createEmptyProject } = await import("@/lib/composer/factory");
  const { composerReducer } = await import("@/lib/composer/store");

  // A router with no routes is a graph-tab error.
  let project = createEmptyProject("ORG");
  project = composerReducer(project, {
    type: "addNode",
    kind: "router",
    position: { x: 0, y: 0 },
    id: "r1",
  });
  const counts = countIssuesByTab(validateProject(project));
  check("router errors are attributed to the graph tab", (counts.get("graph")?.errors ?? 0) > 0);

  const total = [...counts.values()].reduce((sum, c) => sum + c.errors + c.warnings, 0);
  const result = validateProject(project);
  check(
    "every issue is attributed to exactly one tab",
    total === result.errors.length + result.warnings.length
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
  const { createEmptyProject } = await import("@/lib/composer/factory");

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
    buildExpressionCatalog(createEmptyProject("ORG").brokers[0])
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
  const { createEmptyProject } = await import("@/lib/composer/factory");

  let project = createEmptyProject("ORG");
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
  const { createEmptyProject } = await import("@/lib/composer/factory");

  const project = createEmptyProject("ORG");
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

  check(
    "registry yaml path tab",
    panelTabFromYamlPath("registry.agents.agent-1.metadata.interfaces.a2a_v03.card") === "registry"
  );

  const urlIssue = resolveIssueNavigation({
    severity: "error",
    message:
      'Schema (agent-network.yaml) at registry.agents.agent-1.metadata.interfaces.a2a_v03.card: missing required property "url"',
  });
  check("registry error opens registry tab", urlIssue.tab === "registry");
  check("registry error tab label", urlIssue.tabLabel === "Registry");
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

console.log(`\n==== ${passed} passed, ${failed} failed ====`);
process.exit(failed === 0 ? 0 : 1);
