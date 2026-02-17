"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { ActivityPeriod } from "@/lib/visualizer/runtime-edges";
import { ACTIVITY_PERIODS } from "@/lib/visualizer/runtime-edges";

export interface Task {
  taskId: string;
  contextId: string;
  broker: string;
  firstTool: string;
  startTime: string;
  endTime: string | null;
  duration: string | null;
  maxIteration: number;
  toolsUsed: string[];
  appId: string;
}

interface TasksListProps {
  orgId: string;
  apiInstanceId: string | null;
  selectedTaskId?: string | null;
  onTaskSelect: (taskId: string | null) => void;
  activityPeriod?: ActivityPeriod;
}

function isEntitlementError(message: string): boolean {
  return message.includes("Monitoring Center Premium") || message.includes("Log Search - Advanced");
}

export default function TasksList({
  orgId,
  apiInstanceId,
  selectedTaskId: externalSelectedTaskId,
  onTaskSelect,
  activityPeriod = "24h",
}: TasksListProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [internalSelectedTaskId, setInternalSelectedTaskId] = useState<string | null>(null);
  
  const selectedTaskId = externalSelectedTaskId !== undefined ? externalSelectedTaskId : internalSelectedTaskId;

  const fetchTasks = useCallback(() => {
    if (!orgId || !apiInstanceId) {
      setTasks([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const entitlementMessage =
      "Log Search - Advanced package or a Titanium subscription to Anypoint Platform Required - Elasticsearch log search APIs - Enhanced raw storage (up to 128TB based on configuration) - Advanced logs and traces - LLM reasoning logs (for Agent Broker monitoring)";

    const timeRangeMs = ACTIVITY_PERIODS[activityPeriod] * 60 * 1000; 
    fetch("/api/broker-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        orgId, 
        apiInstanceId, 
        timeRangeMs 
      }),
    })
      .then(async (res) => {
        const statusCode = res.status;
        const data = await res.json().catch(() => ({}));
        
        if (!res.ok) {
          // 403 = entitlement required; use full message so orange warning shows
          if (statusCode === 403) {
            const fromBody = data?.message || data?.error;
            setError(typeof fromBody === "string" && fromBody.length > 0 ? fromBody : entitlementMessage);
            return null;
          }
          throw new Error(data?.error || data?.message || `Failed to fetch: ${statusCode}`);
        }
        
        return data;
      })
      .then((data: { tasks: Task[] } | null) => {
        if (data != null && "tasks" in data) {
          setTasks(data.tasks || []);
        }
      })
      .catch((err) => {
        console.error("Error fetching tasks:", err);
        if (err.message && (err.message.includes("Monitoring Center Premium") || err.message.includes("Log Search - Advanced"))) {
          setError(entitlementMessage);
        } else {
          setError(err.message || "Failed to load tasks");
        }
      })
      .finally(() => setLoading(false));
  }, [orgId, apiInstanceId, activityPeriod]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleTaskClick = (taskId: string) => {
    const newSelection = taskId === selectedTaskId ? null : taskId;
    if (externalSelectedTaskId === undefined) {
      setInternalSelectedTaskId(newSelection);
    }
    onTaskSelect(newSelection);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Tasks</h3>
        {apiInstanceId && (
          <button
            type="button"
            onClick={fetchTasks}
            disabled={loading}
            className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="Refresh tasks"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        )}
      </div>
      {!apiInstanceId && (
        <p className="text-xs text-gray-500">No instance available for selected environment</p>
      )}
      {apiInstanceId && loading && (
        <p className="text-xs text-gray-500">Loading tasks...</p>
      )}
      {apiInstanceId && error && (
        <div className={`rounded border p-2 mb-2 ${isEntitlementError(error) ? "border-amber-300 bg-amber-50" : "border-red-200 bg-red-50"}`}>
          <p className={`text-xs font-semibold ${isEntitlementError(error) ? "text-amber-900" : "text-red-900"}`}>
            {isEntitlementError(error) ? "Log Search - Advanced package or a Titanium subscription to Anypoint Platform Required" : "Error"}
          </p>
          {isEntitlementError(error) && (
            <div className="text-[10px] text-amber-800 mt-1 space-y-0.5">
              <ul className="list-disc list-inside space-y-0.5">
                <li>Elasticsearch log search APIs</li>
                <li>Enhanced raw storage (up to 128TB based on configuration)</li>
                <li>Advanced logs and traces</li>
                <li>LLM reasoning logs (for Agent Broker monitoring)</li>
              </ul>
              <p className="mt-1 text-amber-700">
                <a 
                  href="https://docs.mulesoft.com/monitoring/#log-search" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="underline hover:text-amber-900"
                >
                  Learn more about log search requirements
                </a>
              </p>
            </div>
          )}
          {!isEntitlementError(error) && (
            <p className={`text-xs mt-1 text-red-800`}>
              {error}
            </p>
          )}
        </div>
      )}
      {apiInstanceId && !loading && !error && (
        <p className="text-xs text-gray-500">
          {tasks.length} task{tasks.length !== 1 ? "s" : ""} found
        </p>
      )}
      {apiInstanceId && (
        <ul className="flex-1 space-y-0 overflow-y-auto max-h-[420px] scrollbar-thin pr-1">
          {tasks.map((task) => {
            const toolNames = task.toolsUsed
              .map((t) => t.replace(/^[a-zA-Z0-9]+_/, ""))
              .join(", ");
            const startTimeStr = task.startTime
              ? new Date(task.startTime).toLocaleString()
              : "?";
            return (
              <li
                key={task.taskId}
                onClick={() => handleTaskClick(task.taskId)}
                className={`cursor-pointer border-b border-gray-100 px-2 py-2 text-xs transition-colors hover:bg-blue-50 ${
                  selectedTaskId === task.taskId
                    ? "bg-blue-100 border-l-2 border-l-blue-600"
                    : ""
                }`}
              >
                <div className="font-mono text-xs text-blue-600">
                  {task.taskId}
                </div>
                <div className="mt-0.5 text-[10px] text-gray-600">
                  {startTimeStr} • {task.duration || "?"}s • {task.maxIteration} iter
                </div>
                {toolNames && (
                  <div className="mt-0.5 text-[10px] text-gray-500">
                    {toolNames}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
