#!/usr/bin/env node
/**
 * Regenerate bundled example sources from the raw project files in each
 * example folder under lib/composer/examples.
 *
 *   npm run sync:composer-examples
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface ExampleSpec {
  dir: string;
  title: string;
  source: string;
  brokerFile: string;
}

const EXAMPLES: ExampleSpec[] = [
  {
    dir: "it-investigation-broker",
    title: "MuleSoft's IT Help Investigation example",
    source:
      "https://github.com/MuleSoft-AI-Chain-Project/example-mule-apps/tree/master/agent-network-2.0-examples/it-investigation-broker-example",
    brokerFile: "brokers/it-help-investigation.agent",
  },
  {
    dir: "vogue-premiere-broker",
    title: "MuleSoft's Vogue Premiere broker template (Agent Fabric Actionability Workshop)",
    source: "https://actionability.workshops.mulesoft.com/",
    brokerFile: "brokers/vogue_premiere.agent",
  },
];

const dir = dirname(fileURLToPath(import.meta.url));

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

for (const example of EXAMPLES) {
  const exampleDir = join(dir, "../lib/composer/examples", example.dir);

  const exchange = readFileSync(join(exampleDir, "exchange.json"), "utf8");
  const yaml = readFileSync(join(exampleDir, "agent-network.yaml"), "utf8");
  const agent = readFileSync(join(exampleDir, example.brokerFile), "utf8");

  const out = `/**
 * Bundled copy of ${example.title}.
 * Source: ${example.source}
 *
 * Regenerate: npm run sync:composer-examples
 */

export const EXCHANGE_JSON = \`${esc(exchange)}\`;

export const AGENT_YAML = \`${esc(yaml)}\`;

export const BROKER_AGENT = \`${esc(agent)}\`;
`;

  const target = join(exampleDir, "sources.ts");
  writeFileSync(target, out);
  console.log(`Wrote ${target} (${out.length} bytes)`);
}
