"use client";

import { formatRawCliLog } from "@/lib/desktop/cli-output-parser";
import type { LogLine } from "@/lib/desktop/useAgentNetworkCli";

interface CliRawOutputViewProps {
  log: LogLine[];
}

export default function CliRawOutputView({ log }: CliRawOutputViewProps) {
  const text = formatRawCliLog(log);

  return (
    <pre className="whitespace-pre-wrap break-words rounded-lg bg-gray-900 px-3 py-2.5 font-mono text-xs leading-relaxed text-gray-100">
      {text}
    </pre>
  );
}
