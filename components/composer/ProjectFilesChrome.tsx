"use client";

import { PanelBottomClose, PanelBottomOpen } from "lucide-react";

export function ProjectFilesToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={open ? "Hide Project Files" : "Show Project Files"}
      aria-label={open ? "Hide Project Files" : "Show Project Files"}
      aria-expanded={open}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-anypoint px-2.5 py-1 text-sm font-medium transition-anypoint ${
        open
          ? "text-composer-label-muted hover:bg-composer-surface-muted"
          : "bg-primary text-white hover:bg-primary/90"
      }`}
    >
      {open ? <PanelBottomClose className="h-4 w-4" /> : <PanelBottomOpen className="h-4 w-4" />}
      {open ? "Hide Project Files" : "Show Project Files"}
    </button>
  );
}

export function PreviewResizeHandle({ onResizeStart }: { onResizeStart: (e: React.MouseEvent) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize project files panel"
      onMouseDown={onResizeStart}
      className="group flex h-full min-w-8 flex-1 cursor-ns-resize items-center justify-center hover:bg-gray-100 active:bg-gray-200"
    >
      <div className="h-1 w-10 rounded-full bg-gray-300 transition-colors group-hover:bg-gray-400 group-active:bg-gray-500" />
    </div>
  );
}

export function ProjectFilesClosedBar({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex h-9 shrink-0 items-center border-t border-composer-border bg-composer-surface px-2">
      <ProjectFilesToggle open={false} onToggle={onOpen} />
    </div>
  );
}
