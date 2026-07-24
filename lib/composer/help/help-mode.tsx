"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "composer-help-mode";

interface HelpModeContextValue {
  helpMode: boolean;
  setHelpMode: (value: boolean) => void;
  toggleHelpMode: () => void;
}

const HelpModeContext = createContext<HelpModeContextValue | null>(null);

export function HelpModeProvider({ children }: { children: ReactNode }) {
  const [helpMode, setHelpModeState] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "true") setHelpModeState(true);
    setHydrated(true);
  }, []);

  const setHelpMode = useCallback((value: boolean) => {
    setHelpModeState(value);
    window.localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
  }, []);

  const toggleHelpMode = useCallback(() => {
    setHelpModeState((prev) => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ helpMode: hydrated ? helpMode : false, setHelpMode, toggleHelpMode }),
    [helpMode, hydrated, setHelpMode, toggleHelpMode]
  );

  return <HelpModeContext.Provider value={value}>{children}</HelpModeContext.Provider>;
}

export function useHelpMode(): HelpModeContextValue {
  const ctx = useContext(HelpModeContext);
  if (!ctx) {
    return {
      helpMode: false,
      setHelpMode: () => {},
      toggleHelpMode: () => {},
    };
  }
  return ctx;
}
