"use client";

import { useEffect, useRef } from "react";
import { MuleIcon } from "@/components/composer/MuleIcon";
import { accentForKind } from "@/components/composer/graph/kind-accent";
import { helpForNodeKind } from "@/lib/composer/help/help-catalog";
import type { GraphNodeKind } from "@/lib/composer/model";

/**
 * Compact kind chooser anchored at a screen position. Used when a connection is
 * dropped on empty canvas and when splicing a node into an existing edge.
 */
export default function NodeKindPicker({
  kinds,
  screenX,
  screenY,
  title,
  onPick,
  onDismiss,
}: {
  kinds: GraphNodeKind[];
  screenX: number;
  screenY: number;
  title: string;
  onPick: (kind: GraphNodeKind) => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onDismiss();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      className="fixed z-50 w-52 rounded-anypoint border border-composer-border bg-composer-surface p-2 shadow-lg"
      style={{ left: screenX, top: screenY }}
    >
      <p className="px-1 pb-1.5 text-xs font-semibold uppercase tracking-wide text-composer-label-muted">
        {title}
      </p>
      <div className="flex flex-col">
        {kinds.map((kind) => {
          const accent = accentForKind(kind);
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onPick(kind)}
              title={helpForNodeKind(kind).tagline}
              className="flex items-center gap-2 rounded-anypoint px-1.5 py-1.5 text-left transition-anypoint hover:bg-primary/5"
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
                style={{ backgroundColor: `${accent}1f` }}
              >
                <MuleIcon kind={kind} size={14} />
              </span>
              <span className="text-sm capitalize text-composer-label">{kind}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
