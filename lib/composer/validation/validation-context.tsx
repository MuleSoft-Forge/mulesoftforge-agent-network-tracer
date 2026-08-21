"use client";

/**
 * Computes validateProject once per project change and shares it with every
 * surface (strip, tab badges, field rings, inspector, graph). One computation,
 * one reconciled issue set.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useComposer } from "@/lib/composer/store";
import { validateProject } from "@/lib/composer/validate";
import {
  buildResult,
  type ValidationIssue,
  type ValidationResult,
} from "@/lib/composer/validation/issue";
import { issuesByAnchor } from "@/lib/composer/validation/selectors";
import { worstSeverity } from "@/lib/composer/validation/severity";
import { validateProjectAgentScripts } from "@/lib/composer/agentscript-conformance";

interface ValidationContextValue {
  result: ValidationResult;
  anchorMap: Map<string, ValidationIssue[]>;
}

const ValidationContext = createContext<ValidationContextValue | null>(null);

export function ValidationProvider({ children }: { children: ReactNode }) {
  const { project } = useComposer();
  const baseResult = useMemo(() => validateProject(project), [project]);
  const [agentScriptIssues, setAgentScriptIssues] = useState<ValidationIssue[]>([]);

  useEffect(() => {
    let cancelled = false;
    setAgentScriptIssues([]);
    async function validateSerializedAgentScript() {
      try {
        const errors = await validateProjectAgentScripts(project);
        if (cancelled) return;
        setAgentScriptIssues(
          errors.map((error, index) => ({
            code: `schema.agentscript.${index}`,
            severity: "error",
            origin: "schema",
            message: `AgentScript (${error.path}): ${error.message}`,
            location: { tab: "graph" },
          }))
        );
      } catch (error) {
        if (cancelled) return;
        setAgentScriptIssues([
          {
            code: "schema.agentscript.unavailable",
            severity: "error",
            origin: "schema",
            message: `AgentScript validator unavailable: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
            location: { tab: "graph" },
          },
        ]);
      }
    }
    void validateSerializedAgentScript();
    return () => {
      cancelled = true;
    };
  }, [project]);

  const result = useMemo(
    () => buildResult([...baseResult.issues, ...agentScriptIssues]),
    [baseResult, agentScriptIssues]
  );
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
