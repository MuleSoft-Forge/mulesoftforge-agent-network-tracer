"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import { buildCommands, filterCommands, type Command } from "@/lib/composer/command-palette";

export default function CommandPalette({
  onRun,
  onClose,
}: {
  onRun: (command: Command) => void;
  onClose: () => void;
}) {
  const { project } = useComposer();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(() => buildCommands(project), [project]);
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = results[activeIndex];
      if (command) onRun(command);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[15vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-anypoint border border-composer-border bg-composer-surface shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-composer-border px-3">
          <Search className="h-4 w-4 shrink-0 text-composer-label-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a tab, find a node, or run a command…"
            aria-label="Search commands"
            className="w-full bg-transparent py-3 text-sm text-gray-900 outline-none placeholder:text-composer-label-muted"
          />
        </div>
        {results.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-composer-label-muted">No matches.</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto scrollbar-thin py-1">
            {results.map((command, index) => (
              <li key={command.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => onRun(command)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-anypoint ${
                    index === activeIndex ? "bg-primary/10 text-primary" : "text-composer-label"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  <span className="shrink-0 text-xs capitalize text-composer-label-muted">
                    {command.group}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-composer-border px-3 py-1.5 text-[11px] text-composer-label-muted">
          ↑↓ to navigate · ↵ to run · esc to close
        </div>
      </div>
    </div>
  );
}
