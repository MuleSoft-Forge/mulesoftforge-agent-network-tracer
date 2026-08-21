"use client";

import { useEffect, useState } from "react";
import {
  ACTIVITY_PERIODS,
  type ActivityPeriod,
} from "@/lib/visualizer/runtime-edges";

const ACTIVITY_PERIOD_STORAGE_KEY = "agent-network-activity-period";

const LABELS: Record<ActivityPeriod, string> = {
  "5m": "Last 5 minutes",
  "15m": "Last 15 minutes",
  "30m": "Last 30 minutes",
  "60m": "Last 1 hour",
  "24h": "Last 24 hours",
  "3d": "Last 3 days",
  "5d": "Last 5 days",
  "7d": "Last 7 days",
};

/** Default to a fast, recent window for task list usability. */
const DEFAULT_PERIOD: ActivityPeriod = "60m";

function getStoredPeriod(): ActivityPeriod | null {
  if (typeof window === "undefined") return null;
  try {
    const v = sessionStorage.getItem(ACTIVITY_PERIOD_STORAGE_KEY);
    if (v != null && v in ACTIVITY_PERIODS) return v as ActivityPeriod;
    return null;
  } catch {
    return null;
  }
}

function persistPeriod(key: ActivityPeriod): void {
  try {
    sessionStorage.setItem(ACTIVITY_PERIOD_STORAGE_KEY, key);
  } catch {
    /* ignore */
  }
}

interface ActivityPeriodSelectorProps {
  value: ActivityPeriod;
  onSelect: (key: ActivityPeriod, minutes: number) => void;
  disabled?: boolean;
}

export default function ActivityPeriodSelector({
  value,
  onSelect,
  disabled = false,
}: ActivityPeriodSelectorProps) {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const stored = getStoredPeriod();
    if (stored != null) {
      onSelect(stored, ACTIVITY_PERIODS[stored]);
    }
    setInitialized(true);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const key = e.target.value as ActivityPeriod;
    if (!(key in ACTIVITY_PERIODS)) return;
    persistPeriod(key);
    onSelect(key, ACTIVITY_PERIODS[key]);
  };

  const options = (Object.keys(ACTIVITY_PERIODS) as ActivityPeriod[]).map(
    (key: ActivityPeriod) => (
      <option key={key} value={key}>
        {LABELS[key]}
      </option>
    )
  );

  return (
    <div className="space-y-2">
      <label
        htmlFor="activity-period-select"
        className="text-sm font-semibold text-gray-900"
      >
        Activity period
      </label>
      <select
        id="activity-period-select"
        value={value}
        onChange={handleChange}
        disabled={disabled || !initialized}
        className="w-full rounded-anypoint border border-gray-300 bg-white px-3 py-2 pr-8 text-sm text-gray-900 transition-all duration-150 ease-[cubic-bezier(0.46,0.03,0.52,0.96)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-70"
      >
        {options}
      </select>
    </div>
  );
}

export { ACTIVITY_PERIOD_STORAGE_KEY, getStoredPeriod, DEFAULT_PERIOD, LABELS };
