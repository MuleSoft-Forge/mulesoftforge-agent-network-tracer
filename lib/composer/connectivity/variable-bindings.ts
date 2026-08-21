import { authFieldSpecs } from "@/lib/composer/connectivity/auth-catalog";
import { parseVariableRef } from "@/lib/composer/connectivity/variable-ref";
import type { AuthVariableBinding, ConnectionAuth } from "@/lib/composer/connectivity/types";

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

/** Deploy variables implied by ${group.field} placeholders in connection auth. */
export function deriveAuthVariableBindings(
  auth: ConnectionAuth | undefined,
  assetName: string,
  _fallbackGroup: string
): AuthVariableBinding[] {
  if (!auth) return [];

  const specs = authFieldSpecs(auth.kind);
  const specByField = new Map(
    specs.map((s) => [s.defaultField ?? s.path.split(".").pop()!, s])
  );

  const strings: string[] = [];
  collectStringValues(auth as unknown as Record<string, unknown>, strings);

  const bindings: AuthVariableBinding[] = [];
  const seen = new Set<string>();

  for (const str of strings) {
    const ref = parseVariableRef(str);
    if (!ref) continue;
    const key = `${ref.group}.${ref.field}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const spec = specByField.get(ref.field);
    bindings.push({
      group: ref.group,
      field: ref.field,
      description: spec ? `${assetName} ${spec.label}` : `${assetName} ${ref.field}`,
      secret:
        spec?.secret ??
        (ref.field.toLowerCase().includes("secret") ||
          ref.field.toLowerCase().includes("password") ||
          ref.field === "apiKey"),
      default: "",
    });
  }

  return bindings;
}
