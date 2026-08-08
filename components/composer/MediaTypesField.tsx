"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, FieldGroup, composerInputCls } from "@/components/composer/ui";
import type { HelpEntry } from "@/lib/composer/help/help-catalog";
import { SUGGESTED_MEDIA_TYPES, isMediaType, normalizeMediaType } from "@/lib/composer/media-types";

const chipCls =
  "inline-flex items-center gap-1 rounded-anypoint px-1.5 py-0.5 font-mono text-[11px] transition-anypoint";

/**
 * Picker for A2A content mode arrays (defaultInputModes, skill inputModes, …).
 *
 * Offers the documented media types as one-click chips but still accepts any
 * value, because A2A does not constrain these fields to an enum.
 */
export function MediaTypesField({
  label,
  value,
  onChange,
  help,
  hint,
  uppercaseLabel,
  fallback,
}: {
  label: string;
  value: string[] | undefined;
  onChange: (next: string[] | undefined) => void;
  help?: HelpEntry;
  hint?: string;
  uppercaseLabel?: boolean;
  /** Written instead of `undefined` when the last value is removed. */
  fallback?: string[];
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const selected = value ?? [];
  const suggestions = SUGGESTED_MEDIA_TYPES.filter((type) => !selected.includes(type));

  const trimmed = draft?.trim() ?? "";
  const normalized = normalizeMediaType(trimmed);
  const draftError = !trimmed
    ? undefined
    : selected.includes(normalized)
      ? `${normalized} is already selected.`
      : !isMediaType(normalized)
        ? "Enter a media type, for example application/pdf."
        : undefined;

  function commit(next: string[]) {
    onChange(next.length > 0 ? next : fallback);
  }

  function addDraft() {
    if (!trimmed || draftError) return;
    commit([...selected, normalized]);
    setDraft("");
  }

  return (
    <FieldGroup label={label} help={help} hint={hint} uppercaseLabel={uppercaseLabel} error={draftError}>
      <div className="rounded-anypoint border border-gray-300 bg-composer-surface p-1.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-1">
          {selected.map((type) => (
            <span key={type} className={`${chipCls} border border-primary bg-primary/10 text-primary`}>
              {type}
              <button
                type="button"
                aria-label={`Remove ${type}`}
                title={`Remove ${type}`}
                className="rounded-anypoint text-primary/60 transition-anypoint hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                onClick={() => commit(selected.filter((entry) => entry !== type))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {suggestions.map((type) => (
            <button
              key={type}
              type="button"
              className={`${chipCls} border border-dashed border-gray-300 text-gray-500 hover:border-primary hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary`}
              onClick={() => commit([...selected, type])}
            >
              <Plus className="h-3 w-3" />
              {type}
            </button>
          ))}
          {draft === null ? (
            <button
              type="button"
              className={`${chipCls} border border-dashed border-gray-300 text-gray-500 hover:border-primary hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary`}
              onClick={() => setDraft("")}
            >
              <Plus className="h-3 w-3" />
              Custom
            </button>
          ) : null}
        </div>
        {draft !== null ? (
          <div className="mt-1.5 flex items-center gap-1">
            <input
              type="text"
              autoFocus
              className={`${composerInputCls} font-mono text-xs`}
              placeholder="application/pdf"
              value={draft}
              aria-label={`Custom media type for ${label}`}
              aria-invalid={draftError ? true : undefined}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDraft();
                } else if (e.key === "Escape") {
                  setDraft(null);
                }
              }}
            />
            <Button onClick={addDraft} disabled={!trimmed || Boolean(draftError)}>
              Add
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        ) : null}
      </div>
    </FieldGroup>
  );
}
