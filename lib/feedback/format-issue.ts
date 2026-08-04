import type { BugReportPayload } from "@/lib/feedback/types";

export function buildIssueTitle(description: string): string {
  const oneLine = description.replace(/\s+/g, " ").trim();
  const prefix = "[User report]";
  const maxLen = 80 - prefix.length - 1;
  const snippet = oneLine.length > maxLen ? `${oneLine.slice(0, maxLen - 1)}…` : oneLine;
  return `${prefix} ${snippet || "Bug report"}`;
}

export function buildIssueBody(payload: BugReportPayload): string {
  const { description, context, consoleEntries, includeConsole } = payload;
  const lines: string[] = [
    "## Description",
    description.trim(),
    "",
    "## Context",
    `- **Route:** \`${context.route || "(unknown)"}\``,
    `- **App version:** \`${context.appVersion}\``,
    `- **Reported at:** ${context.reportedAt}`,
    `- **Viewport:** ${context.viewportWidth}×${context.viewportHeight}`,
    `- **Desktop:** ${context.desktop ? `yes (${context.desktopPlatform ?? "unknown"})` : "no"}`,
    `- **User agent:** \`${context.userAgent}\``,
    "",
    "_Submitted via in-app bug report. Review for customer data before sharing._",
  ];

  if (includeConsole && consoleEntries.length > 0) {
    lines.push("", "## Console log (recent)", "```");
    for (const entry of consoleEntries) {
      lines.push(`[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}`);
    }
    lines.push("```");
  } else if (includeConsole) {
    lines.push("", "## Console log", "_No recent console errors captured in this session._");
  }

  return lines.join("\n");
}
