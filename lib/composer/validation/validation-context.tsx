"use client";

/**
 * Computes validateProject once per project change and shares it with every
 * surface (strip, tab badges, field rings, inspector, graph). One computation,
 * one reconciled issue set.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useComposer } from "@/lib/composer/store";
import { validateProject } from "@/lib/composer/validate";
import type { ValidationIssue, ValidationResult } from "@/lib/composer/validation/issue";
import { issuesByAnchor } from "@/lib/composer/validation/selectors";
import { worstSeverity } from "@/lib/composer/validation/severity";

interface ValidationContextValue {
  result: ValidationResult;
  anchorMap: Map<string, ValidationIssue[]>;
}

const ValidationContext = createContext<ValidationContextValue | null>(null);

export function ValidationProvider({ children }: { children: ReactNode }) {
  const { project } = useComposer();
  const result = useMemo(() => validateProject(project), [project]);
  const anchorMap = useMemo(() => issuesByAnchor(result), [result]);
  const value = useMemo<ValidationContextValue>(() => ({ result, anchorMap }), [result, anchorMap]);
  return <ValidationContext.Provider value={value}>{children}</ValidationContext.Provider>;
}

/** Shared validation result. Falls back to a fresh compute outside the provider. */
export function useValidationResult(): ValidationResult {
  const ctx = useContext(ValidationContext);
  const { project } = useComposer();
  const fallback = useMemo(() => (ctx ? ctx.result : validateProject(project)), [ctx, project]);
  return ctx?.result ?? fallback;
}

/** Worst issue pointing at a given field anchor, or null. */
export function useFieldIssue(anchor: string | undefined): ValidationIssue | null {
  const ctx = useContext(ValidationContext);
  return useMemo(() => {
    if (!anchor || !ctx) return null;
    const list = ctx.anchorMap.get(anchor);
    if (!list || list.length === 0) return null;
    const worst = worstSeverity(list.map((i) => i.severity));
    return list.find((i) => i.severity === worst) ?? list[0];
  }, [anchor, ctx]);
}
