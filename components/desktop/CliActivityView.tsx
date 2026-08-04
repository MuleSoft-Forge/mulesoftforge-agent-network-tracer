"use client";

import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";
import { parseCliActivityLog, type CliActivityItem } from "@/lib/desktop/cli-output-parser";
import type { LogLine } from "@/lib/desktop/useAgentNetworkCli";
import type { CliCommand } from "@/lib/desktop/types";

interface CliActivityViewProps {
  log: LogLine[];
  command?: CliCommand | "install-plugin";
  busy?: boolean;
}

function DeploymentIcon({ phase }: { phase: CliActivityItem & { kind: "deployment" } }) {
  if (phase.phase === "finished") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden />;
  }
  if (phase.phase === "waiting") {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />;
  }
  return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" aria-hidden />;
}

function ActivityRow({ item }: { item: CliActivityItem }) {
  switch (item.kind) {
    case "run-start":
      return (
        <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
          <Play className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">{item.summary}</p>
            <p className="mt-0.5 text-xs text-gray-500">Agent Network lifecycle</p>
          </div>
        </div>
      );

    case "derived-space":
      return (
        <div className="flex items-start gap-3 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2.5">
          <Globe className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" aria-hidden />
          <p className="text-sm text-sky-900">
            Shared space <span className="font-mono text-xs">{item.space}</span> from gateway{" "}
            <span className="font-mono text-xs">{item.gateway}</span>
          </p>
        </div>
      );

    case "message":
      return (
        <p
          className={
            item.tone === "info"
              ? "text-sm text-gray-800"
              : item.tone === "error"
                ? "text-sm text-red-700"
                : "text-sm text-gray-500"
          }
        >
          {item.text}
        </p>
      );

    case "deployment":
      return (
        <div className="flex items-center gap-2.5 py-0.5 pl-1">
          <DeploymentIcon phase={item} />
          <span className="text-sm text-gray-800">{item.label}</span>
          <span className="text-xs text-gray-400">
            {item.phase === "starting"
              ? "Starting"
              : item.phase === "waiting"
                ? "Waiting"
                : "Ready"}
          </span>
        </div>
      );

    case "endpoint":
      return (
        <div className="ml-6 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{item.name}</p>
              {item.version ? (
                <p className="text-xs text-gray-400">v{item.version}</p>
              ) : null}
              <p className="mt-1 truncate font-mono text-[11px] text-gray-500">{item.url}</p>
            </div>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-primary"
              aria-label={`Open ${item.name}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      );

    case "error":
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium text-red-900">
                {item.code != null ? `Error ${item.code}` : "Deployment error"}
              </p>
              <p className="mt-1 text-sm text-red-800">{item.message}</p>
              {item.detail && item.detail !== item.message ? (
                <p className="mt-1 text-xs text-red-700/80">{item.detail}</p>
              ) : null}
            </div>
          </div>
        </div>
      );

    case "outcome":
      return (
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
            item.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
          }`}
        >
          {item.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <XCircle className="h-4 w-4 shrink-0" aria-hidden />
          )}
          <span className="text-sm font-medium">{item.text}</span>
        </div>
      );

    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

export default function CliActivityView({ log, command, busy = false }: CliActivityViewProps) {
  const items = parseCliActivityLog(log, command);

  if (items.length === 0 && !busy) {
    return null;
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <ActivityRow key={`${item.kind}-${index}`} item={item} />
      ))}
      {busy ? (
        <div className="flex items-center gap-2 px-1 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Running…
        </div>
      ) : null}
    </div>
  );
}
