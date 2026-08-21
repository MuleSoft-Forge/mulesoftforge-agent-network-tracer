"use client";

/**
 * Popup that surfaces a recognized publish/deploy failure as a plain
 * explanation plus concrete fixes, instead of the raw wall of cascade errors.
 * Driven by the shared catalog in lib/lifecycle/deploy-diagnostics.
 */

import { useEffect, useRef } from "react";
import { AlertTriangle, Info, Lightbulb, ScrollText, X, XCircle } from "lucide-react";
import type {
  DeployDiagnosis,
  DiagnosisSeverity,
} from "@/lib/lifecycle/deploy-diagnostics";

/** A deployment's own Runtime Manager log lines, pulled in after a failed deploy. */
export interface RuntimeManagerLogGroup {
  deployment: string;
  lines: string[];
}

interface DeployDiagnosisDialogProps {
  diagnoses: DeployDiagnosis[];
  /** The step that failed, shown in the header for context. */
  command?: string | null;
  /** Runtime Manager log excerpts fetched for the failed deployment, if any. */
  runtimeLogs?: RuntimeManagerLogGroup[];
  onClose: () => void;
}

const SEVERITY_STYLES: Record<
  DiagnosisSeverity,
  { border: string; icon: string; Icon: typeof AlertTriangle }
> = {
  error: { border: "border-red-200 bg-red-50", icon: "text-red-600", Icon: XCircle },
  warning: { border: "border-amber-200 bg-amber-50", icon: "text-amber-600", Icon: AlertTriangle },
  info: { border: "border-sky-200 bg-sky-50", icon: "text-sky-600", Icon: Info },
};

function DiagnosisCard({ diagnosis, primary }: { diagnosis: DeployDiagnosis; primary: boolean }) {
  const style = SEVERITY_STYLES[diagnosis.severity];
  const { Icon } = style;
  return (
    <div className={`rounded-xl border ${style.border} p-4`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${style.icon}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">{diagnosis.title}</h3>
            {diagnosis.errorCodes.map((code) => (
              <span
                key={code}
                className="rounded-full bg-white/70 px-2 py-0.5 font-mono text-[11px] text-gray-600 ring-1 ring-inset ring-gray-200"
              >
                errorCode {code}
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-gray-700">{diagnosis.explanation}</p>

          {diagnosis.fixes.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <Lightbulb className="h-3.5 w-3.5 text-primary" aria-hidden />
                How to fix
              </div>
              <ol className="mt-2 space-y-2">
                {diagnosis.fixes.map((fix, index) => (
                  <li key={fix.title} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{fix.title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-gray-600">{fix.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {!primary && diagnosis.cascade && (
            <p className="mt-2 text-[11px] text-gray-400">
              Follow-on symptom of the issue above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DeployDiagnosisDialog({
  diagnoses,
  command,
  runtimeLogs,
  onClose,
}: DeployDiagnosisDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  if (diagnoses.length === 0) return null;

  const [primary, ...rest] = diagnoses;
  const commandLabel = command ? command.charAt(0).toUpperCase() + command.slice(1) : null;
  const hasRuntimeLogs = Boolean(runtimeLogs && runtimeLogs.length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deploy-diagnosis-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div>
            <h2 id="deploy-diagnosis-title" className="text-sm font-semibold text-gray-900">
              {commandLabel ? `${commandLabel} failed — here's what happened` : "We spotted a known issue"}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {hasRuntimeLogs
                ? "We recognized this error and pulled the deployment's own Runtime Manager log."
                : "We recognized this error and pulled the real cause out of the CLI output."}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4">
          <DiagnosisCard diagnosis={primary} primary />
          {rest.length > 0 && (
            <>
              <p className="pt-1 text-xs font-medium text-gray-500">
                Other signals we noticed
              </p>
              {rest.map((diagnosis) => (
                <DiagnosisCard key={diagnosis.id} diagnosis={diagnosis} primary={false} />
              ))}
            </>
          )}

          {hasRuntimeLogs && (
            <div className="rounded-xl border border-gray-200 bg-gray-50">
              <div className="flex items-center gap-1.5 border-b border-gray-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <ScrollText className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                Runtime Manager log
              </div>
              <div className="max-h-56 space-y-3 overflow-auto px-3 py-2">
                {runtimeLogs?.map((group) => (
                  <div key={group.deployment}>
                    <p className="mb-1 font-mono text-[11px] text-gray-500">{group.deployment}</p>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-gray-700">
                      {group.lines.join("\n")}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-primary px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-primary/90"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
