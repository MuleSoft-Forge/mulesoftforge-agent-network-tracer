"use client";

import { useCallback, useEffect, useState } from "react";
import { Bug, Camera, ClipboardPaste, Copy, Loader2, X } from "lucide-react";
import { useBugReport } from "@/components/feedback/BugReportProvider";
import {
  captureTabScreenshot,
  isScreenshotWithinLimit,
  readClipboardScreenshot,
} from "@/lib/feedback/capture-screenshot";
import { collectBugReportContext } from "@/lib/feedback/collect-context";
import { getConsoleBuffer } from "@/lib/feedback/console-buffer";
import type { FeedbackConfigResponse, FeedbackSubmitResponse } from "@/lib/feedback/types";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; issueUrl: string; issueNumber: number }
  | { kind: "error"; message: string };

function BugReportFabButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Report a bug"
      aria-label="Report a bug"
      className="group fixed right-3 top-[3.75rem] z-[60] flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-red-400/35 bg-gradient-to-br from-red-600 via-red-800 to-[#450a0a] text-white shadow-[0_4px_16px_rgba(127,29,29,0.65),inset_0_1px_1px_rgba(255,255,255,0.45)] transition-all duration-200 hover:scale-105 hover:border-red-300/50 hover:shadow-[0_6px_22px_rgba(153,27,27,0.8),inset_0_1px_2px_rgba(255,255,255,0.55)] focus:outline-none focus:ring-2 focus:ring-red-700 focus:ring-offset-2 before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:bg-gradient-to-br before:from-white/40 before:via-white/10 before:to-transparent"
    >
      <Bug className="relative z-10 h-5 w-5 drop-shadow-sm" aria-hidden />
    </button>
  );
}

function BugReportModal() {
  const { open, prefill, closeBugReport } = useBugReport();
  const [description, setDescription] = useState("");
  const [includeConsole, setIncludeConsole] = useState(true);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [config, setConfig] = useState<FeedbackConfigResponse | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [captureBusy, setCaptureBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDescription(prefill?.description ?? "");
    setIncludeConsole(prefill?.includeConsole ?? true);
    setPrivacyConfirmed(false);
    setScreenshot(null);
    setSubmitState({ kind: "idle" });

    fetch("/api/feedback/config")
      .then((r) => r.json())
      .then((data: FeedbackConfigResponse) => setConfig(data))
      .catch(() =>
        setConfig({ enabled: false, contactEmail: "jeffcock@mulesoftforge.com" })
      );
  }, [open, prefill]);

  useEffect(() => {
    if (!open) return;
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === "Escape") closeBugReport();
    }
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, closeBugReport]);

  const handleCapture = useCallback(async () => {
    setCaptureBusy(true);
    try {
      const dataUrl = await captureTabScreenshot();
      if (!dataUrl) {
        setSubmitState({
          kind: "error",
          message: "Capture cancelled or not supported in this browser.",
        });
        return;
      }
      if (!isScreenshotWithinLimit(dataUrl)) {
        setSubmitState({ kind: "error", message: "Screenshot is too large. Try a smaller capture." });
        return;
      }
      setScreenshot(dataUrl);
      setSubmitState({ kind: "idle" });
    } finally {
      setCaptureBusy(false);
    }
  }, []);

  const handlePasteScreenshot = useCallback(async () => {
    setCaptureBusy(true);
    try {
      const dataUrl = await readClipboardScreenshot();
      if (!dataUrl) {
        setSubmitState({
          kind: "error",
          message: "No image found on the clipboard.",
        });
        return;
      }
      if (!dataUrl.startsWith("data:image/png")) {
        setSubmitState({
          kind: "error",
          message: "Only PNG screenshots are supported for upload.",
        });
        return;
      }
      if (!isScreenshotWithinLimit(dataUrl)) {
        setSubmitState({ kind: "error", message: "Screenshot is too large." });
        return;
      }
      setScreenshot(dataUrl);
      setSubmitState({ kind: "idle" });
    } finally {
      setCaptureBusy(false);
    }
  }, []);

  const handleCopyBundle = useCallback(async () => {
    const context = collectBugReportContext();
    const bundle = {
      description: description.trim(),
      context,
      console: includeConsole ? getConsoleBuffer() : [],
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
      setSubmitState({ kind: "idle" });
    } catch {
      setSubmitState({ kind: "error", message: "Could not copy to clipboard." });
    }
  }, [description, includeConsole]);

  const handleSubmit = useCallback(async () => {
    if (description.trim().length < 10) {
      setSubmitState({ kind: "error", message: "Please describe the issue (at least 10 characters)." });
      return;
    }
    if (!privacyConfirmed) {
      setSubmitState({
        kind: "error",
        message: "Confirm the privacy notice before submitting.",
      });
      return;
    }
    if (!config?.enabled) {
      setSubmitState({
        kind: "error",
        message: `Submission is not configured. Email ${config?.contactEmail ?? "the maintainer"}.`,
      });
      return;
    }

    setSubmitState({ kind: "submitting" });
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          includeConsole,
          screenshotDataUrl: screenshot ?? undefined,
          context: collectBugReportContext(),
          consoleEntries: includeConsole ? getConsoleBuffer() : [],
          privacyConfirmed: true,
        }),
      });

      const data = (await res.json()) as FeedbackSubmitResponse & { error?: string };
      if (!res.ok) {
        setSubmitState({
          kind: "error",
          message: data.error ?? "Submission failed.",
        });
        return;
      }

      setSubmitState({
        kind: "success",
        issueUrl: data.issueUrl,
        issueNumber: data.issueNumber,
      });
    } catch {
      setSubmitState({ kind: "error", message: "Network error while submitting." });
    }
  }, [config, description, includeConsole, privacyConfirmed, screenshot]);

  if (!open) return null;

  const context = collectBugReportContext();
  const consoleCount = getConsoleBuffer().length;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeBugReport();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-anypoint border border-gray-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 id="bug-report-title" className="text-base font-semibold text-gray-900">
            Report a bug
          </h2>
          <button
            type="button"
            onClick={closeBugReport}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {submitState.kind === "success" ? (
            <div className="space-y-3 text-sm text-gray-700">
              <p className="font-medium text-green-700">Report submitted — thank you.</p>
              <p>
                GitHub issue{" "}
                <a
                  href={submitState.issueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  #{submitState.issueNumber}
                </a>{" "}
                was created.
              </p>
            </div>
          ) : (
            <>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  What happened?
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  placeholder="Steps to reproduce, expected vs actual behavior, error messages…"
                  className="w-full rounded-anypoint border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                />
              </label>

              <div className="space-y-2">
                <span className="block text-sm font-medium text-gray-700">Screenshot (optional)</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={captureBusy}
                    onClick={() => void handleCapture()}
                    className="inline-flex items-center gap-1.5 rounded-anypoint border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {captureBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Camera className="h-3.5 w-3.5" />
                    )}
                    Capture screen
                  </button>
                  <button
                    type="button"
                    disabled={captureBusy}
                    onClick={() => void handlePasteScreenshot()}
                    className="inline-flex items-center gap-1.5 rounded-anypoint border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                    Paste from clipboard
                  </button>
                  {screenshot ? (
                    <button
                      type="button"
                      onClick={() => setScreenshot(null)}
                      className="rounded-anypoint border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                    >
                      Remove screenshot
                    </button>
                  ) : null}
                </div>
                {screenshot ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user-provided bug screenshot preview
                  <img
                    src={screenshot}
                    alt="Screenshot preview"
                    className="max-h-40 rounded-anypoint border border-gray-200 object-contain"
                  />
                ) : (
                  <p className="text-xs text-gray-500">
                    Capture shares your screen or tab — choose only the app window if it may
                    contain sensitive data.
                  </p>
                )}
              </div>

              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={includeConsole}
                  onChange={(e) => setIncludeConsole(e.target.checked)}
                  className="mt-0.5 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span>
                  Include recent console errors ({consoleCount} captured)
                </span>
              </label>

              <div className="rounded-anypoint bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <p className="font-medium text-gray-700">Auto-attached context</p>
                <ul className="mt-1 space-y-0.5">
                  <li>Route: {context.route || "—"}</li>
                  <li>Version: {context.appVersion}</li>
                  <li>
                    Platform: {context.desktop ? `Desktop (${context.desktopPlatform})` : "Web"}
                  </li>
                </ul>
              </div>

              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={privacyConfirmed}
                  onChange={(e) => setPrivacyConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span>
                  I confirm this report does not include customer secrets, access tokens, or
                  other sensitive Anypoint data I am not allowed to share.
                </span>
              </label>

              {submitState.kind === "error" ? (
                <p className="text-sm text-red-600" role="alert">
                  {submitState.message}
                </p>
              ) : null}

              {!config?.enabled ? (
                <p className="text-xs text-amber-700">
                  GitHub submission is not configured on this deployment. Use{" "}
                  <button
                    type="button"
                    onClick={() => void handleCopyBundle()}
                    className="font-medium underline"
                  >
                    copy debug bundle
                  </button>{" "}
                  and email{" "}
                  <a
                    href={`mailto:${config?.contactEmail ?? "jeffcock@mulesoftforge.com"}`}
                    className="font-medium underline"
                  >
                    {config?.contactEmail ?? "jeffcock@mulesoftforge.com"}
                  </a>
                  .
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3">
          {submitState.kind === "success" ? (
            <button
              type="button"
              onClick={closeBugReport}
              className="ml-auto rounded-anypoint bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleCopyBundle()}
                className="inline-flex items-center gap-1.5 rounded-anypoint border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Copy className="h-4 w-4" />
                Copy debug bundle
              </button>
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={closeBugReport}
                  className="rounded-anypoint border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitState.kind === "submitting" || !config?.enabled}
                  onClick={() => void handleSubmit()}
                  className="inline-flex items-center gap-2 rounded-anypoint bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitState.kind === "submitting" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    "Submit report"
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BugReportWidget() {
  const { open, openBugReport } = useBugReport();

  return (
    <>
      <BugReportFabButton onClick={() => openBugReport()} />
      {open ? <BugReportModal /> : null}
    </>
  );
}
