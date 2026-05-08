"use client";

import type { TraceEvent, TraceEventType, InvokeAction } from "@/lib/invoke/types";
import type { Dispatch } from "react";

const TYPE_BADGE: Record<TraceEventType, string> = {
  routing: "bg-blue-50 text-blue-600 border-blue-200",
  api_call: "bg-violet-50 text-violet-600 border-violet-200",
  response: "bg-emerald-50 text-emerald-600 border-emerald-200",
  error: "bg-red-50 text-red-600 border-red-200",
};

interface TracePanelProps {
  events: TraceEvent[];
  dispatch: Dispatch<InvokeAction>;
}

export default function TracePanel({ events, dispatch }: TracePanelProps) {
  if (events.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center">
        <p className="text-xs text-gray-400">No trace events yet. Send a message to see routing.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 shrink-0">
        <span className="text-[11px] text-gray-400">{events.length} events</span>
        <button
          type="button"
          onClick={() => dispatch({ type: "CLEAR_TRACE" })}
          className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {events.map((ev) => (
          <div key={ev.id} className="flex gap-2 text-xs">
            <span className="shrink-0 text-gray-400 tabular-nums leading-5">
              {ev.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
            </span>
            <span
              className={`shrink-0 self-start rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-4 ${
                TYPE_BADGE[ev.type] ?? "bg-gray-50 text-gray-600 border-gray-200"
              }`}
            >
              {ev.type.replace("_", " ")}
            </span>
            <span className="text-gray-700 leading-5 break-words min-w-0">{ev.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
