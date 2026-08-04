"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download, FileJson, RotateCcw } from "lucide-react";
import type { BrokerCard } from "@/lib/composer/model";
import type { A2aCardFieldAnchor } from "@/lib/composer/a2a-card-field-anchors";
import { serializeBrokerCard } from "@/lib/composer/a2a-card";
import { buildA2aCardCompleteness } from "@/lib/composer/a2a-card-completeness";
import { adaptA2aCardCompleteness } from "@/lib/composer/a2a-card-completeness-view";
import CompletenessPanel from "@/components/composer/CompletenessPanel";
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

export default function A2aCardLivePreview({
  card,
  onReset,
  onFocusField,
}: {
  card: BrokerCard;
  onReset?: () => void;
  onFocusField?: (anchor: A2aCardFieldAnchor) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);

  const json = useMemo(() => JSON.stringify(serializeBrokerCard(card), null, 2), [card]);
  const completeness = useMemo(
    () => adaptA2aCardCompleteness(buildA2aCardCompleteness(card)),
    [card]
  );

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
      <CompletenessPanel
        summaryTitle="Card completeness"
        readyLabel="Production-ready"
        title="Spec vs current card"
        subtitle="Required fields block a usable contract · recommended improves discoverability"
        completeness={completeness}
        onFocus={onFocusField}
      />

      <details
        open={jsonOpen}
        onToggle={(e) => setJsonOpen(e.currentTarget.open)}
        className="overflow-hidden rounded-lg border border-gray-200 shadow-sm"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2 marker:content-none">
          <div className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
            <FileJson className="h-3.5 w-3.5 text-gray-400" /> agent-card.json
          </div>
          <div className="flex items-center gap-1.5" onClick={(e) => e.preventDefault()}>
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
        </summary>
        <pre className="max-h-72 overflow-auto bg-gray-900 px-3 py-3 text-[11px] leading-relaxed text-gray-100">
          <code>{json}</code>
        </pre>
      </details>
    </div>
  );
}
