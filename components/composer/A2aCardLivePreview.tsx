"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download, FileJson, RotateCcw } from "lucide-react";
import type { BrokerCard } from "@/lib/composer/model";
import { serializeBrokerCard } from "@/lib/composer/a2a-card";
import { evaluateA2aCard } from "@/lib/composer/a2a-card-checks";
import { Button } from "@/components/composer/ui";

function downloadJson(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function StatusPill({ count, label, tone }: { count: number; label: string; tone: "error" | "warning" | "pass" }) {
  const toneCls =
    tone === "error"
      ? count > 0
        ? "text-red-600"
        : "text-gray-400"
      : tone === "warning"
        ? count > 0
          ? "text-amber-600"
          : "text-gray-400"
        : "text-emerald-600";
  return (
    <span className={`text-xs font-medium ${toneCls}`}>
      {count} {label}
    </span>
  );
}

export default function A2aCardLivePreview({
  card,
  onReset,
}: {
  card: BrokerCard;
  onReset?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const json = useMemo(() => JSON.stringify(serializeBrokerCard(card), null, 2), [card]);
  const evaluation = useMemo(() => evaluateA2aCard(card), [card]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (e.g. non-secure context) — ignore.
    }
  }

  function reset() {
    if (!onReset) return;
    if (window.confirm("Reset the A2A card to defaults? Provider, skills, and endpoints will be cleared.")) {
      onReset();
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
          <Check className="h-3.5 w-3.5 text-emerald-500" /> Live validation
        </div>
        <div className="flex items-center gap-3">
          <StatusPill count={evaluation.errors.length} label={evaluation.errors.length === 1 ? "error" : "errors"} tone="error" />
          <StatusPill count={evaluation.warnings.length} label={evaluation.warnings.length === 1 ? "warning" : "warnings"} tone="warning" />
          <StatusPill count={evaluation.passed.length} label="passed" tone="pass" />
        </div>
      </div>

      {evaluation.errors.length > 0 ? (
        <ul className="space-y-1 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
          {evaluation.errors.map((e, i) => (
            <li key={`err-${i}`}>{e}</li>
          ))}
        </ul>
      ) : null}

      {evaluation.warnings.length > 0 ? (
        <details className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-700">
          <summary className="cursor-pointer font-medium">
            {evaluation.warnings.length} recommendation{evaluation.warnings.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {evaluation.warnings.map((w, i) => (
              <li key={`warn-${i}`}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
            <FileJson className="h-3.5 w-3.5 text-gray-400" /> agent-card.json
          </div>
          <div className="flex items-center gap-1.5">
            {onReset ? (
              <Button variant="ghost" className="h-7 px-2 text-xs" onClick={reset} title="Reset to defaults">
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            ) : null}
            <Button
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => downloadJson("agent-card.json", json)}
              title="Download agent-card.json"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </Button>
            <Button variant="secondary" className="h-7 px-2 text-xs" onClick={() => void copy()} title="Copy JSON">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} Copy
            </Button>
          </div>
        </div>
        <pre className="max-h-[calc(100vh-320px)] overflow-auto bg-gray-900 px-3 py-3 text-[11px] leading-relaxed text-gray-100">
          <code>{json}</code>
        </pre>
      </div>
    </div>
  );
}
