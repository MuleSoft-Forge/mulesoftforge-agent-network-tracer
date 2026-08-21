export type CompletenessFieldTier = "required" | "recommended" | "optional";

export type CompletenessFieldStatus = "set" | "missing" | "error";

export interface CompletenessItem<TFocus = void> {
  id: string;
  label: string;
  /** Where this lands in export files (exchange.json, yaml, .agent). */
  mapsTo: string;
  tier: CompletenessFieldTier;
  status: CompletenessFieldStatus;
  valuePreview: string | null;
  /** Plain-language purpose — why this field exists. */
  why: string;
  schemaMessage?: string;
  focus?: TFocus;
}

export interface CompletenessGroup<TFocus = void> {
  title: string;
  subtitle?: string;
  items: CompletenessItem<TFocus>[];
}

export interface CompletenessSummary {
  requiredSet: number;
  requiredTotal: number;
  recommendedSet: number;
  recommendedTotal: number;
  optionalSet: number;
  optionalTotal: number;
  schemaErrorCount: number;
}

export interface CompletenessResult<TFocus = void> {
  groups: CompletenessGroup<TFocus>[];
  summary: CompletenessSummary;
}

export function countCompletenessTier<TFocus>(
  items: CompletenessItem<TFocus>[],
  tier: CompletenessFieldTier
): { total: number; set: number } {
  const filtered = items.filter((i) => i.tier === tier);
  return {
    total: filtered.length,
    set: filtered.filter((i) => i.status === "set").length,
  };
}

export function summarizeCompleteness<TFocus>(groups: CompletenessGroup<TFocus>[]): CompletenessSummary {
  const flat = groups.flatMap((g) => g.items);
  const required = countCompletenessTier(flat, "required");
  const recommended = countCompletenessTier(flat, "recommended");
  const optional = countCompletenessTier(flat, "optional");
  const schemaErrorCount = flat.filter((i) => i.status === "error").length;
  return {
    requiredSet: required.set,
    requiredTotal: required.total,
    recommendedSet: recommended.set,
    recommendedTotal: recommended.total,
    optionalSet: optional.set,
    optionalTotal: optional.total,
    schemaErrorCount,
  };
}
