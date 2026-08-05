/**
 * Single source of truth for how severity maps to color/visual tokens. Every
 * validation surface imports from here so red/amber/gray mean the same thing
 * (error / warning / info) everywhere and no component invents its own colors.
 */

import type { IssueSeverity } from "@/lib/composer/validation/issue";

export interface SeverityTokens {
  /** Text color. */
  text: string;
  /** Focus/highlight ring color for offending fields. */
  ring: string;
  /** Pill/badge background + text. */
  badge: string;
  /** Small status dot background. */
  dot: string;
  /** Subtle row/section tint. */
  tint: string;
}

export const SEVERITY_UI: Record<IssueSeverity, SeverityTokens> = {
  error: {
    text: "text-red-700",
    ring: "ring-2 ring-red-300",
    badge: "bg-red-100 text-red-700",
    dot: "bg-red-500",
    tint: "border-red-200 bg-red-50/40",
  },
  warning: {
    text: "text-amber-700",
    ring: "ring-2 ring-amber-300",
    badge: "bg-amber-100 text-amber-700",
    dot: "bg-amber-500",
    tint: "border-amber-200 bg-amber-50/30",
  },
  info: {
    text: "text-gray-600",
    ring: "ring-2 ring-gray-300",
    badge: "bg-gray-100 text-gray-600",
    dot: "bg-gray-400",
    tint: "border-gray-200 bg-gray-50/40",
  },
};

const RANK: Record<IssueSeverity, number> = { error: 3, warning: 2, info: 1 };

/** Highest-priority severity in a set, or null when empty. */
export function worstSeverity(severities: Iterable<IssueSeverity>): IssueSeverity | null {
  let worst: IssueSeverity | null = null;
  for (const s of severities) {
    if (!worst || RANK[s] > RANK[worst]) worst = s;
  }
  return worst;
}
