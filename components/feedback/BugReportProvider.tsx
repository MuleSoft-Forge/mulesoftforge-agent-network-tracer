"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface BugReportPrefill {
  description?: string;
  includeConsole?: boolean;
}

interface BugReportContextValue {
  open: boolean;
  prefill: BugReportPrefill | null;
  openBugReport: (prefill?: BugReportPrefill) => void;
  closeBugReport: () => void;
}

const BugReportContext = createContext<BugReportContextValue | null>(null);

export function BugReportProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<BugReportPrefill | null>(null);

  const openBugReport = useCallback((next?: BugReportPrefill) => {
    setPrefill(next ?? null);
    setOpen(true);
  }, []);

  const closeBugReport = useCallback(() => {
    setOpen(false);
    setPrefill(null);
  }, []);

  useEffect(() => {
    function onOpenEvent(event: Event): void {
      const detail = (event as CustomEvent<BugReportPrefill>).detail;
      openBugReport(detail);
    }
    window.addEventListener("agent-network:open-bug-report", onOpenEvent);
    return () => window.removeEventListener("agent-network:open-bug-report", onOpenEvent);
  }, [openBugReport]);

  const value = useMemo(
    () => ({ open, prefill, openBugReport, closeBugReport }),
    [open, prefill, openBugReport, closeBugReport]
  );

  return <BugReportContext.Provider value={value}>{children}</BugReportContext.Provider>;
}

export function useBugReport(): BugReportContextValue {
  const ctx = useContext(BugReportContext);
  if (!ctx) {
    throw new Error("useBugReport must be used within BugReportProvider");
  }
  return ctx;
}
