import {
  AF_AGENT_SCRIPT_REFERENCE_URL,
  A2A_INTERFACE_DOCS_URL,
  ANF_YAML_REFERENCE_URL,
} from "@/lib/composer/anf-docs-urls";
import type { HelpEntry } from "@/lib/composer/help/help-catalog";

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
  | "section.routes"
  | "field.echoKind"
  | "field.echoState"
  | "field.echoMessage"
  | "field.echoArtifact"
  | "field.echoAppend"
  | "field.echoLastChunk"
  | "field.echoMetadata"
  | "panel.variables"
  | "panel.a2aInterface"
  | "panel.actions"
  | "panel.brokerBehavior";

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
    tagline: "JSON schema for this node's output fields.",
    whatItDoes:
      "Defines output properties (name + type) that downstream nodes can reference via @kind.name.output.field. For orchestrators, nested under reasoning.outputs; for generators, top-level outputs.",
    whenToUse: [
      "Router conditions need structured fields from a prior node",
      "Echo or executor references @generator.foo.output.bar",
    ],
    gotchas: ["Supported types: string, number, integer, boolean, array, object"],
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
  "section.routes": {
    id: "section.routes",
    title: "Routes",
    tagline: "Conditional branches — connect edges to define targets.",
    whatItDoes:
      "Each route has a when: condition expression and a target node. The otherwise target is used when no route matches. Routers do not use on_exit transitions.",
    whenToUse: ["Branch on @priorNode.output.field == \"value\""],
    gotchas: [
      "At least one route required",
      "otherwise target is the required fallback",
      "Draw edges on the canvas to set route targets",
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
    title: "Broker system instructions",
    tagline: "Global persona for all LLM nodes in this broker.",
    whatItDoes:
      "Maps to system.instructions at the root of the .agent file. Applied as the default persona when individual nodes do not override system.instructions.",
    whenToUse: ["Set broker-wide tone, safety rules, or process steps"],
    docsUrl: `${AF_AGENT_SCRIPT_REFERENCE_URL}#system-section`,
  },
};

export function helpForSection(id: SectionHelpId): HelpEntry {
  return SECTION_HELP[id];
}
