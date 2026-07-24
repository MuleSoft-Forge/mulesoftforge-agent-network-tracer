"use client";

import { useRef } from "react";
import type { ExpressionCatalog } from "@/lib/composer/agentfabric-expression-catalog";
import ExpressionInsertMenu from "@/components/composer/ExpressionInsertMenu";
import { Field } from "@/components/composer/ui";
import type { HelpEntry } from "@/lib/composer/help/help-catalog";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

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
  catalog: ExpressionCatalog;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <Field label={label} help={help} hint={hint}>
      <div className="relative">
        <textarea
          ref={textareaRef}
          className={`${inputCls} ${mono ? "font-mono text-xs" : ""}`}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
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
      </div>
    </Field>
  );
}
