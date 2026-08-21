import type { CustomVariable, DerivedVariable } from "@/lib/composer/model";

/** Stable key for maps/overrides — `${group}.${field}` or flat field name. */
export function variableStorageKey(v: { group?: string; field: string; flat?: boolean }): string {
  return v.flat ? v.field : `${v.group}.${v.field}`;
}

export function isFlatVariable(v: { flat?: boolean }): boolean {
  return v.flat === true;
}

/** Label shown in the Variables panel. */
export function variableDisplayLabel(v: DerivedVariable | CustomVariable): string {
  return v.flat ? v.field : `${v.group}.${v.field}`;
}

/** True when exchange.json entry is a flat variable (not a nested group). */
export function isFlatExchangeVariableEntry(val: Record<string, unknown>): boolean {
  const keys = Object.keys(val);
  if (keys.length === 0) return false;
  const allowed = new Set(["description", "default", "secret"]);
  return keys.every((k) => allowed.has(k));
}

export function customVariablesMatch(a: CustomVariable, b: CustomVariable): boolean {
  if (a.flat || b.flat) return a.field === b.field;
  return a.group === b.group && a.field === b.field;
}
