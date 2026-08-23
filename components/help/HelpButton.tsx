"use client";

import { CircleHelp, type LucideIcon } from "lucide-react";
import { openHelp } from "@/lib/help/open-help";
import type { HelpPageId } from "@/lib/help/help-map";

/**
 * An affordance that opens the Help centre in a single reused tab, deep-linked to
 * the given page (and optional anchor). Drop it into any product surface's top
 * bar — e.g. <HelpButton page="tracer" anchor="entitlement" label="Tracer help" />.
 *
 * Two visual variants: an icon-only button (default, for dense toolbars) and a
 * labeled pill (`variant="pill"`, when there's room to spell it out). Pass `icon`
 * to override the default "?" glyph — e.g. a book, to sit apart from an existing
 * "?" toggle in the same toolbar.
 */
export default function HelpButton({
  page,
  anchor,
  label = "Help",
  variant = "icon",
  icon: Icon = CircleHelp,
  className = "",
}: {
  page: HelpPageId;
  anchor?: string;
  /** Accessible label + tooltip; also the visible text when variant="pill". */
  label?: string;
  variant?: "icon" | "pill";
  icon?: LucideIcon;
  className?: string;
}) {
  const onClick = () => openHelp(page, anchor);

  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        className={`inline-flex items-center gap-1.5 rounded-anypoint-button border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-primary/40 hover:text-primary ${className}`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-primary ${className}`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
