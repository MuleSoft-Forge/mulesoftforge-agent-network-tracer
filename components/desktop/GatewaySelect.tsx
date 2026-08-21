"use client";

import type { ManagedGateway } from "@/lib/mulesoft/managed-gateways";

interface GatewaySelectProps {
  id: string;
  label: string;
  value: string;
  gateways: ManagedGateway[];
  loading: boolean;
  disabled?: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}

/** Dropdown when gateways are loaded from Anypoint; text input as fallback. */
export function GatewaySelect({
  id,
  label,
  value,
  gateways,
  loading,
  disabled = false,
  placeholder,
  onChange,
}: GatewaySelectProps) {
  const names = gateways.map((g) => g.name);
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
          <option value="">{loading ? "Loading…" : "Select gateway"}</option>
          {gateways.map((gw) => (
            <option key={gw.id} value={gw.name}>
              {gw.name}
              {gw.status ? ` (${gw.status})` : ""}
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

/** Pick the first gateway name, or keep current when still valid. */
export function pickGatewayDefault(current: string | undefined, gateways: ManagedGateway[]): string {
  const names = gateways.map((g) => g.name);
  if (current && names.includes(current)) return current;
  return names[0] ?? current ?? "";
}
