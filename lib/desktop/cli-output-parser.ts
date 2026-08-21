import type { CliCommand } from "@/lib/lifecycle/types";
import type { LogLine } from "@/lib/lifecycle/log-lines";

export type ActivityTone = "info" | "muted" | "success" | "warning" | "error";

export type CliActivityItem =
  | { kind: "run-start"; command: CliCommand | "install-plugin"; summary: string }
  | { kind: "derived-space"; space: string; gateway: string }
  | { kind: "message"; text: string; tone: ActivityTone }
  | { kind: "deployment"; phase: "starting" | "waiting" | "finished"; label: string }
  | { kind: "endpoint"; name: string; version?: string; url: string }
  | { kind: "error"; message: string; code?: number; detail?: string }
  | { kind: "outcome"; ok: boolean; text: string };

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const SECRET_PROPERTY_RE = /(--property\s+\S*(?:apiKey|secret|password|token)\S*:)\S+/gi;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** Redact secret values from a CLI invocation string. */
export function sanitizeCliInvocation(text: string): string {
  return stripAnsi(text).replace(SECRET_PROPERTY_RE, "$1••••••");
}

export function summarizeCliInvocation(rawCommandLine: string): string {
  const cmd = sanitizeCliInvocation(rawCommandLine.replace(/^\$\s*/, ""));
  const verb = cmd.match(/agent-network project (\w+)/)?.[1];
  const environment = cmd.match(/--environment\s+(\S+)/)?.[1];
  const gateway = cmd.match(/--gateway\s+(\S+)/)?.[1];
  const targetSpace = cmd.match(/--target-space\s+(\S+)/)?.[1];

  const parts: string[] = [];
  if (verb) parts.push(verb.charAt(0).toUpperCase() + verb.slice(1));
  if (environment) parts.push(environment);
  if (gateway) parts.push(gateway);
  else if (targetSpace) parts.push(targetSpace);

  return parts.length > 0 ? parts.join(" · ") : "Agent Network";
}

function parseJsonLine(line: string): CliActivityItem | null {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    const error = value.error as Record<string, unknown> | undefined;
    if (error) {
      const message =
        (typeof error.errorMessage === "string" && error.errorMessage) ||
        (typeof error.message === "string" && error.message) ||
        "Deployment failed.";
      const code = typeof error.errorCode === "number" ? error.errorCode : undefined;
      return { kind: "error", message, code, detail: simplifyErrorDetail(message) };
    }
    if (typeof value.name === "string" && typeof value.url === "string") {
      return {
        kind: "endpoint",
        name: value.name,
        version: typeof value.version === "string" ? value.version : undefined,
        url: value.url,
      };
    }
  } catch {
    // not JSON
  }
  return null;
}

function simplifyErrorDetail(message: string): string | undefined {
  if (message.includes("{") && message.includes("errorCode")) {
    try {
      const jsonStart = message.indexOf("{");
      const parsed = JSON.parse(message.slice(jsonStart)) as Record<string, unknown>;
      if (typeof parsed.errorMessage === "string") return parsed.errorMessage;
    } catch {
      // keep original
    }
  }
  return undefined;
}

function parseOclifErrorBlock(lines: string[]): CliActivityItem[] {
  const errors: CliActivityItem[] = [];
  let buffer = "";

  const flush = () => {
    if (!buffer.trim()) return;
    const codeMatch = buffer.match(/"errorCode":\s*(\d+)/);
    const msgMatch = buffer.match(/"errorMessage":\s*"((?:\\.|[^"\\])*)"/);
    if (codeMatch && msgMatch) {
      errors.push({
        kind: "error",
        code: Number(codeMatch[1]),
        message: msgMatch[1].replace(/\\"/g, '"'),
      });
    } else {
      const simple = buffer.match(/Error:\s*(.+)/);
      if (simple) {
        errors.push({
          kind: "error",
          message: simplifyErrorDetail(simple[1].trim()) ?? simple[1].trim(),
        });
      }
    }
    buffer = "";
  };

  for (const line of lines) {
    if (line.startsWith("›")) {
      buffer += `${line.replace(/^›\s*/, "")} `;
      continue;
    }
    flush();
  }
  flush();
  return errors;
}

function parseStructuredLine(line: string): CliActivityItem | null {
  const shared = line.match(/Using shared space '([^']+)' derived from gateway '([^']+)'/);
  if (shared) {
    return { kind: "derived-space", space: shared[1], gateway: shared[2] };
  }

  const deploying = line.match(/^Deploying Agent Network project (.+)\.$/);
  if (deploying) {
    return { kind: "message", text: `Deploying ${deploying[1]}`, tone: "info" };
  }

  const start = line.match(
    /^Deployment for (?:connection|instance|Agent Graph): '([^']+)'(?:\s+—\s+version\s+[^ ]+)? starting\.\.\./
  );
  if (start) {
    return { kind: "deployment", phase: "starting", label: start[1] };
  }

  const waiting = line.match(/^Waiting for Agent Graph deployment: '([^']+)' to be ready\.\.\.$/);
  if (waiting) {
    return { kind: "deployment", phase: "waiting", label: waiting[1] };
  }

  const finished = line.match(
    /^Deployment for (?:connection|instance|Agent Graph): '([^']+)'(?:\s+—\s+version\s+[^ ]+)? finished\.\.\./
  );
  if (finished) {
    return { kind: "deployment", phase: "finished", label: finished[1] };
  }

  const jsonItem = parseJsonLine(line);
  if (jsonItem) return jsonItem;

  if (line.startsWith("›")) return null;

  return null;
}

function collectOutputLines(log: LogLine[]): string[] {
  const lines: string[] = [];
  for (const entry of log) {
    if (entry.channel === "meta") continue;
    for (const part of stripAnsi(entry.text).split("\n")) {
      const trimmed = part.trim();
      if (trimmed) lines.push(trimmed);
    }
  }
  return lines;
}

function parseMetaLine(text: string, command?: CliCommand | "install-plugin"): CliActivityItem | null {
  if (text.startsWith("$ ")) {
    return {
      kind: "run-start",
      command: command ?? "build",
      summary: summarizeCliInvocation(text),
    };
  }
  if (text.includes("Completed successfully")) {
    return { kind: "outcome", ok: true, text: "Completed successfully" };
  }
  if (/failed/i.test(text)) {
    return {
      kind: "outcome",
      ok: false,
      text: stripAnsi(text).replace(/^❌\s*/, "").replace(/\.$/, ""),
    };
  }
  if (text.includes("Installed ") && text.includes("✅")) {
    return { kind: "outcome", ok: true, text: stripAnsi(text).replace(/^✅\s*/, "") };
  }
  if (text.trim()) {
    return { kind: "message", text: stripAnsi(text), tone: "muted" };
  }
  return null;
}

/** Join streamed log chunks into readable CLI output (verbatim, ANSI stripped). */
export function formatRawCliLog(log: LogLine[]): string {
  return log
    .map((entry) => {
      let text = stripAnsi(entry.text);
      if (entry.channel === "meta") text += "\n";
      return text;
    })
    .join("");
}

/** Turn raw streamed CLI log lines into structured activity items for the UI. */
export function parseCliActivityLog(
  log: LogLine[],
  command?: CliCommand | "install-plugin"
): CliActivityItem[] {
  const items: CliActivityItem[] = [];
  const seenErrors = new Set<string>();

  for (const entry of log) {
    if (entry.channel !== "meta") continue;
    const item = parseMetaLine(entry.text, command);
    if (item) items.push(item);
  }

  for (const line of collectOutputLines(log)) {
    const item = parseStructuredLine(line);
    if (!item) continue;
    if (item.kind === "error") {
      const key = `${item.code ?? ""}:${item.message}`;
      if (seenErrors.has(key)) continue;
      seenErrors.add(key);
    }
    items.push(item);
  }

  for (const item of parseOclifErrorBlock(collectOutputLines(log))) {
    if (item.kind !== "error") continue;
    const key = `${item.code ?? ""}:${item.message}`;
    if (seenErrors.has(key)) continue;
    seenErrors.add(key);
    items.push(item);
  }

  return dropGenericWrapperErrors(items);
}

function dropGenericWrapperErrors(items: CliActivityItem[]): CliActivityItem[] {
  const errors = items.filter(
    (item): item is Extract<CliActivityItem, { kind: "error" }> => item.kind === "error"
  );
  if (errors.length <= 1) return items;
  return items.filter(
    (item) =>
      item.kind !== "error" ||
      item.code !== 9001 ||
      !/check the logs for more details/i.test(item.message)
  );
}
