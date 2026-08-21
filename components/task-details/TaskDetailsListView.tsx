"use client";

import type { JobCard, LogEntry, ListViewGroupedEntries, SelectedItem } from "./types";
import TaskDetailsLogEntry from "./TaskDetailsLogEntry";

interface TaskDetailsListViewProps {
  jobCard: JobCard;
  groupedEntries: ListViewGroupedEntries | null;
  selectedItem: SelectedItem | null;
  expandedEntries: Set<number>;
  setExpandedEntries: React.Dispatch<React.SetStateAction<Set<number>>>;
  onSelectItem: (item: SelectedItem) => void;
  getBadgeClass: (type: string) => string;
  formatTimestamp: (ts: string | number) => string;
}

export default function TaskDetailsListView({
  jobCard,
  groupedEntries,
  selectedItem,
  expandedEntries,
  setExpandedEntries,
  onSelectItem,
  getBadgeClass,
  formatTimestamp,
}: TaskDetailsListViewProps) {
  if (!groupedEntries) return null;

  return (
    <div className="p-4">
      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h3 className="mb-2 text-base font-semibold text-gray-900">
          Task {jobCard.taskId}{" "}
          <span
            className={`text-sm font-normal ${jobCard.outcome === "completed" ? "text-green-700" : "text-red-700"}`}
          >
            {jobCard.outcome || "in progress"}
          </span>
        </h3>
        {jobCard.userMessage != null && jobCard.userMessage !== "" && (
          <div className="mb-3 rounded border-l-4 border-blue-600 bg-white p-2 text-sm italic text-gray-700">
            {jobCard.userMessage}
          </div>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="font-semibold uppercase text-gray-600">Task ID</dt>
          <dd className="font-mono text-gray-900">{jobCard.taskId}</dd>
          <dt className="font-semibold uppercase text-gray-600">Duration</dt>
          <dd className="text-gray-900">{jobCard.duration || "?"}s</dd>
          <dt className="font-semibold uppercase text-gray-600">Iterations</dt>
          <dd className="text-gray-900">{jobCard.iterations}</dd>
          <dt className="font-semibold uppercase text-gray-600">Tools</dt>
          <dd className="text-gray-900">{jobCard.toolsUsed.join(", ") || "none"}</dd>
        </dl>
      </div>

      {groupedEntries.preEntries.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 border-b border-blue-200 pb-1 text-sm font-bold text-blue-600">
            Inbound + Discovery
          </div>
          {groupedEntries.preEntries.map((entry: LogEntry) => (
            <TaskDetailsLogEntry
              key={entry.index}
              entry={entry}
              isSelected={selectedItem?.type === "step" && selectedItem.id === `entry-${entry.index}`}
              isExpanded={expandedEntries.has(entry.index)}
              onSelect={() => onSelectItem({ type: "step", id: `entry-${entry.index}`, data: entry })}
              onToggle={() => {
                const newExpanded = new Set(expandedEntries);
                if (newExpanded.has(entry.index)) {
                  newExpanded.delete(entry.index);
                } else {
                  newExpanded.add(entry.index);
                }
                setExpandedEntries(newExpanded);
              }}
              getBadgeClass={getBadgeClass}
              formatTimestamp={formatTimestamp}
            />
          ))}
        </div>
      )}

      {groupedEntries.iterations.map((iter: (typeof groupedEntries.iterations)[0]) => (
        <div key={iter.id} className="mb-4">
          <div className="mb-2 border-b border-blue-200 pb-1 text-sm font-bold text-blue-600">
            Iteration {iter.iteration}: {iter.toolName}
          </div>
          {iter.entries.map((entry: LogEntry) => (
            <TaskDetailsLogEntry
              key={entry.index}
              entry={entry}
              isSelected={selectedItem?.type === "step" && selectedItem.id === `entry-${entry.index}`}
              isExpanded={expandedEntries.has(entry.index)}
              onSelect={() => onSelectItem({ type: "step", id: `entry-${entry.index}`, data: entry })}
              onToggle={() => {
                const newExpanded = new Set(expandedEntries);
                if (newExpanded.has(entry.index)) {
                  newExpanded.delete(entry.index);
                } else {
                  newExpanded.add(entry.index);
                }
                setExpandedEntries(newExpanded);
              }}
              getBadgeClass={getBadgeClass}
              formatTimestamp={formatTimestamp}
            />
          ))}
        </div>
      ))}

      {groupedEntries.postEntries.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 border-b border-blue-200 pb-1 text-sm font-bold text-blue-600">
            Response + Gateway
          </div>
          {groupedEntries.postEntries.map((entry: LogEntry) => (
            <TaskDetailsLogEntry
              key={entry.index}
              entry={entry}
              isSelected={selectedItem?.type === "step" && selectedItem.id === `entry-${entry.index}`}
              isExpanded={expandedEntries.has(entry.index)}
              onSelect={() => onSelectItem({ type: "step", id: `entry-${entry.index}`, data: entry })}
              onToggle={() => {
                const newExpanded = new Set(expandedEntries);
                if (newExpanded.has(entry.index)) {
                  newExpanded.delete(entry.index);
                } else {
                  newExpanded.add(entry.index);
                }
                setExpandedEntries(newExpanded);
              }}
              getBadgeClass={getBadgeClass}
              formatTimestamp={formatTimestamp}
            />
          ))}
        </div>
      )}
    </div>
  );
}
