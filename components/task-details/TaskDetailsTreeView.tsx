"use client";

import { ChevronRight, ChevronDown, Clock } from "lucide-react";
import type { JobCard, LogEntry, SelectedItem, TreeStructure } from "./types";
import TaskDetailsStepNode from "./TaskDetailsStepNode";

interface TaskDetailsTreeViewProps {
  jobCard: JobCard;
  treeStructure: TreeStructure;
  expandedNodes: Set<string>;
  selectedItem: SelectedItem | null;
  onToggleNode: (nodeId: string) => void;
  onSelectItem: (item: SelectedItem) => void;
  getBadgeClass: (type: string) => string;
  formatTimestamp: (ts: string | number) => string;
}

export default function TaskDetailsTreeView({
  jobCard,
  treeStructure,
  expandedNodes,
  selectedItem,
  onToggleNode,
  onSelectItem,
  getBadgeClass,
  formatTimestamp,
}: TaskDetailsTreeViewProps) {
  const isTaskExpanded = expandedNodes.has("task");
  const isTaskSelected = selectedItem?.type === "task";

  return (
    <div className="p-4">
      <div
        className={`mb-1 rounded-lg border-2 transition-colors ${
          isTaskSelected ? "border-indigo-500 bg-indigo-50" : "border-transparent bg-white hover:bg-gray-50"
        }`}
      >
        <div
          className="flex cursor-pointer items-center gap-2 px-3 py-2"
          onClick={() => {
            onToggleNode("task");
            onSelectItem({ type: "task", id: "task", data: jobCard });
          }}
        >
          {isTaskExpanded ? (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-500" />
          )}
          <span className="font-semibold text-gray-900">Task {jobCard.taskId}</span>
          <span className="text-xs text-gray-500">•</span>
          <span className="text-xs text-gray-600">{jobCard.duration || "?"}s</span>
          <span className="text-xs text-gray-500">•</span>
          <span className="text-xs text-gray-600">{jobCard.iterations} iter</span>
          <span className="text-xs text-gray-500">•</span>
          <span className="text-xs text-gray-600">{jobCard.totalEntries} entries</span>
        </div>

        {isTaskExpanded && (
          <div className="ml-7 border-l-2 border-gray-200 pl-3">
            {treeStructure.preEntries.length > 0 && (
              <div className="mb-2">
                <div className="mb-1 text-xs font-semibold text-gray-500">Inbound + Discovery</div>
                {treeStructure.preEntries.map((entry: LogEntry) => (
                  <TaskDetailsStepNode
                    key={entry.index}
                    entry={entry}
                    selectedItem={selectedItem}
                    onSelectItem={onSelectItem}
                    getBadgeClass={getBadgeClass}
                    formatTimestamp={formatTimestamp}
                  />
                ))}
              </div>
            )}

            {treeStructure.iterations.map((iter: (typeof treeStructure.iterations)[0]) => {
              const isIterExpanded = expandedNodes.has(iter.id);
              const isIterSelected = selectedItem?.type === "iteration" && selectedItem.id === iter.id;

              return (
                <div key={iter.id} className="mb-2">
                  <div
                    className={`mb-1 rounded border transition-colors ${
                      isIterSelected ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                  >
                    <div
                      className="flex cursor-pointer items-center gap-2 px-2 py-1.5"
                      onClick={() => {
                        onToggleNode(iter.id);
                        onSelectItem({ type: "iteration", id: iter.id, data: iter });
                      }}
                    >
                      {isIterExpanded ? (
                        <ChevronDown className="h-3 w-3 text-gray-500" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-gray-500" />
                      )}
                      <span className="text-sm font-medium text-gray-900">Iteration {iter.iteration}</span>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {iter.toolName}
                      </span>
                      <span className="ml-auto flex items-center gap-1 text-xs text-gray-500">
                        <Clock className="h-3 w-3" />
                        {iter.duration}s
                      </span>
                    </div>

                    {isIterExpanded && (
                      <div className="ml-6 border-l-2 border-blue-200 pl-2">
                        {Object.entries(iter.steps).map(([stepType, stepEntries]: [string, LogEntry[]]) => {
                          const stepId = `${iter.id}-${stepType}`;
                          const isStepExpanded = expandedNodes.has(stepId);
                          const firstStep = stepEntries[0];
                          const lastStep = stepEntries[stepEntries.length - 1];
                          const stepStart =
                            typeof firstStep.timestamp === "number"
                              ? firstStep.timestamp
                              : new Date(firstStep.timestamp).getTime();
                          const stepEnd =
                            typeof lastStep.timestamp === "number"
                              ? lastStep.timestamp
                              : new Date(lastStep.timestamp).getTime();
                          const stepDuration = ((stepEnd - stepStart) / 1000).toFixed(1);

                          return (
                            <div key={stepType} className="mb-1">
                              <div
                                className={`mb-1 rounded border transition-colors ${
                                  selectedItem?.type === "step" && selectedItem.id === stepId
                                    ? "border-indigo-500 bg-indigo-50"
                                    : "border-gray-100 bg-gray-50 hover:bg-gray-100"
                                }`}
                              >
                                <div
                                  className="flex cursor-pointer items-center gap-2 px-2 py-1"
                                  onClick={() => {
                                    onToggleNode(stepId);
                                    onSelectItem({ type: "step", id: stepId, data: { stepType, entries: stepEntries } });
                                  }}
                                >
                                  {isStepExpanded ? (
                                    <ChevronDown className="h-3 w-3 text-gray-400" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3 text-gray-400" />
                                  )}
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getBadgeClass(stepType)}`}
                                  >
                                    {stepType.replace(/_/g, " ")}
                                  </span>
                                  <span className="text-xs text-gray-600">{stepEntries.length} entries</span>
                                  <span className="ml-auto text-xs text-gray-500">{stepDuration}s</span>
                                </div>

                                {isStepExpanded && (
                                  <div className="ml-5 space-y-0.5 pl-2">
                                    {stepEntries.map((entry: LogEntry) => {
                                      const entryId = `entry-${entry.index}`;
                                      const isEntrySelected =
                                        selectedItem?.type === "step" && selectedItem.id === entryId;

                                      return (
                                        <div
                                          key={entry.index}
                                          className={`cursor-pointer rounded px-2 py-1 text-xs transition-colors ${
                                            isEntrySelected ? "bg-indigo-100" : "hover:bg-gray-100"
                                          }`}
                                          onClick={() => {
                                            onSelectItem({ type: "step", id: entryId, data: entry });
                                          }}
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className="font-mono text-[10px] text-gray-500">
                                              {formatTimestamp(entry.timestamp)}
                                            </span>
                                            <span className="flex-1 truncate text-gray-700">{entry.summary}</span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {treeStructure.postEntries.length > 0 && (
              <div className="mb-2">
                <div className="mb-1 text-xs font-semibold text-gray-500">Response + Gateway</div>
                {treeStructure.postEntries.map((entry: LogEntry) => (
                  <TaskDetailsStepNode
                    key={entry.index}
                    entry={entry}
                    selectedItem={selectedItem}
                    onSelectItem={onSelectItem}
                    getBadgeClass={getBadgeClass}
                    formatTimestamp={formatTimestamp}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
