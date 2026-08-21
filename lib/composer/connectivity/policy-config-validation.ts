/**
 * Validate a policy binding's configuration the way the Anypoint CLI
 * agent-fabric plugin does when it builds or deploys the project: Ajv 2019-09,
 * schema defaults filled in first, plus the plugin's own `dataweaveExpression`
 * format. Without this check the first signal is a failed deploy
 * (error 8002, "Error while trying to validate policies").
 */

import Ajv2019 from "ajv/dist/2019";
import addFormats from "ajv-formats";
import { collectSchemaIssues, type SchemaIssue } from "@/lib/composer/schema/schema-issues";

/**
 * The plugin's format pattern: a value must be a `#[...]` DataWeave expression
 * or a `${...}` deploy variable reference. Literals are rejected.
 */
const DATAWEAVE_EXPRESSION = "^(\\#\\[[\\w\\W]+\\]|\\$\\{[\\w\\W]+\\})$";

/**
 * Errors the CLI would raise for this configuration. Returns [] when the schema
 * can't be compiled, so an unusual policy schema disables the check instead of
 * blocking edits — the CLI stays the real gate.
 */
export function validatePolicyConfiguration(
  configurationSchema: unknown,
  configuration: Record<string, unknown>
): SchemaIssue[] {
  if (!configurationSchema || typeof configurationSchema !== "object") return [];
  try {
    const ajv = new Ajv2019({ strict: false, allErrors: true, useDefaults: true });
    addFormats(ajv);
    ajv.addFormat("dataweaveExpression", DATAWEAVE_EXPRESSION);
    const validate = ajv.compile(configurationSchema);
    // Defaults are applied to a clone before validating, matching the plugin, so
    // an empty configuration is judged on the values the gateway would receive.
    const withDefaults = JSON.parse(JSON.stringify(configuration)) as unknown;
    if (validate(withDefaults)) return [];
    return collectSchemaIssues(validate.errors);
  } catch {
    return [];
  }
}
