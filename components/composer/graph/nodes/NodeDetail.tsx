"use client";

import { AlertTriangle, CircleAlert } from "lucide-react";
import type { NodeSummaryChip } from "@/lib/composer/node-summary";
import type { NodeIssueSeverity } from "@/lib/composer/agentfabric-graph-types";

/** Validation status shown on the card so problems are visible without the header dropdown. */
export function NodeIssueDot({
  severity,
  summary,
  onClick,
}: {
  severity?: NodeIssueSeverity;
  summary?: string;
  onClick?: () => void;
}) {
  if (!severity) return null;
  const isError = severity === "error";
  const Icon = isError ? CircleAlert : AlertTriangle;
  return (
    <span
      title={summary}
      aria-label={summary ?? (isError ? "Has errors" : "Has warnings")}
      onClick={(event) => {
        if (!onClick) return;
        event.stopPropagation();
        onClick();
      }}
      className={`ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
        isError ? "text-red-500" : "text-amber-500"
      } ${onClick ? "cursor-pointer hover:opacity-80" : ""}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

export function NodeSummaryChips({
  chips,
  accent,
}: {
  chips?: NodeSummaryChip[];
  accent: string;
}) {
  if (!chips || chips.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span
          key={chip.label}
          title={chip.title}
          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-inset"
          style={{ backgroundColor: `${accent}14`, ["--tw-ring-color" as string]: `${accent}33` }}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}
