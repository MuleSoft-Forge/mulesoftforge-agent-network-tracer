"use client";

import { useEffect, useState } from "react";
import { debugError } from "@/lib/api-logger";

export interface DebugViewerData {
  data: unknown;
  apiUrl: string;
  title?: string;
}

interface DebugViewerProps {
  open: boolean;
  onClose: () => void;
  data: unknown;
  apiUrl: string;
  title?: string;
}

export const DebugViewer = ({ open, onClose, data, apiUrl, title }: DebugViewerProps) => {
  const [viewMode, setViewMode] = useState<"pre" | "post" | "both">("both");
  const [copied, setCopied] = useState<string | null>(null);

  // Check if data has preCanonical and postCanonical (canonical transformation view)
  const hasCanonicalData =
    typeof data === "object" &&
    data !== null &&
    "preCanonical" in data &&
    "postCanonical" in data;

  useEffect(() => {
    if (!open) {
      setViewMode("both");
      setCopied(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  const copyToClipboard = async (text: string, type: "url" | "json" | "pre" | "post") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      debugError("Failed to copy:", err);
    }
  };

  const getJsonString = (obj: unknown, formatted = true) =>
    formatted ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);

  if (!open) return null;

  // Canonical transformation view - prepare data
  const canonicalData = hasCanonicalData
    ? (data as { preCanonical: unknown; postCanonical: unknown; mode?: string })
    : null;
  const preJson = canonicalData ? getJsonString(canonicalData.preCanonical, true) : "";
  const postJson = canonicalData ? getJsonString(canonicalData.postCanonical, true) : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900">
              {title || "Debug Viewer"}
            </h2>
            {apiUrl && (
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-gray-500">API Resource:</span>
                <code className="flex-1 truncate rounded bg-gray-50 px-2 py-1 text-xs font-mono text-gray-700">
                  {apiUrl}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(apiUrl, "url")}
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  title="Copy API URL"
                >
                  {copied === "url" ? "Copied!" : "Copy"}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-6 py-2">
          <div className="flex items-center gap-2">
            {hasCanonicalData ? (
              <>
                <button
                  type="button"
                  onClick={() => setViewMode("pre")}
                  className={`rounded border px-3 py-1 text-xs font-medium transition-colors ${
                    viewMode === "pre"
                      ? "border-primary bg-primary text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Pre-Canonical
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("both")}
                  className={`rounded border px-3 py-1 text-xs font-medium transition-colors ${
                    viewMode === "both"
                      ? "border-primary bg-primary text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Both
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("post")}
                  className={`rounded border px-3 py-1 text-xs font-medium transition-colors ${
                    viewMode === "post"
                      ? "border-primary bg-primary text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Post-Canonical
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setViewMode("pre")}
                  className={`rounded border px-3 py-1 text-xs font-medium transition-colors ${
                    viewMode === "pre"
                      ? "border-primary bg-primary text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Formatted
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("post")}
                  className={`rounded border px-3 py-1 text-xs font-medium transition-colors ${
                    viewMode === "post"
                      ? "border-primary bg-primary text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Raw
                </button>
              </>
            )}
          </div>
          {hasCanonicalData ? (
            <div className="flex gap-2">
              {viewMode === "pre" && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(preJson, "pre")}
                  className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {copied === "pre" ? "Copied!" : "Copy Pre"}
                </button>
              )}
              {viewMode === "post" && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(postJson, "post")}
                  className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {copied === "post" ? "Copied!" : "Copy Post"}
                </button>
              )}
              {viewMode === "both" && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(getJsonString(data, true), "json")}
                  className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {copied === "json" ? "Copied!" : "Copy All"}
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() =>
                copyToClipboard(
                  viewMode === "post" ? getJsonString(data, false) : getJsonString(data, true),
                  "json"
                )
              }
              className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {copied === "json" ? "Copied!" : "Copy JSON"}
            </button>
          )}
        </div>

        {/* Content */}
        {hasCanonicalData ? (
          <div className="flex-1 overflow-auto bg-gray-900">
            {viewMode === "both" ? (
              <div className="grid grid-cols-2 divide-x divide-gray-700">
                <div className="p-6">
                  <div className="mb-2 text-xs font-semibold text-gray-400">Pre-Canonical (Raw API Response)</div>
                  <pre className="text-xs text-gray-100 font-mono leading-relaxed">{preJson}</pre>
                </div>
                <div className="p-6">
                  <div className="mb-2 text-xs font-semibold text-gray-400">Post-Canonical (Transformed)</div>
                  <pre className="text-xs text-gray-100 font-mono leading-relaxed">{postJson}</pre>
                </div>
              </div>
            ) : (
              <div className="p-6">
                <pre className="text-xs text-gray-100 font-mono leading-relaxed">
                  {viewMode === "pre" ? preJson : postJson}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-auto bg-gray-900 p-6">
            <pre className="text-xs text-gray-100 font-mono leading-relaxed">
              {viewMode === "post" ? getJsonString(data, false) : getJsonString(data, true)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
