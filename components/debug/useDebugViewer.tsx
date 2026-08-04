"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { DebugViewer, DebugViewerData } from "./DebugViewer";

interface DebugViewerContextType {
  openDebugViewer: (data: DebugViewerData) => void;
}

const DebugViewerContext = createContext<DebugViewerContextType | undefined>(undefined);

export const DebugViewerProvider = ({ children }: { children: ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [viewerData, setViewerData] = useState<DebugViewerData | null>(null);

  const openDebugViewer = useCallback((data: DebugViewerData) => {
    setViewerData(data);
    setIsOpen(true);
  }, []);

  const closeDebugViewer = useCallback(() => {
    setIsOpen(false);
    // Clear data after animation
    setTimeout(() => setViewerData(null), 200);
  }, []);

  return (
    <DebugViewerContext.Provider value={{ openDebugViewer }}>
      {children}
      {viewerData && (
        <DebugViewer
          open={isOpen}
          onClose={closeDebugViewer}
          data={viewerData.data}
          apiUrl={viewerData.apiUrl}
          title={viewerData.title}
        />
      )}
    </DebugViewerContext.Provider>
  );
};

export const useDebugViewer = () => {
  const context = useContext(DebugViewerContext);
  if (!context) {
    throw new Error("useDebugViewer must be used within DebugViewerProvider");
  }
  return context;
};
