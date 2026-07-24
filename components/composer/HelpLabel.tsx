"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import HelpTip from "@/components/composer/HelpTip";
import type { HelpEntry } from "@/lib/composer/help/help-catalog";
import { useHelpMode } from "@/lib/composer/help/help-mode";

const labelCls = "text-xs font-medium text-gray-600";
const uppercaseLabelCls = "text-[10px] font-semibold uppercase tracking-wide text-gray-500";

/** Form field label row with optional Tier-2 help popover. */
export function HelpLabel({
  label,
  help,
  uppercase,
  className,
}: {
  label: string;
  help?: HelpEntry;
  uppercase?: boolean;
  className?: string;
}) {
  const { helpMode } = useHelpMode();

  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-1">
        <span className={uppercase ? uppercaseLabelCls : labelCls}>{label}</span>
        {help ? <HelpTip entry={help} align="left" /> : null}
      </div>
      {helpMode && help ? (
        <p className="mb-1 text-[10px] leading-snug text-primary/80">{help.tagline}</p>
      ) : null}
    </div>
  );
}

/** Section header (non-field) with help and optional trailing action. */
export function HelpSectionHeader({
  label,
  help,
  action,
}: {
  label: string;
  help: HelpEntry;
  action?: ReactNode;
}) {
  const { helpMode } = useHelpMode();

  return (
    <div className="mb-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="text-xs font-medium text-gray-600">{label}</span>
          <HelpTip entry={help} align="left" />
        </div>
        {action}
      </div>
      {helpMode ? <p className="mt-0.5 text-[10px] leading-snug text-primary/80">{help.tagline}</p> : null}
    </div>
  );
}

/** Panel intro block with title, help popover, and collapsible body copy. */
export function HelpPanelIntro({ help, children }: { help: HelpEntry; children?: ReactNode }) {
  const { helpMode } = useHelpMode();
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-md border border-gray-100 bg-gray-50/80">
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1 rounded py-0.5 text-left transition-colors hover:bg-gray-100/80"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          )}
          <span className="text-xs font-semibold text-gray-700">{help.title}</span>
        </button>
        <HelpTip entry={help} align="left" />
      </div>
      {open ? (
        <div className="space-y-1.5 border-t border-gray-100 px-3 py-2">
          <p className="text-xs leading-relaxed text-gray-500">{help.whatItDoes}</p>
          {helpMode && help.whenToUse.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-gray-600">
              {help.whenToUse.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
