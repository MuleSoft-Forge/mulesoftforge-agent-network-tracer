"use client";

import type { LogEntry } from "./types";

interface TaskDetailsLogEntryProps {
  entry: LogEntry;
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  getBadgeClass: (type: string) => string;
  formatTimestamp: (ts: string | number) => string;
}

export default function TaskDetailsLogEntry({
  entry,
  isSelected,
  isExpanded,
  onSelect,
  onToggle,
  getBadgeClass,
  formatTimestamp,
}: TaskDetailsLogEntryProps) {
  return (
    <div className={`border-b border-gray-100 text-xs transition-colors ${isSelected ? "bg-indigo-50" : "hover:bg-gray-50"}`}>
      <div className="flex cursor-pointer items-center gap-2 py-1" onClick={onToggle}>
        <span className="font-mono text-[10px] text-gray-500 min-w-[80px]">{formatTimestamp(entry.timestamp)}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${getBadgeClass(entry.type)}`}>
          {entry.type.replace(/_/g, " ")}
        </span>
        {entry.logger === "INSECURE-LOGGING" && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-red-700 border border-red-200" title="INSECURE-LOGGING logger">
            ⚠ INSECURE
          </span>
        )}
        <span className="flex-1 truncate text-gray-700">{entry.summary}</span>
      </div>
      {isExpanded && (
        <div className="mt-2 rounded bg-gray-50 p-2 text-[10px]">
          {entry.fields.toolInputJson != null && (
            <div className="mb-2">
              <p className="mb-1 font-semibold">Tool Input:</p>
              <pre className="max-h-96 overflow-auto scrollbar-thin rounded bg-white p-1 text-[10px]">
                {(() => {
                  const value = entry.fields.toolInputJson;
                  if (value == null) return "";
                  if (typeof value === "string") {
                    try {
                      const parsed = JSON.parse(value);
                      return JSON.stringify(parsed, null, 2);
                    } catch {
                      return value;
                    }
                  }
                  if (typeof value === "object") {
                    return JSON.stringify(value, null, 2);
                  }
                  return String(value);
                })()}
              </pre>
            </div>
          )}
          {entry.fields.toolOutputJson != null && (
            <div className="mb-2">
              <p className="mb-1 font-semibold">Tool Output:</p>
              <pre className="max-h-96 overflow-auto scrollbar-thin rounded bg-white p-1 text-[10px]">
                {(() => {
                  const value = entry.fields.toolOutputJson;
                  if (value == null) return "";
                  if (typeof value === "string") {
                    try {
                      const parsed = JSON.parse(value);
                      return JSON.stringify(parsed, null, 2);
                    } catch {
                      return value;
                    }
                  }
                  if (typeof value === "object") {
                    return JSON.stringify(value, null, 2);
                  }
                  return String(value);
                })()}
              </pre>
            </div>
          )}
          {entry.fields.userMessage != null && entry.fields.userMessage !== "" && (
            <div className="mb-2">
              <p className="mb-1 font-semibold">User Message:</p>
              <pre className="max-h-96 overflow-auto scrollbar-thin rounded bg-white p-1 text-[10px]">
                {(() => {
                  try {
                    const parsed = JSON.parse(entry.fields.userMessage);
                    return JSON.stringify(parsed, null, 2);
                  } catch {
                    return entry.fields.userMessage;
                  }
                })()}
              </pre>
            </div>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-gray-500">Show raw log</summary>
            <pre className="mt-1 max-h-96 overflow-auto scrollbar-thin rounded bg-white p-1 text-[10px]">
              {typeof entry.raw.message === "string" ? entry.raw.message : ""}
            </pre>
            <div className="mt-1 text-[9px] text-gray-400">
              index: {entry._index} | _id: {entry._id} | logger: {entry.logger} | level: {entry.level} | app:{" "}
              {entry.appId}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
