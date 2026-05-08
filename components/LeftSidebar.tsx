"use client";

import { useState, useEffect } from "react";
import ActivityPeriodSelector, {
  getStoredPeriod,
  DEFAULT_PERIOD,
} from "@/components/ActivityPeriodSelector";
import BusinessGroupSelector from "@/components/BusinessGroupSelector";
import EnvironmentSelector, { type AnypointEnvironment } from "@/components/EnvironmentSelector";
import TasksList from "@/components/TasksList";
import Spinner from "@/components/Spinner";
import { debugLog } from "@/lib/api-logger";
import type { ActivityPeriod, Environment } from "@/lib/visualizer/runtime-edges";
import { ACTIVITY_PERIODS } from "@/lib/visualizer/runtime-edges";
import type { BrokerInEnvironment } from "@/lib/visualizer/brokers-in-environment-types";

const SIDEBAR_EXPANDED_KEY = "agent-network-sidebar-expanded";

function getStoredExpanded(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(SIDEBAR_EXPANDED_KEY);
    return v !== "false";
  } catch {
    return true;
  }
}

export type ViewMode = "invoke" | "activity" | "exchange" | "llmProxy";

interface LeftSidebarProps {
  viewMode?: ViewMode;
  onSelectionChange?: (pathOrgId: string, orgIds: string[], isAll: boolean, rootOrgId?: string) => void;
  onEnvironmentChange?: (env: Environment) => void;
  onOrgAndEnvChange?: (orgId: string, envId: string) => void;
  onActivityPeriodChange?: (activityPeriodMinutes: number) => void;
  brokers?: BrokerInEnvironment[];
  selectedBroker?: BrokerInEnvironment | null;
  onBrokerChange?: (broker: BrokerInEnvironment | null) => void;
  selectedTaskId?: string | null;
  onTaskSelect?: (taskId: string | null) => void;
  onBrokerTasksData?: (data: { mode?: string }) => void;
  loadingBrokers?: boolean;
}

export default function LeftSidebar({
  viewMode = "activity",
  onSelectionChange,
  onEnvironmentChange,
  onOrgAndEnvChange,
  onActivityPeriodChange,
  brokers = [],
  selectedBroker,
  onBrokerChange,
  selectedTaskId,
  onTaskSelect,
  onBrokerTasksData,
  loadingBrokers = false,
}: LeftSidebarProps = {}) {
  const [expanded, setExpanded] = useState(true);
  const [selection, setSelection] = useState<{
    value: string;
    allOrgIds: string[];
    rootOrgId: string;
  } | null>(null);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string>("");
  const [activityPeriodKey, setActivityPeriodKey] = useState<ActivityPeriod>(DEFAULT_PERIOD);
  const [activityPeriodMinutes, setActivityPeriodMinutes] = useState<number>(
    ACTIVITY_PERIODS[DEFAULT_PERIOD]
  );
  const [selectedBrokerNodeId, setSelectedBrokerNodeId] = useState<string>("");

  useEffect(() => {
    setExpanded(getStoredExpanded());
    const storedPeriod = getStoredPeriod();
    if (storedPeriod != null) {
      const minutes = ACTIVITY_PERIODS[storedPeriod];
      setActivityPeriodKey(storedPeriod);
      setActivityPeriodMinutes(minutes);
      onActivityPeriodChange?.(minutes);
    }
  }, []);

  // Sync selectedBrokerNodeId when selectedBroker prop changes (e.g., after brokers refresh)
  useEffect(() => {
    if (selectedBroker != null) {
      const matchingBroker = brokers.find((b: BrokerInEnvironment) => b.nodeId === selectedBroker.nodeId);
      if (matchingBroker) {
        // Broker exists in list, sync the select element
        if (selectedBrokerNodeId !== selectedBroker.nodeId) {
          setSelectedBrokerNodeId(selectedBroker.nodeId);
        }
      } else {
        // Broker no longer exists in list, clear selection
        if (selectedBrokerNodeId !== "") {
          setSelectedBrokerNodeId("");
        }
      }
    } else {
      // selectedBroker is null, clear selection
      if (selectedBrokerNodeId !== "") {
        setSelectedBrokerNodeId("");
      }
    }
    // Only depend on selectedBroker and brokers, not selectedBrokerNodeId to avoid loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBroker, brokers]);

  const handleBrokerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nodeId = e.target.value;
    setSelectedBrokerNodeId(nodeId);
    const broker = nodeId ? brokers.find((b: BrokerInEnvironment) => b.nodeId === nodeId) ?? null : null;
    onBrokerChange?.(broker);
  };

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(next));
    } catch {
      /* ignore */
    }
  };

  const handleSelect = (value: string, allOrgIds: string[], rootOrgId: string) => {
    if (!value || value === "") {
      setSelection(null);
      setSelectedEnvironmentId("");
      setSelectedBrokerNodeId("");
      onBrokerChange?.(null);
      onSelectionChange?.("", [], false, rootOrgId);
      onEnvironmentChange?.("production");
      onOrgAndEnvChange?.("", "");
      return;
    }
    setSelection({ value, allOrgIds, rootOrgId });
    setSelectedEnvironmentId("");
    setSelectedBrokerNodeId("");
    onBrokerChange?.(null);
    onEnvironmentChange?.("production");
    const pathOrgId = value === "ALL" ? rootOrgId : value;
    const orgIds = value === "ALL" ? allOrgIds : [value];
    onSelectionChange?.(pathOrgId, orgIds, value === "ALL", rootOrgId);
    if (value !== "ALL") {
      onOrgAndEnvChange?.(value, "");
    } else {
      onOrgAndEnvChange?.("", "");
    }
  };

  const handleActivityPeriodSelect = (key: ActivityPeriod, minutes: number) => {
    setActivityPeriodKey(key);
    setActivityPeriodMinutes(minutes);
    onActivityPeriodChange?.(minutes);
  };

  const handleEnvironmentSelect = (envId: string, env: AnypointEnvironment | null) => {
    const newEnvId = env?.id ?? "";
    setSelectedEnvironmentId(newEnvId);
    setSelectedBrokerNodeId("");
    onBrokerChange?.(null);
    const envType: Environment =
      env?.type === "production" ? "production" : "sandbox";
    onEnvironmentChange?.(envType);
    if (selection?.value && selection.value !== "ALL") {
      onOrgAndEnvChange?.(selection.value, newEnvId);
    }
  };

  return (
    <div
      className={`flex shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] ${
        expanded ? "w-72" : "w-12"
      }`}
    >
      <div className="flex h-10 items-center justify-end border-b border-gray-100 px-2">
        <button
          type="button"
          onClick={handleToggle}
          className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {expanded ? (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </button>
      </div>
      <div
        className={`flex flex-1 flex-col overflow-hidden ${
          !expanded ? "w-0 min-w-0 overflow-hidden opacity-0 pointer-events-none" : ""
        }`}
      >
        <div className="flex-1 overflow-y-auto p-3">
          <div>
            <BusinessGroupSelector
              initialOrgId={undefined}
              onSelect={handleSelect}
              disabled={loadingBrokers}
            />
          </div>
          <div className="mt-4 space-y-3">
            <EnvironmentSelector
              orgId={
                selection && selection.value !== "ALL" ? selection.value : null
              }
              value={selectedEnvironmentId}
              onSelect={handleEnvironmentSelect}
              disabled={loadingBrokers}
            />
          </div>
          {viewMode !== "llmProxy" && selection && selection.value !== "ALL" && selectedEnvironmentId && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="broker-select"
                  className="text-sm font-semibold text-gray-900"
                >
                  Broker
                </label>
                {loadingBrokers && brokers.length === 0 && <Spinner size="s" />}
              </div>
              {loadingBrokers && brokers.length === 0 ? (
                <div className="flex items-center gap-2 py-2">
                  <span className="text-sm text-gray-500">Loading brokers...</span>
                </div>
              ) : brokers.length > 0 ? (
                <div className="relative">
                  <select
                    id="broker-select"
                    value={selectedBrokerNodeId}
                    onChange={handleBrokerChange}
                    disabled={loadingBrokers}
                    className={`w-full rounded-anypoint border border-gray-300 bg-white px-3 py-2 pr-8 text-sm text-gray-900 transition-all duration-150 ease-[cubic-bezier(0.46,0.03,0.52,0.96)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                      loadingBrokers ? "opacity-60 cursor-wait" : ""
                    }`}
                  >
                    <option value="">Select broker</option>
                    {brokers.map((b: BrokerInEnvironment) => (
                      <option key={b.nodeId} value={b.nodeId}>
                        {b.name || b.assetId}
                      </option>
                    ))}
                  </select>
                  {loadingBrokers && brokers.length > 0 && (
                    <div className="absolute right-10 top-1/2 -translate-y-1/2">
                      <Spinner size="s" />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  {viewMode === "exchange" ? "No brokers found" : "No Brokers Activity Exists"}
                </p>
              )}
            </div>
          )}
          {viewMode === "activity" && selection && selection.value !== "ALL" && selectedBrokerNodeId && (
            <div className="mt-4">
              <ActivityPeriodSelector
                value={activityPeriodKey}
                onSelect={handleActivityPeriodSelect}
                disabled={loadingBrokers}
              />
            </div>
          )}
          {viewMode === "activity" && selection && selection.value !== "ALL" && selectedBrokerNodeId && (
            <div className="mt-4">
              {(() => {
                const broker = brokers.find((b: BrokerInEnvironment) => b.nodeId === selectedBrokerNodeId);
                if (broker && broker.instanceIds.length > 0) {
                  const apiInstanceId = broker.instanceIds[0];
                  debugLog("TasksList props:", { 
                    orgId: selection.value, 
                    apiInstanceId, 
                    brokerName: broker.name || broker.assetId,
                    allInstanceIds: broker.instanceIds 
                  });
                  return (
                    <TasksList
                      key={`${selection.value}-${apiInstanceId}`}
                      orgId={selection.value}
                      apiInstanceId={apiInstanceId}
                      envId={selectedEnvironmentId || undefined}
                      selectedTaskId={selectedTaskId}
                      onTaskSelect={onTaskSelect || (() => {})}
                      activityPeriod={activityPeriodKey}
                      onBrokerTasksData={onBrokerTasksData}
                    />
                  );
                }
                return null;
              })()}
            </div>
          )}
        </div>
        <div className="border-t border-gray-200 bg-white px-3 py-2">
          <p className="text-xs text-gray-600">
            Questions:{" "}
            <a
              href="mailto:jeffcock@mulesoftforge.com"
              className="text-primary hover:text-indigo-700 hover:underline"
            >
              Ask Me
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
