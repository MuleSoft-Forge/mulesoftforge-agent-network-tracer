"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, Circle, ChevronRight } from "lucide-react";
import type {
  CompletenessFieldTier,
  CompletenessItem,
  CompletenessResult,
} from "@/lib/composer/completeness-types";
import type { IssueSeverity } from "@/lib/composer/validation/issue";
import { SEVERITY_UI } from "@/lib/composer/validation/severity";
import { useFieldIssue } from "@/lib/composer/validation/validation-context";

const TIER_LABEL: Record<CompletenessFieldTier, string> = {
  required: "Required",
  recommended: "Recommended",
  optional: "Optional",
};

/**
 * A row's effective severity: a live issue on its anchor wins; otherwise a
 * missing required/recommended field maps through the shared tier ladder.
 * Optional-missing and set rows carry no severity (neutral / done).
 */
function rowSeverity(
  status: CompletenessItem["status"],
  tier: CompletenessFieldTier,
  issueSeverity: IssueSeverity | null
): IssueSeverity | null {
  if (issueSeverity) return issueSeverity;
  if (status === "set") return null;
  if (status === "error") return "error";
  if (tier === "required") return "error";
  if (tier === "recommended") return "warning";
  return null;
}

function StatusBadge({ severity, label }: { severity: IssueSeverity | null; label: string }) {
  if (severity === null) {
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
  if (severity === "error") {
    return (
      <span
        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm ring-2 ring-red-100"
        aria-label={`${label}: error`}
        title="Needs attention"
      >
        <AlertCircle className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (severity === "warning") {
    return (
      <span
        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm ring-2 ring-amber-100"
        aria-label={`${label}: recommended`}
        title="Recommended"
      >
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  return (
    <span
      className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-gray-400 ring-2 ring-gray-200"
      aria-label={`${label}: optional`}
      title="Optional"
    >
      <Circle className="h-2.5 w-2.5 fill-current" aria-hidden />
    </span>
  );
}

function CompletenessRow<TFocus>({
  item,
  onFocus,
  resolveAnchor,
}: {
  item: CompletenessItem<TFocus>;
  onFocus?: (focus: TFocus) => void;
  resolveAnchor?: (focus: TFocus) => string | undefined;
}) {
  const anchor = item.focus !== undefined && resolveAnchor ? resolveAnchor(item.focus) : undefined;
  const liveIssue = useFieldIssue(anchor);
  const severity = rowSeverity(item.status, item.tier, liveIssue?.severity ?? null);
  const clickable = item.focus !== undefined && onFocus !== undefined;

  const tone = severity ? SEVERITY_UI[severity] : null;
  const shellCls = tone ? `border ${tone.tint}` : "border border-transparent";
  const message = liveIssue?.message ?? (severity ? item.schemaMessage : undefined);

  const valueCls = severity === "error" ? "text-red-600" : item.status === "set" ? "text-gray-800" : "text-gray-400 italic";

  const body = (
    <>
      <StatusBadge severity={severity} label={item.label} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-gray-900">{item.label}</span>
          <span className="text-[8px] font-medium uppercase tracking-wide text-gray-400">{TIER_LABEL[item.tier]}</span>
        </span>
        <span className={`mt-0.5 block truncate font-mono text-[10px] ${valueCls}`}>
          {item.valuePreview ?? (severity ? message ?? "Not set" : "Not set")}
        </span>
        <span className="mt-0.5 block text-[10px] leading-snug text-gray-400">{item.why}</span>
        <span className="mt-0.5 block truncate text-[9px] text-gray-300">{item.mapsTo}</span>
        {message && item.valuePreview ? (
          <span className={`mt-0.5 block text-[10px] ${tone?.text ?? "text-gray-500"}`}>{message}</span>
        ) : null}
      </span>
      {clickable ? (
        <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300 transition-colors group-hover:text-primary" />
      ) : null}
    </>
  );

  if (!clickable) {
    return <div className={`flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 ${shellCls}`}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onFocus!(item.focus as TFocus)}
      className={`group flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:brightness-[0.98] ${shellCls}`}
      title={message ?? `Open ${item.label}`}
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
  const requiredDone = summary.requiredSet === summary.requiredTotal;
  const recommendedDone = summary.recommendedSet === summary.recommendedTotal;
  const complete = requiredDone && recommendedDone;

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <span className="text-xs font-semibold text-gray-700">{title}</span>
      <div className="flex items-center gap-2 text-[10px]">
        <span className={requiredDone ? "text-emerald-700" : "font-semibold text-red-600"}>
          {summary.requiredSet}/{summary.requiredTotal} required
        </span>
        <span className="text-gray-300" aria-hidden>
          ·
        </span>
        <span className={recommendedDone ? "text-emerald-700" : "text-amber-700"}>
          {summary.recommendedSet}/{summary.recommendedTotal} rec
        </span>
        {complete ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            {readyLabel ?? "Complete"}
          </span>
        ) : null}
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
  resolveAnchor,
  maxHeightClass = "max-h-[calc(100vh-420px)]",
}: {
  title: string;
  subtitle: string;
  summaryTitle: string;
  readyLabel?: string;
  completeness: CompletenessResult<TFocus>;
  onFocus?: (focus: TFocus) => void;
  resolveAnchor?: (focus: TFocus) => string | undefined;
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
                  <CompletenessRow key={item.id} item={item} onFocus={onFocus} resolveAnchor={resolveAnchor} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
