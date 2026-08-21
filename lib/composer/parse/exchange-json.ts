/**
 * Reverse of serialize/exchange-json.ts. Extracts identity, dependencies, and
 * the per-variable overrides (description/default/secret) so they round-trip.
 */

import type { AgentNetworkBuilderMetadata } from "@/lib/composer/builder-metadata";
import { parseBuilderMetadata } from "@/lib/composer/builder-metadata";
import { isFlatExchangeVariableEntry } from "@/lib/composer/variable-keys";

export interface ParsedDependency {
  groupId: string;
  assetId: string;
  version: string;
  classifier: string;
  packaging?: string;
}

export interface ParsedVariable {
  group: string;
  field: string;
  flat?: boolean;
  description?: string;
  default: string;
  secret: boolean;
}

export interface ParsedExchangeJson {
  name?: string;
  organizationId?: string;
  assetId?: string;
  version?: string;
  descriptorVersion?: string;
  apiVersion?: string;
  description?: string;
  tags?: string[];
  dependencies: ParsedDependency[];
  variables: ParsedVariable[];
  builderMetadata?: AgentNetworkBuilderMetadata;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseDependencies(deps: unknown): ParsedDependency[] {
  if (!Array.isArray(deps)) return [];
  const out: ParsedDependency[] = [];
  for (const d of deps) {
    const rec = asRecord(d);
    if (!rec) continue;
    out.push({
      groupId: asString(rec.groupId) ?? "",
      assetId: asString(rec.assetId) ?? "",
      version: asString(rec.version) ?? "",
      classifier: asString(rec.classifier) ?? "",
      ...(asString(rec.packaging) ? { packaging: asString(rec.packaging) } : {}),
    });
  }
  return out;
}

function parseVariables(metadata: Record<string, unknown> | undefined): ParsedVariable[] {
  const varsObj = asRecord(metadata?.variables);
  if (!varsObj) return [];
  const out: ParsedVariable[] = [];
  for (const [group, fieldsRaw] of Object.entries(varsObj)) {
    const fields = asRecord(fieldsRaw);
    if (!fields) continue;
    if (isFlatExchangeVariableEntry(fields)) {
      out.push({
        group: "",
        field: group,
        flat: true,
        ...(asString(fields.description) ? { description: asString(fields.description) } : {}),
        default: asString(fields.default) ?? "",
        secret: fields.secret === true,
      });
      continue;
    }
    for (const [field, valRaw] of Object.entries(fields)) {
      const v = asRecord(valRaw);
      if (!v) continue;
      out.push({
        group,
        field,
        ...(asString(v.description) ? { description: asString(v.description) } : {}),
        default: asString(v.default) ?? "",
        secret: v.secret === true,
      });
    }
  }
  return out;
}

function parseTags(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags)) return undefined;
  const out = tags.filter((t): t is string => typeof t === "string" && t.trim() !== "");
  return out.length > 0 ? out : [];
}

/** Parse exchange.json text. Throws on invalid JSON. */
export function parseExchangeJson(text: string): ParsedExchangeJson {
  const doc = asRecord(JSON.parse(text)) ?? {};
  const metadata = asRecord(doc.metadata);
  return {
    name: asString(doc.name),
    organizationId: asString(doc.organizationId) ?? asString(doc.groupId),
    assetId: asString(doc.assetId),
    version: asString(doc.version),
    descriptorVersion: asString(doc.descriptorVersion),
    apiVersion: asString(doc.apiVersion),
    description: asString(doc.description),
    tags: parseTags(doc.tags),
    dependencies: parseDependencies(doc.dependencies),
    variables: parseVariables(metadata),
    builderMetadata: parseBuilderMetadata(metadata),
  };
}
