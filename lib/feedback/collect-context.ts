import type { BugReportContext } from "@/lib/feedback/types";

export function collectBugReportContext(): BugReportContext {
  return {
    route:
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    viewportWidth: typeof window !== "undefined" ? window.innerWidth : 0,
    viewportHeight: typeof window !== "undefined" ? window.innerHeight : 0,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
    desktop: false,
    desktopPlatform: null,
    reportedAt: new Date().toISOString(),
  };
}
