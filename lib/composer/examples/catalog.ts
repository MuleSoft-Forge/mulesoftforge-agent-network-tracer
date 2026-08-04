/** Curated MuleSoft example projects users can open in Builder. */

export type ComposerExampleId = "it-investigation-broker";

export interface ComposerExampleCatalogEntry {
  id: ComposerExampleId;
  title: string;
  summary: string;
  sourceUrl: string;
}

export const COMPOSER_EXAMPLES: ComposerExampleCatalogEntry[] = [
  {
    id: "it-investigation-broker",
    title: "IT Help Investigation",
    summary:
      "Triages IT support tickets, escalates critical issues, and resolves common problems through cross-platform investigation with registry agents and MCP tools.",
    sourceUrl:
      "https://github.com/MuleSoft-AI-Chain-Project/example-mule-apps/tree/master/agent-network-2.0-examples/it-investigation-broker-example",
  },
];

export function composerExampleById(id: ComposerExampleId): ComposerExampleCatalogEntry {
  const entry = COMPOSER_EXAMPLES.find((e) => e.id === id);
  if (!entry) throw new Error(`Unknown example: ${id}`);
  return entry;
}
