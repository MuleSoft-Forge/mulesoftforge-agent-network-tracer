/**
 * Single unified issue model for the whole Composer. Every validation surface
 * (top strip, left tab badges, right rail, field rings, graph node dots, export
 * gating) reads from ValidationIssue[] produced by one source (validateProject),
 * so counts always reconcile and routing never depends on message wording.
 */

export type IssueSeverity = "error" | "warning" | "info";

/** Composer sidebar tab ids — kept in sync with ProjectPanels PanelTab. */
export type IssueTab =
  | "identity"
  | "registry"
  | "assets"
  | "variables"
  | "access"
  | "a2a-card"
  | "behavior"
  | "llms"
  | "actions"
  | "graph";

export type CompletenessTier = "required" | "recommended" | "optional";

export interface RegistryYamlFocus {
  kind: "agents" | "mcps" | "llms";
  key: string;
  anchor?: string;
}

/**
 * Structured, explicit pointer for where an issue lives and is fixed. Replaces
 * the old loose `target` plus all downstream regex-on-message routing.
 */
export interface IssueLocation {
  tab: IssueTab;
  /** DOM anchor id of the offending field — joins editor input AND completeness row. */
  fieldAnchor?: string;
  nodeId?: string;
  assetId?: string;
  actionId?: string;
  registry?: RegistryYamlFocus;
}

export type IssueOrigin = "consistency" | "schema" | "completeness";

export interface ValidationIssue {
  /** Stable, grouped identifier (e.g. "graph.router.no-route"). Never routed on message text. */
  code: string;
  severity: IssueSeverity;
  /** Display only. */
  message: string;
  location: IssueLocation;
  /** Present when the issue originates from a completeness field tier. */
  tier?: CompletenessTier;
  origin: IssueOrigin;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
}

/** The single tier -> severity ladder used everywhere. */
export function severityForTier(tier: CompletenessTier): IssueSeverity {
  switch (tier) {
    case "required":
      return "error";
    case "recommended":
      return "warning";
    case "optional":
      return "info";
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

export function buildResult(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const info = issues.filter((i) => i.severity === "info");
  return { ok: errors.length === 0, issues, errors, warnings, info };
}
