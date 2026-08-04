import {
  AF_AGENT_SCRIPT_REFERENCE_URL,
  A2A_INTERFACE_DOCS_URL,
  ANF_YAML_REFERENCE_URL,
} from "@/lib/composer/anf-docs-urls";
import {
  EXCHANGE_API_VERSION_UI_DETAIL,
  EXCHANGE_ASSET_VERSION_UI_DETAIL,
  EXCHANGE_DESCRIPTOR_VERSION_UI_DETAIL,
} from "@/lib/composer/docs/exchange-json-schema";
import type { HelpEntry } from "@/lib/composer/help/help-catalog";
import { EXCHANGE_NETWORK_LISTING_SCREENSHOT } from "@/lib/composer/help/exchange-help-images";

export type SectionHelpId =
  | "field.nodeId"
  | "field.label"
  | "field.llm"
  | "field.systemInstructions"
  | "field.prompt"
  | "field.reasoningInstructions"
  | "section.actionsAvailable"
  | "section.structuredOutputs"
  | "field.runAction"
  | "field.onExitTarget"
  | "section.routes"
  | "field.echoKind"
  | "field.echoState"
  | "field.echoMessage"
  | "field.echoArtifact"
  | "field.echoAppend"
  | "field.echoLastChunk"
  | "field.echoMetadata"
  | "field.projectNetworkName"
  | "field.projectYamlSummary"
  | "field.projectVersion"
  | "field.projectApiVersion"
  | "field.projectDescriptorVersion"
  | "panel.variables"
  | "panel.a2aInterface"
  | "panel.actions"
  | "panel.brokerBehavior"
  | "field.agentDialectVersion"
  | "field.agentConfigLabel"
  | "field.agentConfigDescription";

const SECTION_HELP: Record<SectionHelpId, HelpEntry> = {
  "field.nodeId": {
    id: "field.nodeId",
    title: "Node id",
    tagline: "The key used in the .agent file (e.g. @orchestrator.main).",
    whatItDoes:
      "The node identifier declared next to the node type in Agent Script. It becomes the namespace segment in expressions like @orchestrator.main.output.",
    whenToUse: ["Use stable, descriptive snake_case or camelCase names", "Must be unique within the broker graph"],
    gotchas: ["Renaming changes every @kind.name reference in the file"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#node-outputs`,
  },
  "field.label": {
    id: "field.label",
    title: "Label",
    tagline: "Optional display name shown in the UI.",
    whatItDoes: "A short, human-readable display name for the node. Does not affect runtime behavior or expressions.",
    whenToUse: ["When the node id is technical but you want a friendly name on the canvas"],
    docsUrl: AF_AGENT_SCRIPT_REFERENCE_URL,
  },
  "field.llm": {
    id: "field.llm",
    title: "LLM binding",
    tagline: "Overrides the broker default LLM for this node.",
    whatItDoes:
      "References an @llm.<name> binding declared in the llm: section. When omitted, config.default_llm is used.",
    whenToUse: ["This node needs a different model or provider than the broker default"],
    gotchas: ["Binding must exist in llm: and resolve to a composed LLM connection"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#llm-section`,
  },
  "field.systemInstructions": {
    id: "field.systemInstructions",
    title: "System instructions",
    tagline: "Optional persona override for this node.",
    whatItDoes:
      "Overrides the global system.instructions at the file root for this node only. Sets the LLM persona and behavior constraints.",
    whenToUse: ["This node needs a different persona than the broker-wide system instructions"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#system-section`,
  },
  "field.prompt": {
    id: "field.prompt",
    title: "Prompt",
    tagline: "Required — the one LLM call input for this generator.",
    whatItDoes:
      "Session-specific instructions for this generator node. The generator performs exactly one LLM call with this prompt — no agent loop, no tools.",
    whenToUse: ["Summarization, formatting, or templated text generation"],
    whenNotToUse: ["Multi-step reasoning or tool use → use Orchestrator/Subagent"],
    gotchas: ["Required field", "Supports {!@…} runtime expressions via Insert"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#generator-node`,
  },
  "field.reasoningInstructions": {
    id: "field.reasoningInstructions",
    title: "Reasoning instructions",
    tagline: "Required — session context for the agent reasoning loop.",
    whatItDoes:
      "Session-specific query or instructions for this node, typically containing user-provided or user-related context. Drives the orchestrator/subagent reasoning loop each turn.",
    whenToUse: [
      "Pass inbound user message: {!@request.payload.message.parts[0].text}",
      "Include prior node output or variables the LLM should consider",
    ],
    gotchas: ["Required field", "max_number_of_loops default: 25"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#orchestrator-node`,
  },
  "section.actionsAvailable": {
    id: "section.actionsAvailable",
    title: "Actions available",
    tagline: "Tools this node may call during reasoning.",
    whatItDoes:
      "Selects which declared actions (agents, MCP tools) the LLM can invoke in this node's reasoning loop. Unchecked actions are not offered to the model.",
    whenToUse: ["Restrict an orchestrator to only the actions relevant to its task"],
    gotchas: ["Actions must be declared in the Actions tab first", "Maps to reasoning.actions in the .agent file"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#tool-binding-at-the-node-level`,
  },
  "section.structuredOutputs": {
    id: "section.structuredOutputs",
    title: "Structured outputs",
    tagline: "Schema notation for this node's output shape (similar to JSON Schema).",
    whatItDoes:
      "Defines output properties so the agent produces structured fields downstream nodes can reference via @kind.name.output.field. Constrains subagent, orchestrator, and generator responses. Maps to reasoning.outputs (orchestrator/subagent) or top-level outputs (generator) in the .agent file.",
    whenToUse: [
      "Router when: conditions on @generator.classifyIntent.output.intent",
      "Executor or echo expressions referencing @orchestrator.node.output.field",
      "Enum fields for classification (list, triage, compose) or array fields (submissionIds)",
    ],
    gotchas: [
      "Supported types: string, number, integer, boolean, array, object — see MuleSoft Node Outputs docs",
      "UI edits: name, type, description, enum (string/number/integer), array items (including object with nested fields)",
      "Not in UI yet: pattern, min/max length, min/max items, default",
      "Does not support JSON Schema combinators ($ref, anyOf, oneOf, additionalProperties)",
    ],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#node-outputs`,
  },
  "field.runAction": {
    id: "field.runAction",
    title: "Run action",
    tagline: "Deterministic action executed by this executor.",
    whatItDoes:
      "The action the executor runs with fixed arguments in its do: block. No LLM is involved — use for known, deterministic tool calls.",
    whenToUse: ["Call an MCP tool or agent with predetermined inputs"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#executor-node`,
  },
  "field.onExitTarget": {
    id: "field.onExitTarget",
    title: "Transition target",
    tagline: "Which node runs next when this step completes.",
    whatItDoes:
      "Sets the single outgoing transition for this node. Emitted as on_exit in the .agent file (on_message for the trigger). Updates the canvas edge automatically.",
    whenToUse: [
      "Wire trigger → generator → orchestrator → echo without dragging on the canvas",
      "Retarget a step after renaming or adding nodes",
    ],
    gotchas: [
      "Routers branch via routes/otherwise — not on_exit",
      "Echo nodes are terminal and have no outgoing transition",
      "Executor on_exit is optional",
    ],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#node-expressions-and-references`,
  },
  "section.routes": {
    id: "section.routes",
    title: "Routes",
    tagline: "Conditional branches — pick targets here or use the canvas handles.",
    whatItDoes:
      "Each route has a when: condition expression and a target node. The otherwise target is used when no route matches. Routers do not use on_exit transitions.",
    whenToUse: ["Branch on @priorNode.output.field == \"value\""],
    gotchas: [
      "At least one route required",
      "otherwise target is the required fallback",
      "Use Target dropdowns for each route and otherwise",
      "Inspector: edit when/label without Agent Script",
    ],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#router-node`,
  },
  "field.echoKind": {
    id: "field.echoKind",
    title: "Event kind",
    tagline: "A2A status update or artifact update event.",
    whatItDoes:
      "Discriminator for the A2A event emitted: status_update_event updates task state; artifact_update_event streams an artifact to the client.",
    whenToUse: ["End of workflow (status completed)", "Streaming partial results (artifact chunks)"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#echo-node`,
  },
  "field.echoState": {
    id: "field.echoState",
    title: "Task state",
    tagline: "A2A v1 task state for status update events.",
    whatItDoes: "The task lifecycle state emitted with a status_update_event (e.g. TASK_STATE_COMPLETED, TASK_STATE_WORKING).",
    whenToUse: ["Signal progress, completion, failure, or input-required to the client"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#echo-node`,
  },
  "field.echoMessage": {
    id: "field.echoMessage",
    title: "Message",
    tagline: "A2A message expression for the status update.",
    whatItDoes:
      "Full `a2a.message({...})` expression, bare `@node.output`, plain text, or a `textPart` argument (including string concatenation with runtime expressions).",
    whenToUse: ["Return text to the client with the status update"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#echo-node`,
  },
  "field.echoArtifact": {
    id: "field.echoArtifact",
    title: "Artifact",
    tagline: "A2A artifact expression for the artifact update.",
    whatItDoes: "Full `a2a.artifact({...})` expression including parts, name, description, and metadata.",
    whenToUse: ["Stream structured artifact content to the client"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#echo-node`,
  },
  "field.echoAppend": {
    id: "field.echoAppend",
    title: "Append",
    tagline: "Append to an existing artifact with the same ID.",
    whatItDoes: "When true, content is appended to a previously sent artifact instead of replacing it.",
    whenToUse: ["Streaming artifact chunks"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#echo-node`,
  },
  "field.echoLastChunk": {
    id: "field.echoLastChunk",
    title: "Last chunk",
    tagline: "Marks the final chunk of a streamed artifact.",
    whatItDoes: "When true, signals this artifact update is the last chunk for the artifact ID.",
    whenToUse: ["End of a multi-chunk artifact stream"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#echo-node`,
  },
  "field.echoMetadata": {
    id: "field.echoMetadata",
    title: "Metadata",
    tagline: "Optional metadata dict for status updates.",
    whatItDoes: "AgentScript dict expression attached to the status update event.",
    whenToUse: ["Attach custom key/value metadata to a status response"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#echo-node`,
  },
  "field.projectNetworkName": {
    id: "field.projectNetworkName",
    title: "Network name",
    tagline: "Human-readable title on the Exchange asset page.",
    whatItDoes:
      "The display name for this agent network. Builder writes it to exchange.json name and agent-network.yaml info.label. After publish, Exchange shows it as the large title on the asset detail page.",
    whenToUse: [
      "Set the name users see when browsing Exchange",
      "Keep aligned with your ACB project name when round-tripping",
    ],
    gotchas: [
      "Not the same as Asset id (Exchange slug) or Version group (apiVersion)",
      "Distinct from YAML summary, which appears as the subtitle below this title",
    ],
    image: {
      ...EXCHANGE_NETWORK_LISTING_SCREENSHOT,
      caption: "Exchange listing — large title comes from Network name (exchange.json name / yaml info.label).",
    },
    docsUrl: `${ANF_YAML_REFERENCE_URL}#exchange-json-file`,
  },
  "field.projectYamlSummary": {
    id: "field.projectYamlSummary",
    title: "YAML summary",
    tagline: "Short subtitle under the title on the Exchange asset page.",
    whatItDoes:
      "Optional one-line summary on the yaml NetworkInfoObject (info.summary). Exchange surfaces it as the subtitle directly under the network title. Separate from exchange.json description and from yaml info.description.",
    whenToUse: [
      "Add a brief tagline visible on the Exchange asset card and detail page",
      "Summarize what the network does without opening the project",
    ],
    whenNotToUse: [
      "Long-form documentation → use Description (exchange.json) or YAML description instead",
    ],
    gotchas: [
      "Written only to agent-network.yaml info.summary — not exchange.json",
      "Does not replace Network name; it appears beneath it on Exchange",
    ],
    image: {
      ...EXCHANGE_NETWORK_LISTING_SCREENSHOT,
      caption: "Exchange listing — subtitle comes from YAML summary (agent-network.yaml info.summary).",
    },
    docsUrl: `${ANF_YAML_REFERENCE_URL}#network-info-object`,
  },
  "field.projectVersion": {
    id: "field.projectVersion",
    title: "Asset version",
    tagline: EXCHANGE_ASSET_VERSION_UI_DETAIL.summary,
    whatItDoes:
      "Semver for the Exchange GAV version coordinate. Each publish creates (or updates) an Exchange asset at groupId:assetId:version. Builder also writes this value to agent-network.yaml info.version unless a yaml-only override exists from import.",
    whenToUse: [
      "Bump before publishing a new release of this network",
      "Keep aligned with the version you intend to deploy from Exchange",
    ],
    gotchas: [
      "Republishing the same version may conflict with an existing Exchange release",
      "Not the same as apiVersion (Exchange version group) or agentNetwork: 2.0.0 (yaml spec version)",
      ...EXCHANGE_ASSET_VERSION_UI_DETAIL.points,
    ],
    docsUrl: `${ANF_YAML_REFERENCE_URL}#exchange-json-file`,
  },
  "field.projectApiVersion": {
    id: "field.projectApiVersion",
    title: "Version group",
    tagline: EXCHANGE_API_VERSION_UI_DETAIL.summary,
    whatItDoes:
      "Exchange version group (versionGroup) for publish and deploy. The CLI resolves the latest published semver for each asset within this group. ACB and CLI scaffold new agentic-network projects with apiVersion v1 and asset version 0.0.0.",
    whenToUse: [
      "Keep the same group for an existing published project line",
      "Match the version group you enter in ACB Publish Agent Network Assets",
    ],
    whenNotToUse: [
      "Do not use to bump a release — use Asset version (semver GAV) instead",
      "Do not confuse with agentNetwork: 2.0.0 (yaml spec) or descriptorVersion (exchange.json format)",
    ],
    gotchas: [...EXCHANGE_API_VERSION_UI_DETAIL.points],
    docsUrl: `${ANF_YAML_REFERENCE_URL}#exchange-json-file`,
  },
  "field.projectDescriptorVersion": {
    id: "field.projectDescriptorVersion",
    title: "Descriptor version",
    tagline: EXCHANGE_DESCRIPTOR_VERSION_UI_DETAIL.summary,
    whatItDoes:
      "Format version of the exchange.json project descriptor (ExchangeDescriptor), not the semver of your published network asset. Builder defaults to 1.0.0 and keeps this field protected.",
    whenToUse: ["Leave unchanged for standard agentic-network v2 projects"],
    whenNotToUse: [
      "Do not edit to bump a release — use Asset version instead",
      "Do not confuse with apiVersion (Exchange version group) or agentNetwork: 2.0.0 (yaml spec version)",
    ],
    gotchas: [...EXCHANGE_DESCRIPTOR_VERSION_UI_DETAIL.points],
    docsUrl: `${ANF_YAML_REFERENCE_URL}#exchange-json-file`,
  },
  "panel.variables": {
    id: "panel.variables",
    title: "Deploy variables",
    tagline: "Secrets and defaults published to exchange.json.",
    whatItDoes:
      "Deploy-time variables for connection URLs, custom ${group.field} markers in instructions, and optional runtime system limits. Connection variables are derived automatically from composed assets.",
    whenToUse: [
      "Reference ${myGroup.apiKey} in prompts or yaml",
      "Override connection URLs per environment at deploy time",
    ],
    gotchas: [
      "New LLM assets default url to the provider base URL from the Agent Network yaml reference (OpenAI, Gemini, Azure OpenAI, Bedrock OpenAI).",
    ],
    docsUrl: `${ANF_YAML_REFERENCE_URL}#exchange-json-file`,
  },
  "panel.a2aInterface": {
    id: "panel.a2aInterface",
    title: "A2A interface",
    tagline: "How external clients invoke this broker.",
    whatItDoes:
      "The A2A interface defines the broker's public agent card and inbound/outbound policy bindings. External clients use this front door to send messages into the graph trigger.",
    whenToUse: ["Configure authentication policies on inbound A2A traffic", "Set the broker card clients discover"],
    docsUrl: A2A_INTERFACE_DOCS_URL,
  },
  "panel.actions": {
    id: "panel.actions",
    title: "Broker actions",
    tagline: "Tools the graph can call — agents and MCP.",
    whatItDoes:
      "Action definitions map a name to a composed agent (a2a:send_message) or MCP tool (mcp:tool). Orchestrator and subagent nodes reference these as @actions.<name> in reasoning.",
    whenToUse: ["Compose Exchange agents or MCP servers as callable tools"],
    gotchas: ["Each action needs a composed connection from the Compose tab"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#actions-section`,
  },
  "panel.brokerBehavior": {
    id: "panel.brokerBehavior",
    title: "Broker behavior",
    tagline: "System instructions and Agent Script config metadata.",
    whatItDoes:
      "Edits the root system.instructions block and optional config: / dialect header fields in brokers/*.agent. System instructions are the default LLM persona; config label and description are internal Agent Script metadata (not the A2A card).",
    whenToUse: [
      "Set broker-wide tone, safety rules, or process steps",
      "Edit optional config.label and config.description metadata",
    ],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#system-section`,
  },
  "field.agentDialectVersion": {
    id: "field.agentDialectVersion",
    title: "Agent dialect version",
    tagline: "AGENTFABRIC dialect binding in the .agent file header.",
    whatItDoes:
      "Maps to # @dialect: AGENTFABRIC=1.0 at the top of brokers/*.agent. Binds the script to AgentFabric dialect 1.0; Builder always emits this value and keeps the field protected.",
    whenToUse: ["Reference only — Builder fixes this at 1.0 for all broker .agent files"],
    whenNotToUse: ["Manual edits — not editable in Builder"],
    gotchas: [
      "Not the same as agent-network.yaml agentNetwork version",
      "Imported files with a different dialect header are normalized to 1.0 on export",
    ],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#dialect-referencing-and-versioning`,
  },
  "field.agentConfigLabel": {
    id: "field.agentConfigLabel",
    title: "Config label",
    tagline: "Human-readable display name — config.label.",
    whatItDoes:
      "Optional metadata in the config: section of brokers/*.agent. A friendly display name for the agent, separate from config.agent_name (the broker key / yaml map key).",
    whenToUse: ["When the broker key is technical but you want a readable title in Agent Script"],
    whenNotToUse: ["Public discovery — use the A2A card name on the A2A card tab instead"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#agent-config-section`,
  },
  "field.agentConfigDescription": {
    id: "field.agentConfigDescription",
    title: "Config description",
    tagline: "What the agent does — config.description.",
    whatItDoes:
      "Optional description in the config: section of brokers/*.agent. Documents the agent's purpose as Agent Script metadata.",
    whenToUse: ["Describe the broker's role inside the .agent file"],
    whenNotToUse: ["External client discovery — use the A2A card description in agent-network.yaml"],
    gotchas: ["Distinct from brokers.*.interfaces.a2a.card.description"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#agent-config-section`,
  },
};

export function helpForSection(id: SectionHelpId): HelpEntry {
  return SECTION_HELP[id];
}
