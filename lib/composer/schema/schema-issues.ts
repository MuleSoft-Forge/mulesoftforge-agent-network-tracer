/**
 * Shared Ajv error projection. Every schema check in the Composer
 * (agent-network.yaml, A2A card, policy configuration) reports through this so
 * the messages read the same way whichever schema rejected the document.
 */

import type { ErrorObject } from "ajv";

export interface SchemaIssue {
  /** JSON pointer-ish path into the document, e.g. "context.connections.x.kind". */
  path: string;
  message: string;
}

function formatError(err: ErrorObject): SchemaIssue {
  const path = err.instancePath ? err.instancePath.replace(/^\//, "").replace(/\//g, ".") : "(root)";
  let message = err.message ?? "is invalid";
  if (err.keyword === "additionalProperties") {
    const extra = (err.params as { additionalProperty?: string }).additionalProperty;
    message = `unexpected property "${extra}"`;
  } else if (err.keyword === "required") {
    const missing = (err.params as { missingProperty?: string }).missingProperty;
    message = `missing required property "${missing}"`;
  } else if (err.keyword === "const" || err.keyword === "enum") {
    const allowed = err.params as { allowedValue?: unknown; allowedValues?: unknown[] };
    const values = allowed.allowedValues ?? (allowed.allowedValue !== undefined ? [allowed.allowedValue] : []);
    message = `${message} (${JSON.stringify(values)})`;
  }
  return { path, message };
}

/** Project Ajv errors, dropping the near-identical duplicates anyOf/oneOf branches produce. */
export function collectSchemaIssues(errors: ErrorObject[] | null | undefined): SchemaIssue[] {
  const seen = new Set<string>();
  const issues: SchemaIssue[] = [];
  for (const err of errors ?? []) {
    const issue = formatError(err);
    const key = `${issue.path}::${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
  }
  return issues;
}
