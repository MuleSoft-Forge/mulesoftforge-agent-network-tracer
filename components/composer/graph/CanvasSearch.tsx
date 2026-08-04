"use client";

import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";

export default function CanvasSearch({
  query,
  matchCount,
  onQueryChange,
  onNext,
  onClose,
}: {
  query: string;
  matchCount: number;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-anypoint border border-composer-border bg-composer-surface/95 px-2 py-1.5 shadow-md backdrop-blur">
      <Search className="h-3.5 w-3.5 shrink-0 text-composer-label-muted" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Find node…"
        aria-label="Find node on canvas"
        className="w-48 bg-transparent text-sm text-gray-900 outline-none placeholder:text-composer-label-muted"
      />
      <span className="shrink-0 text-xs tabular-nums text-composer-label-muted">
        {query.trim() ? `${matchCount} match${matchCount === 1 ? "" : "es"}` : "↵ to cycle"}
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close search"
        className="rounded p-0.5 text-composer-label-muted transition-anypoint hover:bg-composer-surface-muted"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
