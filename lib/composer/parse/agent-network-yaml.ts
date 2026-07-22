/**
 * Reverse of serialize/agent-network-yaml.ts. Extracts the info block, the
 * connection map, and the single broker (key + interface + card).
 */

import { parse } from "yaml";
import type { BrokerCard } from "@/lib/composer/model";
import { parseBrokerCard } from "@/lib/composer/a2a-card";
import type { ConnectionAuth, ConnectionAccess, ConnectionPolicies } from "@/lib/composer/connectivity/types";
import { parseConnectionAuth } from "@/lib/composer/connectivity/parse-auth";
import {
  parseConnectionAccess,
  parseConnectionPolicies,
} from "@/lib/composer/connectivity/connection-extras";
import { parseContextPolicies } from "@/lib/composer/connectivity/policy-bindings";
import type { DeclaredPolicyBinding } from "@/lib/composer/connectivity/policy-bindings-zod";

export interface ParsedConnection {
  connectionName: string;
  kind: "a2a" | "mcp" | "llm";
  refName: string;
  refNamespace?: string;
  url?: string;
  authentication?: ConnectionAuth;
  access?: ConnectionAccess;
  policies?: ConnectionPolicies;
}

export interface ParsedYamlBroker {
  key: string;
  interfaceName: string;
  card: BrokerCard;
  interfacePolicies?: ConnectionPolicies;
}

export interface ParsedYamlInfo {
  description?: string;
  summary?: string;
  tags?: string[];
}

export interface ParsedAgentNetworkYaml {
  label?: string;
  version?: string;
  yamlInfo?: ParsedYamlInfo;
  connections: ParsedConnection[];
  policyBindings: Record<string, DeclaredPolicyBinding>;
  broker?: ParsedYamlBroker;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseConnections(context: Record<string, unknown> | undefined): ParsedConnection[] {
  const connsObj = asRecord(context?.connections);
  if (!connsObj) return [];
  const out: ParsedConnection[] = [];
  for (const [connectionName, raw] of Object.entries(connsObj)) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const kindRaw = asString(entry.kind);
    const kind: ParsedConnection["kind"] =
      kindRaw === "mcp" ? "mcp" : kindRaw === "llm" ? "llm" : "a2a";
    const ref = asRecord(entry.ref);
    out.push({
      connectionName,
      kind,
      refName: asString(ref?.name) ?? connectionName.replace(/Connection$/, ""),
      refNamespace: asString(ref?.namespace),
      url: asString(entry.url),
      authentication: parseConnectionAuth(entry.authentication, kind),
      access: parseConnectionAccess(entry.access),
      policies: parseConnectionPolicies(entry.policies),
    });
  }
  return out;
}

function parseYamlInfo(info: Record<string, unknown> | undefined): ParsedYamlInfo | undefined {
  if (!info) return undefined;
  const description = asString(info.description);
  const summary = asString(info.summary);
  const tags = Array.isArray(info.tags)
    ? info.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : undefined;
  if (!description && !summary && (!tags || tags.length === 0)) return undefined;
  return {
    ...(description ? { description } : {}),
    ...(summary ? { summary } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
  };
}

function parseBroker(brokers: Record<string, unknown> | undefined): ParsedYamlBroker | undefined {
  if (!brokers) return undefined;
  const entries = Object.entries(brokers);
  if (entries.length === 0) return undefined;
  const [key, raw] = entries[0];
  const entry = asRecord(raw);
  const interfaces = asRecord(entry?.interfaces);
  const ifaceEntries = interfaces ? Object.entries(interfaces) : [];
  const interfaceName = ifaceEntries[0]?.[0] ?? "a2a";
  const ifaceObj = asRecord(ifaceEntries[0]?.[1]);
  const cardObj = asRecord(ifaceObj?.card);
  const interfacePolicies = parseConnectionPolicies(ifaceObj?.policies);
  return {
    key,
    interfaceName,
    card: cardObj ? parseBrokerCard(cardObj) : { name: key, version: "1.0.0" },
    ...(interfacePolicies ? { interfacePolicies } : {}),
  };
}

export function parseAgentNetworkYaml(text: string): ParsedAgentNetworkYaml {
  const doc = asRecord(parse(text)) ?? {};
  const info = asRecord(doc.info);
  const context = asRecord(doc.context);
  return {
    label: asString(info?.label),
    version: asString(info?.version),
    yamlInfo: parseYamlInfo(info),
    connections: parseConnections(context),
    policyBindings: parseContextPolicies(context?.policies),
    broker: parseBroker(asRecord(doc.brokers)),
  };
}
