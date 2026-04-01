"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, FileText, Plus, Minus, Equal } from "lucide-react";
import { diffLines, diffStats } from "@/lib/diff-lines";
import type { DiffLine, DiffStats } from "@/lib/diff-lines";
import { beautifyIfJsonPackaging } from "@/lib/json-beautify";

export interface ExchangeFileEntry {
  classifier: string;
  packaging: string;
  content: string | null;
}

export interface VersionFiles {
  version: string;
  /** agent-network.yaml, exchange.json from the Maven-published zip */
  published: ExchangeFileEntry[];
  /** e.g. a2a-card.json, agent-metadata.json from the broker asset on Exchange */
  exchangeAsset: ExchangeFileEntry[];
}

interface ExchangeFileDiffProps {
  before: VersionFiles;
  after: VersionFiles;
}

interface FileDiffData {
  classifier: string;
  packaging: string;
  beforeContent: string | null;
  afterContent: string | null;
  status: "added" | "removed" | "changed" | "unchanged";
  lines: DiffLine[];
  stats: DiffStats;
}

function fileKey(f: ExchangeFileEntry): string {
  return `${f.classifier}::${f.packaging}`;
}

/** Line-level diffs for two file lists (same role, e.g. both published or both exchange-asset). */
export function computeFileDiffsFromEntries(
  beforeFiles: ExchangeFileEntry[],
  afterFiles: ExchangeFileEntry[]
): FileDiffData[] {
  const allKeys = new Set<string>();
  const beforeMap = new Map<string, ExchangeFileEntry>();
  const afterMap = new Map<string, ExchangeFileEntry>();

  for (const f of beforeFiles) {
    const key = fileKey(f);
    allKeys.add(key);
    beforeMap.set(key, f);
  }
  for (const f of afterFiles) {
    const key = fileKey(f);
    allKeys.add(key);
    afterMap.set(key, f);
  }

  const results: FileDiffData[] = [];

  for (const key of Array.from(allKeys).sort()) {
    const bFile = beforeMap.get(key);
    const aFile = afterMap.get(key);
    const classifier = bFile?.classifier ?? aFile?.classifier ?? "";
    const packaging = bFile?.packaging ?? aFile?.packaging ?? "";

    const beforeContent = beautifyIfJsonPackaging(packaging, bFile?.content ?? null);
    const afterContent = beautifyIfJsonPackaging(packaging, aFile?.content ?? null);

    let status: FileDiffData["status"];
    let lines: DiffLine[] = [];
    let stats: DiffStats = { added: 0, removed: 0, unchanged: 0 };

    if (!bFile && aFile) {
      status = "added";
      lines = (afterContent ?? "").split("\n").map((content, i) => ({
        type: "added" as const,
        content,
        oldLineNumber: null,
        newLineNumber: i + 1,
      }));
      stats = { added: lines.length, removed: 0, unchanged: 0 };
    } else if (bFile && !aFile) {
      status = "removed";
      lines = (beforeContent ?? "").split("\n").map((content, i) => ({
        type: "removed" as const,
        content,
        oldLineNumber: i + 1,
        newLineNumber: null,
      }));
      stats = { added: 0, removed: lines.length, unchanged: 0 };
    } else if (beforeContent === afterContent) {
      status = "unchanged";
      lines = (afterContent ?? "").split("\n").map((content, i) => ({
        type: "unchanged" as const,
        content,
        oldLineNumber: i + 1,
        newLineNumber: i + 1,
      }));
      stats = { added: 0, removed: 0, unchanged: lines.length };
    } else {
      status = "changed";
      lines = diffLines(beforeContent ?? "", afterContent ?? "");
      stats = diffStats(lines);
    }

    results.push({ classifier, packaging, beforeContent, afterContent, status, lines, stats });
  }

  const order: Record<string, number> = { changed: 0, added: 1, removed: 2, unchanged: 3 };
  results.sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4));

  return results;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string; icon: typeof Plus }> = {
  added: { bg: "bg-green-100", text: "text-green-700", label: "Added", icon: Plus },
  removed: { bg: "bg-red-100", text: "text-red-700", label: "Removed", icon: Minus },
  changed: { bg: "bg-amber-100", text: "text-amber-700", label: "Changed", icon: FileText },
  unchanged: { bg: "bg-gray-100", text: "text-gray-500", label: "Unchanged", icon: Equal },
};

function FileDiffBlock({ diff }: { diff: FileDiffData }) {
  const [expanded, setExpanded] = useState(diff.status !== "unchanged");
  const style = STATUS_STYLES[diff.status];
  const Icon = style.icon;

  const contextLines = 3;
  const visibleLines = useMemo(() => {
    if (diff.status === "unchanged" || diff.status === "added" || diff.status === "removed") {
      return diff.lines;
    }

    const changeIndices = new Set<number>();
    diff.lines.forEach((line, i) => {
      if (line.type !== "unchanged") {
        for (let c = Math.max(0, i - contextLines); c <= Math.min(diff.lines.length - 1, i + contextLines); c++) {
          changeIndices.add(c);
        }
      }
    });

    const result: (DiffLine | { type: "separator"; count: number })[] = [];
    let lastIncluded = -1;

    for (let i = 0; i < diff.lines.length; i++) {
      if (changeIndices.has(i)) {
        if (lastIncluded >= 0 && i - lastIncluded > 1) {
          result.push({ type: "separator", count: i - lastIncluded - 1 });
        }
        result.push(diff.lines[i]);
        lastIncluded = i;
      }
    }

    if (lastIncluded < diff.lines.length - 1) {
      const remaining = diff.lines.length - 1 - lastIncluded;
      if (remaining > 0) {
        result.push({ type: "separator", count: remaining });
      }
    }

    return result;
  }, [diff.lines, diff.status]);

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
        )}
        <Icon className={`h-3.5 w-3.5 ${style.text} shrink-0`} />
        <span className="text-sm font-mono font-medium text-gray-900 truncate">
          {diff.classifier}.{diff.packaging}
        </span>
        <span className={`ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}>
          {style.label}
        </span>
        {diff.status === "changed" && (
          <span className="text-[10px] text-gray-400 tabular-nums">
            <span className="text-green-600">+{diff.stats.added}</span>
            {" "}
            <span className="text-red-600">-{diff.stats.removed}</span>
          </span>
        )}
      </button>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <tbody>
              {(visibleLines as (DiffLine | { type: "separator"; count: number })[]).map((line, i) => {
                if ("count" in line && line.type === "separator") {
                  return (
                    <tr key={`sep-${i}`} className="bg-gray-50">
                      <td colSpan={3} className="px-3 py-1 text-center text-[10px] text-gray-400 select-none">
                        ··· {line.count} unchanged line{line.count !== 1 ? "s" : ""} ···
                      </td>
                    </tr>
                  );
                }

                const dl = line as DiffLine;
                const bgColor =
                  dl.type === "added"
                    ? "bg-green-50"
                    : dl.type === "removed"
                      ? "bg-red-50"
                      : "";
                const textColor =
                  dl.type === "added"
                    ? "text-green-800"
                    : dl.type === "removed"
                      ? "text-red-800"
                      : "text-gray-700";
                const lineNumColor =
                  dl.type === "added"
                    ? "text-green-400"
                    : dl.type === "removed"
                      ? "text-red-400"
                      : "text-gray-300";
                const prefix =
                  dl.type === "added" ? "+" : dl.type === "removed" ? "-" : " ";

                return (
                  <tr key={`${dl.type}-${dl.oldLineNumber}-${dl.newLineNumber}-${i}`} className={bgColor}>
                    <td className={`w-10 text-right pr-1 select-none ${lineNumColor} border-r border-gray-200`}>
                      {dl.oldLineNumber ?? ""}
                    </td>
                    <td className={`w-10 text-right pr-1 select-none ${lineNumColor} border-r border-gray-200`}>
                      {dl.newLineNumber ?? ""}
                    </td>
                    <td className={`pl-2 pr-3 py-0 whitespace-pre ${textColor}`}>
                      <span className={`select-none ${dl.type === "unchanged" ? "text-gray-300" : textColor}`}>
                        {prefix}
                      </span>
                      {dl.content}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FileDiffSection({
  title,
  subtitle,
  diffs,
}: {
  title: string;
  subtitle: string;
  diffs: FileDiffData[];
}) {
  if (diffs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-3 py-2">
        <p className="text-xs font-medium text-gray-700">{title}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>
        <p className="text-xs text-gray-400 mt-2">No files in this category for one or both versions.</p>
      </div>
    );
  }

  const totalChanged = diffs.filter((d) => d.status !== "unchanged").length;
  const totalUnchanged = diffs.filter((d) => d.status === "unchanged").length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-gray-900">{title}</p>
          <p className="text-[11px] text-gray-500">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10px] text-gray-500">
          {totalChanged > 0 && (
            <span>
              {totalChanged} changed
            </span>
          )}
          {totalUnchanged > 0 && (
            <span>{totalUnchanged} unchanged</span>
          )}
        </div>
      </div>
      <div className="space-y-2">
        {diffs.map((diff) => (
          <FileDiffBlock key={`${diff.classifier}::${diff.packaging}`} diff={diff} />
        ))}
      </div>
    </div>
  );
}

export default function ExchangeFileDiff({ before, after }: ExchangeFileDiffProps) {
  const publishedDiffs = useMemo(
    () => computeFileDiffsFromEntries(before.published, after.published),
    [before.published, after.published]
  );
  const exchangeAssetDiffs = useMemo(
    () => computeFileDiffsFromEntries(before.exchangeAsset, after.exchangeAsset),
    [before.exchangeAsset, after.exchangeAsset]
  );

  const anyFiles = publishedDiffs.length > 0 || exchangeAssetDiffs.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          File diff: {before.version} → {after.version}
        </h3>
      </div>

      {!anyFiles ? (
        <p className="text-sm text-gray-500">No downloadable text files found in these versions.</p>
      ) : (
        <>
          <FileDiffSection
            title="Published artifact (Maven)"
            subtitle="agent-network.yaml and exchange.json from the agent-network zip"
            diffs={publishedDiffs}
          />
          <FileDiffSection
            title="Exchange asset files"
            subtitle="Files attached to the broker asset in Exchange (e.g. a2a-card, agent-metadata)"
            diffs={exchangeAssetDiffs}
          />
        </>
      )}
    </div>
  );
}
