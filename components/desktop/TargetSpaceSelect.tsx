"use client";

import type { DeploymentTarget } from "@/lib/mulesoft/deployment-targets";

interface TargetSpaceSelectProps {
  id: string;
  label: string;
  value: string;
  targets: DeploymentTarget[];
  loading: boolean;
  disabled?: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}

/** Dropdown for CloudHub 2.0 runtime targets (--target-space). */
export function TargetSpaceSelect({
  id,
  label,
  value,
  targets,
  loading,
  disabled = false,
  placeholder,
  onChange,
}: TargetSpaceSelectProps) {
  const names = targets.map((t) => t.name);
  const hasList = names.length > 0;

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-xs font-medium text-gray-700">
        {label} <span className="text-red-500">*</span>
      </label>
      {hasList ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || loading}
          className="w-full rounded-anypoint border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-60"
        >
          <option value="">{loading ? "Loading…" : "Select target space"}</option>
          {targets.map((target) => (
            <option key={target.id} value={target.name}>
              {target.name}
            </option>
          ))}
          {value && !names.includes(value) ? (
            <option value={value}>{value} (not in list)</option>
          ) : null}
        </select>
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || loading}
          placeholder={placeholder}
          className="w-full rounded-anypoint border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-60"
        />
      )}
    </div>
  );
}
