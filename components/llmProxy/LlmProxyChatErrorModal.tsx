"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

type LlmProxyChatErrorModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  hint: string;
  /** Upstream HTTP status; use 0 when the failure is client-side (no response). */
  httpStatus: number;
  /** Full JSON from `/api/llm-proxy/chat` (error envelope + upstream fields). */
  payload: Record<string, unknown> | null;
};

export default function LlmProxyChatErrorModal({
  open,
  onClose,
  title,
  hint,
  httpStatus,
  payload,
}: LlmProxyChatErrorModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const json =
    payload != null
      ? JSON.stringify(payload, null, 2)
      : "(no response body)";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="llm-proxy-err-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800">
              {httpStatus > 0 ? `HTTP ${httpStatus}` : "Error"}
            </div>
            <h2
              id="llm-proxy-err-title"
              className="text-base font-semibold text-gray-900"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-gray-600">{hint}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase text-gray-500">
            Response from tracer / proxy
          </p>
          <pre className="max-h-64 overflow-auto rounded-md bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">
            <code>{json}</code>
          </pre>
        </div>
        <div className="border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
