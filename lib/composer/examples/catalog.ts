/** Curated MuleSoft example projects users can open in Builder. */

export type ComposerExampleId = "it-investigation-broker" | "vogue-premiere-broker";

export interface ComposerExampleCatalogEntry {
  id: ComposerExampleId;
  eyebrow?: string;
  title: string;
  summary: string;
  sourceUrl: string;
  docsUrl?: string;
  imageSrc?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageAlt?: string;
}

/**
 * A workshop-backed template gets its own panel above the plain example list:
 * it carries a link to the workshop, an image, and a breakdown of what ships in
 * the project.
 */
export interface ComposerWorkshopTemplate {
  id: ComposerExampleId;
  eyebrow: string;
  title: string;
  summary: string;
  workshopUrl: string;
  workshopLabel: string;
  uiUrl?: string;
  uiLabel?: string;
  imageSrc: string;
  imageWidth: number;
  imageHeight: number;
  imageAlt: string;
  highlights: string[];
  note: string;
}

export const COMPOSER_WORKSHOP_TEMPLATE: ComposerWorkshopTemplate = {
  id: "vogue-premiere-broker",
  eyebrow: "MuleSoft workshop",
  title: "Vogue Premiere Style Concierge",
  summary:
    "The Agent Network built in MuleSoft's Agent Fabric Actionability Workshop — a luxury retail concierge that routes a customer message to specialist agents, checks stock and loyalty perks, and places orders behind a confirmation gate.",
  workshopUrl: "https://actionability.workshops.mulesoft.com/",
  workshopLabel: "MuleSoft Agent Fabric Actionability Workshop",
  uiUrl: "https://actionability-ui.workshops.mulesoft.com/",
  uiLabel: "Try the live workshop UI",
  imageSrc: "/images/vogue-premiere-builder-example.png",
  imageWidth: 1024,
  imageHeight: 193,
  imageAlt:
    "Vogue Premiere Builder graph showing the broker connected to Styling, Availability, Loyalty, Customer MCP, and Order MCP",
  highlights: [
    "One AgentScript broker, vogue_premiere, exposed over A2A as the Vogue Premiere Styling Concierge.",
    "Intent classifier plus router that splits styling, availability, loyalty, order status, order placement, and multi-intent requests.",
    "Three A2A registry agents — Styling, Availability, and Loyalty — each called from its own subagent, and an orchestrator that fans out to all three for multi-intent messages.",
    "One consolidated Commerce MCP (profile lookup on entry, shipping status, and order placement), secured with Keycloak OAuth 2.0 on-behalf-of token exchange (RFC 8693).",
    "A hard confirmation gate: the order is only placed after the customer explicitly confirms.",
    "Workshop endpoints prefilled as variables — the A2A agent URLs and the workshop LLM proxy.",
  ],
  note: "Your business group fills in the org id on open. Add your own OpenAI API key, set the Commerce MCP URL and Keycloak OBO client credentials for your workshop tenant, and swap the endpoint variables if your tenant differs.",
};

export const COMPOSER_EXAMPLES: ComposerExampleCatalogEntry[] = [
  {
    id: "it-investigation-broker",
    eyebrow: "MuleSoft example",
    title: "IT Help Investigation",
    summary:
      "Triages IT support tickets, escalates critical issues, and resolves common problems through cross-platform investigation with registry agents and MCP tools.",
    sourceUrl:
      "https://github.com/MuleSoft-AI-Chain-Project/example-mule-apps/tree/master/agent-network-2.0-examples/it-investigation-broker-example",
    docsUrl: "https://docs.mulesoft.com/agent-network/latest/af-example-it-investigation-broker",
    imageSrc: "/images/it-help-investigation-example.png",
    imageWidth: 1024,
    imageHeight: 267,
    imageAlt:
      "IT Help Desk Broker example graph showing Help Center Agent, License Procurement Agent, Escalation MCP Server, and Jira MCP Server",
  },
];