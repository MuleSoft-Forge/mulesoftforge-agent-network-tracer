"use client";

import { AlertCircle, CheckCircle2, Circle, ChevronRight } from "lucide-react";
import type {
  CompletenessFieldTier,
  CompletenessItem,
  CompletenessResult,
} from "@/lib/composer/completeness-types";

const TIER_LABEL: Record<CompletenessFieldTier, string> = {
  required: "Required",
  recommended: "Recommended",
  optional: "Optional",
};

function tierBadgeClass(tier: CompletenessFieldTier, status: CompletenessItem["status"]): string {
  if (status === "set") {
    return "bg-gray-100 text-gray-500 ring-gray-200";
  }
  switch (tier) {
    case "required":
      return "bg-red-50 text-red-700 ring-red-200";
    case "recommended":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    default:
      return "bg-gray-100 text-gray-600 ring-gray-200";
  }
}

function rowShellClass(status: CompletenessItem["status"], tier: CompletenessFieldTier): string {
  if (status === "set") return "border-emerald-200/80 bg-emerald-50/40";
  if (status === "error") return "border-red-200 bg-red-50/50";
  if (tier === "required") return "border-red-200/70 bg-red-50/30";
  if (tier === "recommended") return "border-amber-200/70 bg-amber-50/25";
  return "border-transparent";
}

function StatusBadge({
  status,
  tier,
  label,
}: {
  status: CompletenessItem["status"];
  tier: CompletenessFieldTier;
  label: string;
}) {
  if (status === "set") {
    return (
      <span
        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-100"
        aria-label={`${label}: complete`}
        title="Complete"
      >
        <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm ring-2 ring-red-100"
        aria-label={`${label}: invalid`}
        title="Invalid"
      >
        <AlertCircle className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
      </span>
    );
  }

  const missingCls =
    tier === "required"
      ? "bg-white text-red-500 ring-2 ring-red-300"
      : tier === "recommended"
        ? "bg-white text-amber-500 ring-2 ring-amber-300"
        : "bg-white text-gray-400 ring-2 ring-gray-200";

  return (
    <span
      className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${missingCls}`}
      aria-label={`${label}: not set`}
      title="Not set"
    >
      <Circle className="h-2.5 w-2.5 fill-current" aria-hidden />
    </span>
  );
}

function CompletenessRow<TFocus>({
  item,
  onFocus,
}: {
  item: CompletenessItem<TFocus>;
  onFocus?: (focus: TFocus) => void;
}) {
  const clickable = item.focus !== undefined && onFocus !== undefined;
  const valueCls =
    item.status === "set"
      ? "text-gray-800"
      : item.status === "error"
        ? "text-red-600"
        : "text-gray-400 italic";

  const shellCls = rowShellClass(item.status, item.tier);

  const body = (
    <>
      <StatusBadge status={item.status} tier={item.tier} label={item.label} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span
            className={`text-[11px] font-medium ${item.status === "set" ? "text-gray-900" : "text-gray-800"}`}
          >
            {item.label}
          </span>
          <span
            className={`inline-flex rounded px-1 py-px text-[8px] font-medium uppercase tracking-wide ring-1 ring-inset ${tierBadgeClass(item.tier, item.status)}`}
          >
            {TIER_LABEL[item.tier]}
          </span>
          {item.status === "set" ? (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-emerald-700">OK</span>
          ) : null}
        </span>
        <span className={`mt-0.5 block truncate font-mono text-[10px] ${valueCls}`}>
          {item.valuePreview ?? (item.status === "error" ? item.schemaMessage ?? "Invalid" : "Not set")}
        </span>
        <span className="mt-0.5 block text-[10px] leading-snug text-gray-400">{item.why}</span>
        <span className="mt-0.5 block truncate text-[9px] text-gray-300">{item.mapsTo}</span>
        {item.schemaMessage && item.status === "error" && item.valuePreview ? (
          <span className="mt-0.5 block text-[10px] text-red-600">{item.schemaMessage}</span>
        ) : null}
      </span>
      {clickable ? (
        <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300 transition-colors group-hover:text-primary" />
      ) : null}
    </>
  );

  if (!clickable) {
    return (
      <div
        className={`flex w-full items-start gap-2.5 rounded-md border px-2 py-1.5 ${shellCls}`}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onFocus!(item.focus as TFocus)}
      className={`group flex w-full items-start gap-2.5 rounded-md border px-2 py-1.5 text-left transition-colors hover:brightness-[0.98] ${shellCls}`}
      title={item.schemaMessage ?? `Open ${item.label}`}
    >
      {body}
    </button>
  );
}

function SummaryBar({
  title,
  summary,
  readyLabel,
}: {
  title: string;
  summary: CompletenessResult["summary"];
  readyLabel?: string;
}) {
  const complete =
    summary.requiredSet === summary.requiredTotal &&
    summary.recommendedSet === summary.recommendedTotal;

  const requiredDone = summary.requiredSet === summary.requiredTotal;
  const recommendedDone = summary.recommendedSet === summary.recommendedTotal;

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-700">{title}</span>
        {summary.schemaErrorCount > 0 ? (
          <span className="text-[10px] font-medium text-red-600">
            {summary.schemaErrorCount} schema {summary.schemaErrorCount === 1 ? "error" : "errors"}
          </span>
        ) : complete ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            {readyLabel ?? "Complete"}
          </span>
        ) : (
          <span className="text-[10px] font-medium text-amber-600">Needs attention</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div
          className={`rounded-md px-2 py-1 ${
            requiredDone ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-red-50/80 ring-1 ring-red-100"
          }`}
        >
          <p className={`text-[10px] font-semibold ${requiredDone ? "text-emerald-800" : "text-red-700"}`}>
            {summary.requiredSet}/{summary.requiredTotal}
          </p>
          <p
            className={`text-[9px] uppercase tracking-wide ${requiredDone ? "text-emerald-700" : "text-red-600"}`}
          >
            Required
          </p>
        </div>
        <div
          className={`rounded-md px-2 py-1 ${
            recommendedDone ? "bg-emerald-50 ring-1 ring-emerald-200" : "bg-amber-50/80 ring-1 ring-amber-100"
          }`}
        >
          <p
            className={`text-[10px] font-semibold ${recommendedDone ? "text-emerald-800" : "text-amber-800"}`}
          >
            {summary.recommendedSet}/{summary.recommendedTotal}
          </p>
          <p
            className={`text-[9px] uppercase tracking-wide ${recommendedDone ? "text-emerald-700" : "text-amber-700"}`}
          >
            Recommended
          </p>
        </div>
        <div className="rounded-md bg-gray-50 px-2 py-1 ring-1 ring-gray-100">
          <p className="text-[10px] font-semibold text-gray-700">
            {summary.optionalSet}/{summary.optionalTotal}
          </p>
          <p className="text-[9px] uppercase tracking-wide text-gray-500">Optional</p>
        </div>
      </div>
    </div>
  );
}

export default function CompletenessPanel<TFocus>({
  title,
  subtitle,
  summaryTitle,
  readyLabel,
  completeness,
  onFocus,
  maxHeightClass = "max-h-[calc(100vh-420px)]",
}: {
  title: string;
  subtitle: string;
  summaryTitle: string;
  readyLabel?: string;
  completeness: CompletenessResult<TFocus>;
  onFocus?: (focus: TFocus) => void;
  maxHeightClass?: string;
}) {
  return (
    <div className="space-y-3">
      <SummaryBar title={summaryTitle} summary={completeness.summary} readyLabel={readyLabel} />
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-3 py-2">
          <p className="text-xs font-semibold text-gray-700">{title}</p>
          <p className="text-[10px] text-gray-400">{subtitle}</p>
        </div>
        <div className={`${maxHeightClass} overflow-auto p-1`}>
          {completeness.groups.map((group) => (
            <section key={group.title} className="py-1">
              <h4 className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                {group.title}
              </h4>
              {group.subtitle ? (
                <p className="px-2 pb-1 text-[10px] leading-snug text-gray-400">{group.subtitle}</p>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <CompletenessRow key={item.id} item={item} onFocus={onFocus} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
