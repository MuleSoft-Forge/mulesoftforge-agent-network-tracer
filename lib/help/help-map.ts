/**
 * Help information architecture — the single source of truth for the in-app
 * help centre. The sidebar, the "On this page" rail, and every deep link from
 * Tracer / Builder / Build & Publish all resolve against this map, so a section
 * and its anchor are named in exactly one place.
 *
 * Anchors are stable slugs. When wiring a "?" button in a product surface, link
 * to `helpHref(pageId, anchor)` — never a hand-typed string — so a renamed
 * section can't silently break a deep link.
 */

export type HelpPageId =
  | "home"
  | "concepts"
  | "tracer"
  | "builder"
  | "build-publish"
  | "troubleshooting"
  | "glossary";

export interface HelpAnchor {
  /** URL fragment, e.g. "node-kinds" → /help/builder#node-kinds */
  id: string;
  /** Human label shown in the "On this page" rail. */
  label: string;
}

export interface HelpPage {
  id: HelpPageId;
  /** Route segment; "" for the hub at /help. */
  slug: string;
  /** Sidebar + breadcrumb label. */
  title: string;
  /** One-line description used on the hub cards and <meta>. */
  blurb: string;
  /** Section anchors on the page, in document order. */
  anchors: HelpAnchor[];
}

export const HELP_BASE = "/help";

export const HELP_PAGES: HelpPage[] = [
  {
    id: "home",
    slug: "",
    title: "Overview",
    blurb: "Start here — what Agent Network Studio is and a 10-minute path to your first traced broker.",
    anchors: [
      { id: "what-is-this", label: "What is this?" },
      { id: "from-integration", label: "Coming from MuleSoft integration" },
      { id: "the-three-tools", label: "The three tools" },
      { id: "quickstart", label: "Quickstart (10 minutes)" },
      { id: "prerequisites", label: "What you need" },
    ],
  },
  {
    id: "concepts",
    slug: "concepts",
    title: "Concepts",
    blurb: "The vocabulary of Agent Networks: brokers, A2A, MCP, LLMs, Exchange assets, AgentScript, and the v1/v2 split.",
    anchors: [
      { id: "agent-network", label: "Agent Network" },
      { id: "broker", label: "Broker" },
      { id: "agentscript", label: "AgentScript" },
      { id: "a2a", label: "A2A (Agent-to-Agent)" },
      { id: "agent-card", label: "Agent card" },
      { id: "mcp", label: "MCP" },
      { id: "llm", label: "LLMs" },
      { id: "exchange-assets", label: "Exchange assets & GAV" },
      { id: "task", label: "Task, context & iteration" },
      { id: "v1-v2", label: "v1 vs v2 brokers" },
      { id: "object-store", label: "Object Store & retention" },
    ],
  },
  {
    id: "tracer",
    slug: "tracer",
    title: "Tracer",
    blurb: "Live observability for deployed brokers — see the network, trace tasks, and read the LLM's reasoning.",
    anchors: [
      { id: "overview", label: "What Tracer does" },
      { id: "layout", label: "The layout" },
      { id: "scope-picker", label: "Picking a scope" },
      { id: "network-graph", label: "The network graph" },
      { id: "task-list", label: "The task list" },
      { id: "task-details", label: "Task details" },
      { id: "invoke", label: "Invoking a broker" },
      { id: "exchange-versions", label: "Exchange Versions" },
      { id: "llm-proxy", label: "LLM Proxy" },
      { id: "entitlement", label: "The entitlement wall" },
      { id: "gotchas", label: "Gotchas" },
    ],
  },
  {
    id: "builder",
    slug: "builder",
    title: "Builder",
    blurb: "Visually author an Agent Network 2.0 project — wire Exchange assets, draw the broker graph, export the bundle.",
    anchors: [
      { id: "overview", label: "What Builder does" },
      { id: "start", label: "Starting a project" },
      { id: "the-model", label: "One model, three files" },
      { id: "guided-order", label: "The guided build order" },
      { id: "assets", label: "Composing Exchange assets" },
      { id: "node-kinds", label: "The seven node kinds" },
      { id: "graph", label: "Building the graph" },
      { id: "validation", label: "Validation & the coach" },
      { id: "save-export", label: "Saving & exporting" },
      { id: "gotchas", label: "Gotchas" },
    ],
  },
  {
    id: "build-publish",
    slug: "build-publish",
    title: "Build & Publish",
    blurb: "Run the real Anypoint CLI lifecycle from the browser — build, publish to Exchange, deploy, and tear down.",
    anchors: [
      { id: "overview", label: "What Build & Publish does" },
      { id: "pipeline", label: "The pipeline model" },
      { id: "context", label: "Business group & environment" },
      { id: "load-project", label: "Loading a project" },
      { id: "deploy-target", label: "Deployment target" },
      { id: "variables", label: "Variables & secrets" },
      { id: "run", label: "Publish & Deploy" },
      { id: "teardown", label: "Teardown" },
      { id: "diagnosis", label: "Reading a failure" },
      { id: "gotchas", label: "Gotchas" },
    ],
  },
  {
    id: "troubleshooting",
    slug: "troubleshooting",
    title: "Troubleshooting",
    blurb: "The errors you'll actually hit, in plain language, with the fix.",
    anchors: [
      { id: "entitlement", label: "\"Log Search required\"" },
      { id: "target-changed-after-initial-deploy", label: "Target locked after first deploy" },
      { id: "broker-unreachable-connections", label: "Broker can't reach its connections" },
      { id: "deploy-timed-out", label: "Deploy timed out" },
      { id: "permission-denied", label: "Permission denied" },
      { id: "deploy-needs-local-build", label: "No build artifacts" },
      { id: "unpublish-active-instances", label: "Can't unpublish (active instances)" },
      { id: "unpublish-hard-delete-window", label: "Hard-delete window" },
      { id: "cli-flag-rejected", label: "Circular structure to JSON" },
      { id: "empty-tracer", label: "Tracer shows nothing" },
      { id: "export-blocked", label: "Builder won't export" },
    ],
  },
  {
    id: "glossary",
    slug: "glossary",
    title: "Glossary",
    blurb: "Every term, one line each.",
    anchors: [],
  },
];

export function getHelpPage(id: HelpPageId): HelpPage {
  const page = HELP_PAGES.find((p) => p.id === id);
  if (!page) throw new Error(`Unknown help page: ${id}`);
  return page;
}

/** Route for a help page, optionally with an anchor. Use everywhere instead of literals. */
export function helpHref(id: HelpPageId, anchor?: string): string {
  const page = getHelpPage(id);
  const path = page.slug ? `${HELP_BASE}/${page.slug}` : HELP_BASE;
  return anchor ? `${path}#${anchor}` : path;
}
