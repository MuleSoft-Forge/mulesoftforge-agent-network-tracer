import { formatVariableRef } from "@/lib/composer/connectivity/variable-ref";
import {
  policyConfigFieldSpecs,
  readPolicyConfigField,
  writePolicyConfigField,
  type PolicyConfigFieldSpec,
} from "@/lib/composer/connectivity/policy-schema-fields";

/** exchange.json metadata.variables field name for a policy config path. */
export function policyVariableFieldName(path: string): string {
  const parts = path.split(".").filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? path;
  return parts
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

export function defaultPolicyConfigVariableRef(variableGroup: string, path: string): string {
  return formatVariableRef(variableGroup, policyVariableFieldName(path));
}

export function policyConfigFieldHint(field: PolicyConfigFieldSpec, variableGroup: string): string | undefined {
  if (field.description) return field.description;
  if (field.secret) {
    return `Deploy secret — e.g. ${defaultPolicyConfigVariableRef(variableGroup, field.path)}`;
  }
  if (field.required) {
    return `Required — use ${defaultPolicyConfigVariableRef(variableGroup, field.path)} or a literal`;
  }
  return undefined;
}

/** Fill empty required/secret policy parameters with ${group.field} placeholders. */
export function applyPolicyConfigVariableDefaults(
  configuration: Record<string, unknown>,
  configurationSchema: unknown,
  variableGroup: string
): Record<string, unknown> {
  let next = configuration;
  let changed = false;
  for (const field of policyConfigFieldSpecs(configurationSchema)) {
    if (field.input === "boolean") continue;
    if (readPolicyConfigField(next, field.path)) continue;
    if (!field.secret && !field.required) continue;
    next = writePolicyConfigField(
      next,
      field.path,
      defaultPolicyConfigVariableRef(variableGroup, field.path),
      field.input
    );
    changed = true;
  }
  return changed ? next : configuration;
}
