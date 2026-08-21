import type { ConsoleEntry, ConsoleLevel } from "@/lib/feedback/types";

const MAX_ENTRIES = 30;
const entries: ConsoleEntry[] = [];

declare global {
  interface Window {
    __agentNetworkConsoleBufferInstalled?: boolean;
  }
}

function formatArg(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pushEntry(level: ConsoleLevel, parts: unknown[]): void {
  const message = parts.map(formatArg).join(" ").slice(0, 4000);
  entries.push({
    level,
    message,
    timestamp: new Date().toISOString(),
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

/** Install console/error hooks once per tab (client-only). */
export function installConsoleBuffer(): void {
  if (typeof window === "undefined" || window.__agentNetworkConsoleBufferInstalled) {
    return;
  }
  window.__agentNetworkConsoleBufferInstalled = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    pushEntry("error", args);
    originalError(...args);
  };

  console.warn = (...args: unknown[]) => {
    pushEntry("warn", args);
    originalWarn(...args);
  };

  window.addEventListener("error", (event) => {
    pushEntry("error", [
      event.message,
      event.filename ? `@ ${event.filename}:${event.lineno}:${event.colno}` : "",
    ]);
  });

  window.addEventListener("unhandledrejection", (event) => {
    pushEntry("error", ["Unhandled promise rejection", event.reason]);
  });
}

export function getConsoleBuffer(): ConsoleEntry[] {
  return [...entries];
}

export function clearConsoleBuffer(): void {
  entries.length = 0;
}
