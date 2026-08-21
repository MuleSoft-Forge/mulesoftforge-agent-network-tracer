"use client";

import { useMemo, useRef, useState } from "react";
import {
  flattenExpressionCatalog,
  type ExpressionCatalog,
} from "@/lib/composer/agentfabric-expression-catalog";
import {
  activeExpressionToken,
  applyExpressionCompletion,
  suggestExpressions,
} from "@/lib/composer/expression-autocomplete";
import ExpressionInsertMenu from "@/components/composer/ExpressionInsertMenu";
import { Field } from "@/components/composer/ui";
import type { HelpEntry } from "@/lib/composer/help/help-catalog";

const inputCls =
  "w-full rounded-md border bg-white px-2.5 py-1.5 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-1";

function insertAtCaret(textarea: HTMLTextAreaElement, text: string, value: string, onChange: (v: string) => void) {
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const next = value.slice(0, start) + text + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    const pos = start + text.length;
    textarea.setSelectionRange(pos, pos);
  });
}

export default function InstructionTextArea({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  rows = 4,
  hint,
  help,
  mono,
  error,
  catalog,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
  help?: HelpEntry;
  mono?: boolean;
  error?: string;
  catalog: ExpressionCatalog;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const entries = useMemo(() => flattenExpressionCatalog(catalog), [catalog]);
  const token = caret === null ? null : activeExpressionToken(value, caret);
  const suggestions = useMemo(
    () => (token ? suggestExpressions(entries, token.text) : []),
    [entries, token]
  );
  const open = token !== null && suggestions.length > 0;

  function complete(insert: string) {
    if (!token) return;
    const next = applyExpressionCompletion(value, token, insert);
    onChange(next.value);
    setCaret(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      complete(suggestions[Math.min(activeIndex, suggestions.length - 1)].insert);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setCaret(null);
    }
  }

  function syncCaret(el: HTMLTextAreaElement) {
    setCaret(el.selectionStart ?? null);
    setActiveIndex(0);
  }

  const borderCls = error
    ? "border-red-400 text-red-900 focus:border-red-500 focus:ring-red-500"
    : "border-gray-300 focus:border-primary focus:ring-primary";

  return (
    <Field label={label} help={help} hint={hint} error={error}>
      <div className="relative">
        <textarea
          ref={textareaRef}
          className={`${inputCls} ${borderCls} ${mono ? "font-mono text-xs" : ""}`}
          rows={rows}
          value={value}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            onChange(e.target.value);
            syncCaret(e.target);
          }}
          onKeyUp={(e) => syncCaret(e.currentTarget)}
          onClick={(e) => syncCaret(e.currentTarget)}
          onKeyDown={onKeyDown}
          // Delay so a click on a suggestion lands before the list unmounts.
          onBlur={() => {
            window.setTimeout(() => setCaret(null), 120);
            onBlur?.();
          }}
        />
        <div className="absolute right-1 top-1">
          <ExpressionInsertMenu
            catalog={catalog}
            onInsert={(text) => {
              const el = textareaRef.current;
              if (!el) {
                onChange(value + text);
                return;
              }
              insertAtCaret(el, text, value, onChange);
            }}
          />
        </div>
        {open ? (
          <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto scrollbar-thin rounded-anypoint border border-composer-border bg-composer-surface py-1 shadow-lg">
            {suggestions.map((entry, index) => (
              <li key={`${entry.group}:${entry.insert}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => complete(entry.insert)}
                  className={`flex w-full flex-col items-start px-2.5 py-1 text-left transition-anypoint ${
                    index === activeIndex ? "bg-primary/10" : ""
                  }`}
                >
                  <span className="font-mono text-xs text-gray-900">{entry.label}</span>
                  {entry.description ? (
                    <span className="text-[11px] text-composer-label-muted">{entry.description}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Field>
  );
}
