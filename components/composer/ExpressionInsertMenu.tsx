"use client";

import { useEffect, useRef, useState } from "react";
import { Braces } from "lucide-react";
import type { ExpressionCatalog } from "@/lib/composer/agentfabric-expression-catalog";
import { A2A_INTERFACE_DOCS_URL } from "@/lib/composer/anf-docs-urls";
interface ExpressionInsertMenuProps {
  catalog: ExpressionCatalog;
  onInsert: (text: string) => void;
  disabled?: boolean;
}

export default function ExpressionInsertMenu({ catalog, onInsert, disabled }: ExpressionInsertMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        buttonRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const hasEntries = catalog.some((g) => g.entries.length > 0);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled || !hasEntries}
        title="Insert AgentFabric expression"
        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => setOpen((v) => !v)}
      >
        <Braces className="h-3.5 w-3.5" />
        Insert
      </button>
      {open && hasEntries ? (
        <div
          ref={menuRef}
          className="absolute right-0 top-full z-50 mt-1 max-h-72 w-80 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          <div className="border-b border-gray-200 px-3 py-2">
            <p className="text-xs font-semibold text-gray-900">Insert expression</p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              Runtime <span className="font-mono">{`{!@…}`}</span> references — resolved by AgentFabric at run time.
            </p>
          </div>
          {catalog.map((group) =>
            group.entries.length === 0 ? null : (
              <div key={group.label} className="border-b border-gray-100 last:border-b-0">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  {group.label}
                </p>
                <ul className="pb-1">
                  {group.entries.map((entry) => (
                    <li key={`${group.label}:${entry.insert}`}>
                      <button
                        type="button"
                        className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-gray-50"
                        onClick={() => {
                          onInsert(entry.insert);
                          setOpen(false);
                        }}
                      >
                        <span className="font-mono text-[11px] text-gray-800">{entry.label}</span>
                        {entry.description ? (
                          <span className="text-[10px] text-gray-500">{entry.description}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
          <div className="border-t border-gray-200 px-3 py-2">
            <a
              href={A2A_INTERFACE_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-primary hover:underline"
            >
              A2A request shape (docs)
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
