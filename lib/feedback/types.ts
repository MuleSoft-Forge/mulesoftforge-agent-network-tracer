export type ConsoleLevel = "error" | "warn";

export interface ConsoleEntry {
  level: ConsoleLevel;
  message: string;
  timestamp: string;
}

export interface BugReportContext {
  route: string;
  userAgent: string;
  viewportWidth: number;
  viewportHeight: number;
  appVersion: string;
  desktop: boolean;
  desktopPlatform: string | null;
  reportedAt: string;
}

export interface BugReportPayload {
  description: string;
  includeConsole: boolean;
  screenshotDataUrl?: string;
  context: BugReportContext;
  consoleEntries: ConsoleEntry[];
  privacyConfirmed: boolean;
}

export interface FeedbackConfigResponse {
  enabled: boolean;
  /** Null when the deployment sets no FEEDBACK_CONTACT_EMAIL. */
  contactEmail: string | null;
}

export interface FeedbackSubmitResponse {
  issueUrl: string;
  issueNumber: number;
}
