"use client";

import ConsoleBufferInit from "@/components/feedback/ConsoleBufferInit";
import { BugReportProvider } from "@/components/feedback/BugReportProvider";
import BugReportWidget from "@/components/feedback/BugReportWidget";

export default function BugReportShell() {
  return (
    <BugReportProvider>
      <ConsoleBufferInit />
      <BugReportWidget />
    </BugReportProvider>
  );
}
