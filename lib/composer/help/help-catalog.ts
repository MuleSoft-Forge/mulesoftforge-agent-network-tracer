import type { GraphNodeKind } from "@/lib/composer/model";
import { NODE_DOCS_URL } from "@/lib/composer/anf-docs-urls";

/**
 * A single Tier-2 ("Guide") help entry. Content is seeded from the canonical
 * AgentFabric dialect `.describe()` strings and the `af-agent-script-reference`
 * docs so the copy stays in lockstep with the runtime spec.
 */
export interface HelpImage {
  src: string;
  alt: string;
  caption?: string;
}

export interface HelpEntry {
  id: string;
  title: string;
  /** One-line essence, shown as the inspector tagline. */
  tagline: string;
  /** Discovery: what this thing is (1-2 sentences). */
  whatItDoes: string;
  /** Enablement: when to reach for it. */
  whenToUse: string[];
  /** Steer users to the right node when this isn't it. */
  whenNotToUse?: string[];
  example?: { caption: string; code: string };
  /** Optional screenshot or diagram surfaced in the help popover. */
  image?: HelpImage;
  /** Defaults, required fields, limits. */
  gotchas?: string[];
  docsUrl: string;
}

const NODE_HELP: Record<GraphNodeKind, HelpEntry> = {
  trigger: {
    id: "node.trigger",
    title: "Trigger",
    tagline: "Entry point — starts the graph when a message arrives.",
    whatItDoes:
      "Initiates graph execution on incoming messages. The A2A trigger reacts to send/message methods and automatically manages task history, context ID, and task IDs. Each broker has exactly one trigger per declared interface.",
    whenToUse: [
      "Every broker needs one — it is the front door of the graph",
      "Routes the first message to your initial node via on_message / on exit",
    ],
    gotchas: [
      "Only JSON-RPC or HTTP JSON transports are supported",
      "on_message must contain a transition to the initial node",
    ],
    docsUrl: NODE_DOCS_URL.trigger,
  },
  generator: {
    id: "node.generator",
    title: "Generator",
    tagline: "One LLM call to generate text — no tools, no loop.",
    whatItDoes:
      "Calls an LLM to generate text. It is not an agent loop and does not support human-in-the-loop or actions — it performs exactly one LLM call.",
    whenToUse: [
      "Summarization, formatting, or templated text generation",
      "You need a single, predictable model response",
    ],
    whenNotToUse: [
      "Need tools or multi-step reasoning → use an Orchestrator or Subagent",
      "Deterministic set/run steps → use an Executor",
    ],
    example: {
      caption: "Summarize a report",
      code: `generator summarize-report:
  description: "One-paragraph summary of the report."
  prompt: "Summarize the following in one paragraph: {!@variables.report}"
  on_exit: -> transition to @echo.done`,
    },
    gotchas: ["prompt is required", "on_exit must contain a transition"],
    docsUrl: NODE_DOCS_URL.generator,
  },
  orchestrator: {
    id: "node.orchestrator",
    title: "Orchestrator",
    tagline: "Coordinates multiple agents & MCP tools to reach a goal.",
    whatItDoes:
      "A specialization of the subagent node, optimized for multi-agent orchestration. It runs an agent reasoning loop that can call multiple external agents and actions until the goal is met.",
    whenToUse: [
      "Workflows that call several agents or MCP tools to complete a task",
      "You want the LLM to plan and choose actions dynamically",
      "You need structured outputs from a multi-step run",
    ],
    whenNotToUse: [
      "Single LLM call with no tools → use a Generator",
      "Deterministic set/run steps → use an Executor",
    ],
    example: {
      caption: "Flight-booking orchestrator",
      code: `orchestrator flight-booking-agent:
  description: books flights across approved partners
  reasoning:
    instructions: -> @request.payload.message.parts[0].text
    actions:
      search-flight: @actions.search-flight
    max_number_of_loops: 10
  on_exit: -> transition to @executor.send_summary`,
    },
    gotchas: [
      "reasoning.instructions is required",
      "reasoning.max_number_of_loops default: 25",
      "on_exit must contain a transition",
    ],
    docsUrl: NODE_DOCS_URL.orchestrator,
  },
  subagent: {
    id: "node.subagent",
    title: "Subagent",
    tagline: "Generic agent loop with a prompt and a set of actions.",
    whatItDoes:
      "Defines a generic agent loop made of a prompt and a set of actions. Because it can use actions and supports human-in-the-loop flows, it is ideal for classification, semantic routing, or LLM reasoning.",
    whenToUse: [
      "Classification or semantic routing driven by an LLM",
      "Reasoning tasks that may call one or more actions",
      "Human-in-the-loop flows",
    ],
    whenNotToUse: [
      "Coordinating many agents to a goal → use an Orchestrator",
      "Single LLM call → use a Generator",
    ],
    gotchas: [
      "reasoning.instructions is required",
      "on_exit must contain a transition",
    ],
    docsUrl: NODE_DOCS_URL.subagent,
  },
  executor: {
    id: "node.executor",
    title: "Executor",
    tagline: "Deterministic steps — set variables and run actions.",
    whatItDoes:
      "Executes a set of Agent Script statements, primarily for setting variables or deterministic tool invocations with known or fixed arguments. No LLM reasoning is involved.",
    whenToUse: [
      "Set variables from request payload or prior node output",
      "Call an action with known/fixed arguments",
      "Deterministic glue between reasoning nodes",
    ],
    whenNotToUse: [
      "You want the LLM to decide what to do → use an Orchestrator/Subagent",
    ],
    example: {
      caption: "Set a variable then transition",
      code: `executor prepare:
  do: ->
    set @variables.company_id = @request.payload.company_id
  on_exit: -> transition to @orchestrator.main`,
    },
    gotchas: [
      "do is required",
      "on_exit is optional for terminal executors; when present it must transition",
    ],
    docsUrl: NODE_DOCS_URL.executor,
  },
  router: {
    id: "node.router",
    title: "Router",
    tagline: "Deterministic branching on conditions — no LLM.",
    whatItDoes:
      "Performs dynamic transitions based on deterministic conditions. Use it to branch on structured output from a previous node. Exits are defined by each route's target and the otherwise target — not by on_exit.",
    whenToUse: [
      "Branch based on a prior node's structured output",
      "Deterministic if/else routing between nodes",
    ],
    whenNotToUse: [
      "Branching that needs LLM judgment → use a Subagent",
    ],
    example: {
      caption: "Route on severity",
      code: `router triage:
  routes:
    - when: @orchestrator.classify.output.severity == "high"
      target: @orchestrator.escalate
  otherwise:
    target: @generator.acknowledge`,
    },
    gotchas: [
      "At least one route is required",
      "otherwise.target is the required fallback",
      "Does not support transition in on_exit",
    ],
    docsUrl: NODE_DOCS_URL.router,
  },
  echo: {
    id: "node.echo",
    title: "Echo",
    tagline: "Sends a response back to the client.",
    whatItDoes:
      "Emits an A2A event to update the stored task — a status update or an artifact update. The number of responses depends on the trigger interface and its configuration.",
    whenToUse: [
      "The end of a workflow",
      "Any point where you want to emit a response to the client",
    ],
    example: {
      caption: "Emit a completed status",
      code: `echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: @generator.summarize.output`,
    },
    gotchas: [
      "kind is required (status_update_event or artifact_update_event)",
      "status events require a state; artifact events require an artifact",
    ],
    docsUrl: NODE_DOCS_URL.echo,
  },
};

/** Tier-2 help for a graph node kind. */
export function helpForNodeKind(kind: GraphNodeKind): HelpEntry {
  return NODE_HELP[kind];
}
