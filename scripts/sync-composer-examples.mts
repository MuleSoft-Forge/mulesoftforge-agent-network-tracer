#!/usr/bin/env node
/**
 * Regenerate bundled example sources from upstream raw files in this folder.
 *
 *   npm run sync:composer-examples
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const exampleDir = join(dir, "../lib/composer/examples/it-investigation-broker");

const exchange = readFileSync(join(exampleDir, "exchange.json"), "utf8");
const yaml = readFileSync(join(exampleDir, "agent-network.yaml"), "utf8");
const agent = readFileSync(join(exampleDir, "brokers/it-help-investigation.agent"), "utf8");

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

const out = `/**
 * Bundled copy of MuleSoft's IT Help Investigation example.
 * Source: https://github.com/MuleSoft-AI-Chain-Project/example-mule-apps/tree/master/agent-network-2.0-examples/it-investigation-broker-example
 *
 * Regenerate: npm run sync:composer-examples
 */

export const EXCHANGE_JSON = \`${esc(exchange)}\`;

export const AGENT_YAML = \`${esc(yaml)}\`;

export const BROKER_AGENT = \`${esc(agent)}\`;
`;

writeFileSync(join(exampleDir, "sources.ts"), out);
console.log(`Wrote ${join(exampleDir, "sources.ts")} (${out.length} bytes)`);
