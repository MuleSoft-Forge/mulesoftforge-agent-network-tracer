"use client";

import type { LogEntry, SelectedItem } from "./types";

interface TaskDetailsStepNodeProps {
  entry: LogEntry;
  selectedItem: SelectedItem | null;
  onSelectItem: (item: SelectedItem) => void;
  getBadgeClass: (type: string) => string;
  formatTimestamp: (ts: string | number) => string;
}

export default function TaskDetailsStepNode({
  entry,
  selectedItem,
  onSelectItem,
  getBadgeClass,
  formatTimestamp,
}: TaskDetailsStepNodeProps) {
  const entryId = `entry-${entry.index}`;
  const isSelected = selectedItem?.type === "step" && selectedItem.id === entryId;

  return (
    <div
      className={`mb-1 cursor-pointer rounded border px-2 py-1 text-xs transition-colors ${
        isSelected ? "border-indigo-500 bg-indigo-50" : "border-gray-100 bg-gray-50 hover:bg-gray-100"
      }`}
      onClick={() => {
        onSelectItem({ type: "step", id: entryId, data: entry });
      }}
    >
      <div className="flex items-center gap-2">
        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${getBadgeClass(entry.type)}`}>
          {entry.type.replace(/_/g, " ")}
        </span>
        {entry.logger === "INSECURE-LOGGING" && (
          <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-red-700 border border-red-200" title="INSECURE-LOGGING logger">
            ⚠
          </span>
        )}
        <span className="font-mono text-[10px] text-gray-500">{formatTimestamp(entry.timestamp)}</span>
        <span className="flex-1 truncate text-gray-700">{entry.summary}</span>
      </div>
    </div>
  );
}
