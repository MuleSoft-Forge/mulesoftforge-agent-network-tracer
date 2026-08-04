/**
 * Schema-first validation of the agent-network.yaml projection against the
 * OFFICIAL Agent Network v2 JSON Schema (agent_network_v2.json) and its
 * referenced schemas. These schemas are the source of truth: the hand-written
 * checks in validate.ts stay for friendly, model-aware messages, but this
 * guarantees the emitted document actually conforms to the spec.
 *
 * The vendored schemas under ./anf are managed by bundle-config.ts + manifest.json.
 * Refresh with: npm run sync:anf-schemas. Schemas use JSON-LD keywords (@context/@type/@base)
 * and per-definition $schema, so Ajv runs in non-strict mode.
 */

import Ajv from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import {
  AGENT_NETWORK_ROOT_SCHEMA,
  referencedSchemasByFilename,
} from "@/lib/composer/schema/anf/catalog";

/** Referenced schemas keyed by the filename used in their `$ref`s. */
const REFERENCED_SCHEMAS = referencedSchemasByFilename();

export interface SchemaIssue {
  /** JSON pointer-ish path into the document, e.g. "context.connections.x.kind". */
  path: string;
  message: string;
}

let validator: ValidateFunction | null = null;
let buildError: string | null = null;

/** Build (once) the compiled validator for agent_network_v2.json. */
function getValidator(): ValidateFunction | null {
  if (validator || buildError) return validator;
  try {
    const ajv = new Ajv({
      // The spec schemas carry JSON-LD keywords and nested $schema; don't be strict.
      strict: false,
      allErrors: true,
      validateFormats: false,
      allowUnionTypes: true,
    });
    for (const [id, schema] of Object.entries(REFERENCED_SCHEMAS)) {
      ajv.addSchema(schema, id);
    }
    validator = ajv.compile(AGENT_NETWORK_ROOT_SCHEMA);
    return validator;
  } catch (e) {
    buildError = (e as Error).message;
    return null;
  }
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
    const allowed = (err.params as { allowedValue?: unknown; allowedValues?: unknown[] });
    const values = allowed.allowedValues ?? (allowed.allowedValue !== undefined ? [allowed.allowedValue] : []);
    message = `${message} (${JSON.stringify(values)})`;
  }
  return { path, message };
}

/**
 * Validate an agent-network.yaml document object against the official schema.
 * Returns [] when valid, or when the validator itself couldn't be built (so a
 * schema/bundling problem never blocks the UI — it just disables this check).
 */
export function validateAgentNetworkDoc(doc: unknown): SchemaIssue[] {
  const validate = getValidator();
  if (!validate) return [];
  const ok = validate(doc);
  if (ok || !validate.errors) return [];
  // De-dupe: anyOf branches produce many near-identical errors.
  const seen = new Set<string>();
  const issues: SchemaIssue[] = [];
  for (const err of validate.errors) {
    const issue = formatError(err);
    const key = `${issue.path}::${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
  }
  return issues;
}

/** Exposed for diagnostics/tests. */
export function schemaValidatorBuildError(): string | null {
  getValidator();
  return buildError;
}
