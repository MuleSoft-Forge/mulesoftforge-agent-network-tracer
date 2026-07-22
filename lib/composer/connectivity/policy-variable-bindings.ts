import { parseVariableRef } from "@/lib/composer/connectivity/variable-ref";
import { policyVariableFieldName } from "@/lib/composer/connectivity/policy-config-defaults";
import {
  referencedPolicyBindingNames,
  refBindingNamesFromItems,
} from "@/lib/composer/connectivity/policy-bindings";
import type { ComposerProject, DerivedVariable } from "@/lib/composer/model";

function collectStringValues(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStringValues(v, out);
    }
  }
}

function isSecretVariableField(field: string): boolean {
  const lower = field.toLowerCase();
  return (
    lower.includes("secret") ||
    lower.includes("password") ||
    lower.includes("apikey") ||
    lower === "apikey" ||
    lower.includes("token")
  );
}

function assetNamesForBinding(project: ComposerProject, bindingName: string): string[] {
  return project.assets
    .filter((asset) => {
      const inbound = refBindingNamesFromItems(asset.policies?.inbound);
      const outbound = refBindingNamesFromItems(asset.policies?.outbound);
      return inbound.includes(bindingName) || outbound.includes(bindingName);
    })
    .map((asset) => asset.name);
}

/** Deploy variables implied by ${group.field} placeholders in context.policies configuration. */
export function derivePolicyVariableBindings(project: ComposerProject): DerivedVariable[] {
  const referenced = referencedPolicyBindingNames(project);
  const bindings: DerivedVariable[] = [];
  const seen = new Set<string>();

  for (const bindingName of referenced) {
    const declared = project.policyBindings[bindingName];
    if (!declared) continue;

    const assetNames = assetNamesForBinding(project, bindingName);
    const contextLabel =
      assetNames.length > 0 ? `${assetNames.join(", ")} · ${bindingName}` : bindingName;

    const strings: string[] = [];
    collectStringValues(declared.configuration, strings);

    for (const str of strings) {
      const ref = parseVariableRef(str);
      if (!ref) continue;
      const key = `${ref.group}.${ref.field}`;
      if (seen.has(key)) continue;
      seen.add(key);

      bindings.push({
        group: ref.group,
        field: ref.field,
        description: `${contextLabel} ${ref.field}`,
        secret: isSecretVariableField(ref.field),
        default: "",
      });
    }
  }

  return bindings;
}

export function secretForPolicyVariableField(field: string): boolean {
  return isSecretVariableField(field);
}

export { policyVariableFieldName };
