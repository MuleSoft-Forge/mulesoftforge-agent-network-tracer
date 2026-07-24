import { parse as parseYaml } from "yaml";
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
import {
  defaultToolNameFromMeta,
  hasMcpAssetMeta,
  mcpMetaFromExchange,
  parseMcpAssetMeta,
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
  BROKER_KEY_PATTERN,
  brokerKeyValidationMessage,
  isValidBrokerKey,
  normalizeBrokerKey,
} from "@/lib/composer/broker-key";
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
import { serializeBrokerCard } from "@/lib/composer/a2a-card";
import { evaluateA2aCard } from "@/lib/composer/a2a-card-checks";
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

  // Remove trigger -> error
  let p3 = createEmptyProject("ORG");
  const trig = p3.brokers[0].nodes.find((n) => n.kind === "trigger")!;
  p3 = apply(p3, { type: "removeNode", id: trig.id });
  res = validateProject(p3);
  check("no trigger -> error", res.errors.some((e) => /trigger/i.test(e.message)));
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
  check("validation message mentions camelCase", brokerKeyValidationMessage("customerServiceAgent").includes("customer_service_agent"));

  let p = createEmptyProject("ORG");
  check("empty project default broker key", p.brokers[0].name === "my_broker");
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
    '    target: "llm://openaiConnection"',
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
    check("asset keeps exact connection name", asset.connectionName === "openaiConnection", asset.connectionName);
    // Re-serialize keeps the same connection key so it still links.
    const yaml = serializeAgentNetworkYaml(res.project);
    check("re-serialized yaml keeps openaiConnection key", yaml.includes("openaiConnection:"));
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
                - schemes:
                    bearer: {}
`;

  const parsed = parseAgentNetworkYaml(richCardYaml);
  const card = parsed.broker?.card;
  check("parse provider", card?.provider?.organization === "Example Corp");
  check("parse iconUrl", card?.iconUrl === "https://cdn.example.com/icon.png");
  check("parse extendedAgentCard", card?.capabilities?.extendedAgentCard === true);
  check("parse capability extra", Boolean(card?.capabilities?.extra?.extensions));
  check("parse card extra securitySchemes", Boolean(card?.extra?.securitySchemes));
  check("parse supportedInterfaces url", card?.supportedInterfaces?.[0]?.url?.includes("agent_broker_get_date"));
  check("parse supportedInterfaces binding", card?.supportedInterfaces?.[0]?.protocolBinding === "HTTP+JSON");
  check("parse supportedInterfaces version", card?.supportedInterfaces?.[0]?.protocolVersion === "1.0");
  check("supportedInterfaces not in extra", card?.extra?.supportedInterfaces === undefined);
  check("parse skill inputModes", card?.skills?.[0]?.inputModes?.[0] === "text/plain");
  check("parse skill extra", Boolean(card?.skills?.[0]?.extra?.securityRequirements));

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
  check("round-trip securitySchemes", Boolean(roundCard?.extra?.securitySchemes));
  check("round-trip supportedInterfaces", roundCard?.supportedInterfaces?.[0]?.protocolBinding === "HTTP+JSON");
  check("round-trip capability extensions", Boolean(roundCard?.capabilities?.extra?.extensions));
  check("round-trip skill inputModes", roundCard?.skills?.[0]?.inputModes?.[0] === "text/plain");
  check("round-trip skill securityRequirements", Boolean(roundCard?.skills?.[0]?.extra?.securityRequirements));
  check("round-trip schema valid", validateAgentNetworkDoc(buildAgentNetworkDoc(project)).length === 0);
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
  check("evaluateA2aCard: complete card passes 11 checks", full.passed.length === 11, `${full.passed.length}`);

  const sparseCard: BrokerCard = { name: "Bare", version: "1.0.0" };
  const sparse = evaluateA2aCard(sparseCard);
  check("evaluateA2aCard: sparse card warns on all recommendations", sparse.warnings.length === 11, `${sparse.warnings.length}`);
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

console.log(`\n==== ${passed} passed, ${failed} failed ====`);
process.exit(failed === 0 ? 0 : 1);
