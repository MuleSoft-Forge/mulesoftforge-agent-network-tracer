import type { GraphNodeKind } from "@/lib/composer/model";

/**
 * Per-kind accent colors layered onto the official AgentFabric node look. The
 * card body stays slate/teal/amber; the accent tints the icon + badge so node
 * kind stays readable at a glance (parity with the old Composer color coding).
 * Trigger/router match their dedicated node components (teal / amber).
 */
export const KIND_ACCENT: Record<GraphNodeKind, string> = {
  trigger: "#14b8a6",
  generator: "#178bea",
  orchestrator: "#9a63f9",
  subagent: "#9a63f9",
  executor: "#059669",
  router: "#f59e0b",
  echo: "#0891b2",
};

/** Slate fallback for unknown kinds coming from the protocol graph. */
export const DEFAULT_ACCENT = "#64748b";

export function accentForKind(kind?: string): string {
  if (kind && kind in KIND_ACCENT) return KIND_ACCENT[kind as GraphNodeKind];
  return DEFAULT_ACCENT;
}
