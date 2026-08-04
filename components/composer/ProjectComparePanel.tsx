"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  FolderOpen,
  FileArchive,
  X,
} from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import { serializeProject } from "@/lib/composer/serialize";
import { compareProjectWithBaseline, type FileCompareResult } from "@/lib/composer/compare/compare-with-baseline";
import type { DiffRow } from "@/lib/composer/compare/line-diff";
import { useBaselineFolder } from "@/components/composer/useBaselineFolder";
import { Button } from "@/components/composer/ui";

const STATUS_LABEL: Record<FileCompareResult["status"], string> = {
  match: "Match",
  diff: "Diff",
  "missing-baseline": "Missing in baseline",
  "missing-current": "Not in model",
};

const STATUS_CLS: Record<FileCompareResult["status"], string> = {
  match: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  diff: "bg-amber-50 text-amber-900 ring-amber-200",
  "missing-baseline": "bg-red-50 text-red-800 ring-red-200",
  "missing-current": "bg-gray-100 text-gray-700 ring-gray-200",
};

function rowBg(kind: DiffRow["kind"]): string {
  if (kind === "add") return "bg-emerald-50";
  if (kind === "remove") return "bg-red-50";
  return "";
}

function DiffView({ file }: { file: FileCompareResult }) {
  if (file.status === "match") {
    return (
      <p className="px-3 py-6 text-center text-xs text-emerald-700">
        Identical to baseline ({file.baselineBytes} bytes).
      </p>
    );
  }

  if (file.status === "missing-baseline") {
    return (
      <p className="px-3 py-6 text-center text-xs text-red-600">
        Baseline folder has no matching file for this slot. Current: {file.currentBytes} bytes.
      </p>
    );
  }

  if (file.status === "missing-current") {
    return (
      <p className="px-3 py-6 text-center text-xs text-gray-500">
        Current model does not emit this file. Baseline: {file.baselineBytes} bytes.
      </p>
    );
  }

  const visible = file.rows.filter((r) => r.kind !== "same");

  if (visible.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-gray-500">
        Line endings or trailing newline only — treat as match for now.
      </p>
    );
  }

  return (
    <pre className="overflow-auto text-[11px] leading-relaxed">
      <code>
        {file.rows.map((row, i) => {
          if (row.kind === "same") return null;
          return (
            <div key={i} className={`flex gap-2 px-3 ${rowBg(row.kind)}`}>
              <span className="w-8 shrink-0 select-none text-right text-[10px] text-gray-400">
                {row.kind === "remove" ? row.leftNo : row.rightNo}
              </span>
              <span className="w-3 shrink-0 font-bold text-gray-500">
                {row.kind === "remove" ? "−" : "+"}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre text-gray-800">
                {row.kind === "remove" ? row.left : row.right}
              </span>
            </div>
          );
        })}
      </code>
    </pre>
  );
}

export default function ProjectComparePanel() {
  const { project } = useComposer();
  const currentFiles = useMemo(() => serializeProject(project), [project]);
  const {
    folderInputRef,
    zipInputRef,
    baselineLabel,
    baselineEntries,
    loading,
    error,
    pickFolder,
    pickZip,
    onFolderChange,
    onZipChange,
    clearBaseline,
    hasBaseline,
  } = useBaselineFolder();

  const [activePath, setActivePath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);

  const result = useMemo(() => {
    if (!hasBaseline || !baselineEntries || !baselineLabel) return null;
    return compareProjectWithBaseline(currentFiles, baselineEntries, baselineLabel);
  }, [currentFiles, baselineEntries, baselineLabel, hasBaseline]);

  const selectedPath = activePath ?? result?.files[0]?.path ?? null;
  const selectedFile = result?.files.find((f) => f.path === selectedPath);

  async function copyReport() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.reportMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = result.reportMarkdown;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        // @ts-expect-error webkitdirectory is supported in Chromium
        webkitdirectory=""
        directory=""
        multiple
        onChange={(e) => void onFolderChange(e.target.files)}
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => void onZipChange(e.target.files?.[0] ?? null)}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Compare baseline</h3>
          <p className="text-[11px] text-gray-400">
            Live model vs Exchange baseline (folder or .zip) · updates as you edit
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={pickFolder} disabled={loading}>
            <FolderOpen className="h-3.5 w-3.5" />
            Folder…
          </Button>
          <Button variant="secondary" onClick={pickZip} disabled={loading}>
            <FileArchive className="h-3.5 w-3.5" />
            Baseline zip…
          </Button>
          {hasBaseline ? (
            <>
              <Button variant="primary" onClick={() => void copyReport()} disabled={!result}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                Copy report
              </Button>
              <Button variant="ghost" onClick={clearBaseline} title="Clear baseline">
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      ) : null}

      {!hasBaseline ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <FolderOpen className="h-10 w-10 text-gray-300" />
          <div>
            <p className="text-sm font-medium text-gray-700">Pick a compare baseline</p>
            <p className="mt-1 max-w-md text-xs text-gray-500">
              On Exchange → Versions, click <span className="font-medium">Baseline</span> to download
              raw project sources. Then load that zip here, or use a local ACB folder.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={pickZip}>
              <FileArchive className="h-3.5 w-3.5" /> Baseline zip…
            </Button>
            <Button variant="primary" onClick={pickFolder}>
              <FolderOpen className="h-3.5 w-3.5" /> Project folder…
            </Button>
          </div>
        </div>
      ) : (
        <>
          {result ? (
            <div className="border-b border-gray-200 bg-gray-50 px-3 py-2">
              <button
                type="button"
                onClick={() => setSummaryOpen((v) => !v)}
                className="flex w-full items-center justify-between text-left"
              >
                <div>
                  <p className="text-xs font-medium text-gray-800">
                    Baseline: <span className="font-mono">{result.baselineLabel}</span>
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {result.summary.matching}/{result.summary.total} files match
                    {result.summary.differing > 0
                      ? ` · ${result.summary.differing} differ`
                      : " · no diffs"}
                  </p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${summaryOpen ? "rotate-180" : ""}`}
                />
              </button>
              {summaryOpen ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.files.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => setActivePath(f.path)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors ${
                        selectedPath === f.path ? "ring-primary/40 bg-white" : ""
                      } ${STATUS_CLS[f.status]}`}
                    >
                      {f.path.split("/").pop()} · {STATUS_LABEL[f.status]}
                      {f.status === "diff"
                        ? ` (+${f.stats.added}/−${f.stats.removed})`
                        : ""}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-hidden">
            {selectedFile ? (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-gray-200 bg-white px-3 py-1.5">
                  <div className="min-w-0">
                    <span className="font-mono text-xs font-medium text-gray-700">{selectedFile.path}</span>
                    {selectedFile.baselinePath ? (
                      <span className="ml-2 text-[10px] text-gray-400">
                        baseline: {selectedFile.baselinePath}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[10px] text-gray-400">
                    {selectedFile.baselineBytes} B → {selectedFile.currentBytes} B
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-white">
                  <DiffView file={selectedFile} />
                </div>
              </div>
            ) : (
              <p className="p-4 text-xs text-gray-400">Select a file above to view diffs.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
