export type SuiteProductId = "tracer" | "builder" | "exchange" | "llmProxy";

export type SuiteProductImage =
  | { kind: "path"; src: string; alt: string }
  | { kind: "mule"; icon: "exchange" | "graph" | "llm" };

export interface SuiteProduct {
  id: SuiteProductId;
  name: string;
  headline: string;
  tagline: string;
  bullets: string[];
  redirectPath: string;
  accent: string;
  image: SuiteProductImage;
  beta?: boolean;
}

export const SUITE_PRODUCTS: SuiteProduct[] = [
  {
    id: "tracer",
    name: "Tracer",
    headline: "See what your brokers are doing",
    tagline: "Live observability for agent broker networks and A2A tasks.",
    bullets: [
      "Interactive network topology across brokers, agents, MCPs, and LLMs",
      "End-to-end task tracing with LLM reasoning and tool-call visibility",
      "Real-time monitoring of iterations, durations, and downstream hops",
    ],
    redirectPath: "/agent-network",
    accent: "from-blue-500 to-indigo-600",
    image: { kind: "path", src: "/ant-logo-landing.png", alt: "Tracer ant mascot" },
    beta: true,
  },
  {
    id: "builder",
    name: "Builder",
    headline: "Compose agent networks visually",
    tagline: "Meet Builder Ant — your visual-first agent network composer.",
    bullets: [
      "Design broker graphs on the canvas; AgentScript stays in sync",
      "Wire Exchange assets and registry-local entities into one project",
      "Start blank, import from Exchange, or open a local project folder",
    ],
    redirectPath: "/builder",
    accent: "from-primary to-violet",
    image: { kind: "path", src: "/images/builder-ant.png", alt: "Builder Ant mascot" },
    beta: true,
  },
  {
    id: "exchange",
    name: "Exchange",
    headline: "Compare what shipped",
    tagline: "What changed between v1.2 and v1.3? Diff versions before you deploy.",
    bullets: [
      "Side-by-side Exchange release comparison for agent networks",
      "Topology and asset diffs across published versions",
      "Inspect agent-network.yaml, broker agents, and referenced assets",
    ],
    redirectPath: "/agent-network?view=exchange",
    accent: "from-teal to-navy",
    image: { kind: "mule", icon: "exchange" },
  },
  {
    id: "llmProxy",
    name: "LLM Proxy",
    headline: "Test Flex Gateway routing",
    tagline: "Route models through Flex Gateway before production.",
    bullets: [
      "Browse LLM Proxy instances deployed in your environment",
      "Policy network diagram with routing and semantic guard highlights",
      "Chat playground that surfaces x-llm-proxy-* response headers",
    ],
    redirectPath: "/agent-network?view=llmProxy",
    accent: "from-emerald-500 to-teal-600",
    image: { kind: "path", src: "/llm-proxy-flex-gateway-icon.png", alt: "Flex Gateway LLM Proxy" },
  },
];

export const TRACER_HIGHLIGHTS = [
  {
    iconName: "Network",
    title: "Network Visualization",
    description: "See your entire broker network at a glance — brokers, agents, MCPs, and LLMs in one diagram.",
    color: "from-blue-500 to-blue-600",
    showScreenshot: true,
  },
  {
    iconName: "GitBranch",
    title: "Task Tracing",
    description: "Follow A2A tasks from inbound through iterations, tool calls, and downstream agents.",
    color: "from-purple-500 to-purple-600",
  },
  {
    iconName: "Brain",
    title: "LLM Reasoning",
    description: "Peek inside tool selection, reasoning steps, and orchestration decisions.",
    color: "from-green-500 to-green-600",
  },
];
