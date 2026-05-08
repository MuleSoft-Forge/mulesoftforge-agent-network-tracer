"use client";

import type { InvokeAction, InvokeState } from "@/lib/invoke/types";
import type { Dispatch } from "react";

interface SettingsPanelProps {
  state: InvokeState;
  dispatch: Dispatch<InvokeAction>;
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div className="relative shrink-0 mt-0.5">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div
          className={`w-8 h-4 rounded-full transition-colors ${
            checked ? "bg-primary" : "bg-gray-300"
          }`}
        />
        <div
          className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-800">{label}</p>
        {description && (
          <p className="text-[11px] text-gray-500 mt-0.5">{description}</p>
        )}
      </div>
    </label>
  );
}

export default function SettingsPanel({ state, dispatch }: SettingsPanelProps) {
  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
      <section>
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-3">
          Simulation
        </p>
        <div className="space-y-4">
          <Toggle
            label="Simulate latency"
            description="Add realistic delays to simulated flows (no effect on live calls)."
            checked={state.simulateLatency}
            onChange={(v) => dispatch({ type: "SET_SIMULATE_LATENCY", value: v })}
          />
          <Toggle
            label="Simulate errors"
            description="Occasionally inject a simulated error to test error handling."
            checked={state.simulateErrors}
            onChange={(v) => dispatch({ type: "SET_SIMULATE_ERRORS", value: v })}
          />
        </div>
      </section>

      <section>
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-3">
          Trace verbosity
        </p>
        <div className="flex gap-2">
          {(["low", "medium", "high"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => dispatch({ type: "SET_VERBOSITY", value: v })}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium capitalize transition-colors ${
                state.verbosity === v
                  ? "bg-primary text-white border-primary"
                  : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5">
          Low hides routing events; high shows all data payloads.
        </p>
      </section>

      <section>
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">
          Connection
        </p>
        {state.brokerUrl ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 space-y-1">
            <p className="text-[11px] text-gray-500">Broker URL</p>
            <p className="text-xs font-mono text-gray-800 break-all">{state.brokerUrl}</p>
            {state.agentCard?.version && (
              <p className="text-[11px] text-gray-400">version {state.agentCard.version}</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400">No broker loaded.</p>
        )}
      </section>
    </div>
  );
}
