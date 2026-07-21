"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileDown } from "lucide-react";
import JSZip from "jszip";
import { useComposer } from "@/lib/composer/store";
import { serializeProject, type SerializedFile } from "@/lib/composer/serialize";
import { Button } from "@/components/composer/ui";

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Indices of lines in `next` that differ from `prev`. */
function changedLines(prev: string | undefined, next: string): Set<number> {
  const changed = new Set<number>();
  const prevLines = (prev ?? "").split("\n");
  const nextLines = next.split("\n");
  for (let i = 0; i < nextLines.length; i++) {
    if (prevLines[i] !== nextLines[i]) changed.add(i);
  }
  return changed;
}

function FileBlock({ file, highlight }: { file: SerializedFile; highlight: Set<number> }) {
  const firstChangedRef = useRef<HTMLDivElement | null>(null);
  const lines = file.content.replace(/\n$/, "").split("\n");
  const firstChanged = highlight.size > 0 ? Math.min(...highlight) : -1;

  useEffect(() => {
    if (firstChangedRef.current) {
      firstChangedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [highlight]);

  return (
    <div className="mb-3 overflow-hidden rounded-md border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-1.5">
        <span className="font-mono text-xs font-medium text-gray-700">{file.path}</span>
        <button
          onClick={() => download(file.path.split("/").pop() ?? file.path, file.content, "text/plain")}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-primary"
        >
          <FileDown className="h-3.5 w-3.5" /> Download
        </button>
      </div>
      <pre className="max-h-[38vh] overflow-auto bg-white text-[11px] leading-relaxed">
        <code>
          {lines.map((line, i) => {
            const isChanged = highlight.has(i);
            return (
              <div
                key={i}
                ref={i === firstChanged ? firstChangedRef : undefined}
                className={`px-3 transition-colors duration-700 ${isChanged ? "bg-amber-100" : ""}`}
              >
                <span className="mr-3 inline-block w-6 select-none text-right text-gray-300">{i + 1}</span>
                <span className="whitespace-pre text-gray-800">{line || " "}</span>
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );
}

export default function FilePreview() {
  const { project } = useComposer();
  const files = useMemo(() => serializeProject(project), [project]);

  const prevRef = useRef<Map<string, string>>(new Map());
  const [highlights, setHighlights] = useState<Map<string, Set<number>>>(new Map());

  useEffect(() => {
    const next = new Map<string, Set<number>>();
    for (const f of files) {
      const prev = prevRef.current.get(f.path);
      if (prev !== undefined && prev !== f.content) {
        next.set(f.path, changedLines(prev, f.content));
      }
    }
    // Update snapshot.
    prevRef.current = new Map(files.map((f) => [f.path, f.content]));
    if (next.size > 0) {
      setHighlights(next);
      const timer = setTimeout(() => setHighlights(new Map()), 1400);
      return () => clearTimeout(timer);
    }
  }, [files]);

  async function downloadAll() {
    const zip = new JSZip();
    for (const f of files) zip.file(f.path, f.content);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.identity.assetId || "agent-network"}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Project files</h3>
          <p className="text-[11px] text-gray-400">Read-only · live projection of the model</p>
        </div>
        <Button variant="primary" onClick={() => void downloadAll()}>
          <Download className="h-3.5 w-3.5" /> Download all
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {files.map((f) => (
          <FileBlock key={f.path} file={f} highlight={highlights.get(f.path) ?? new Set()} />
        ))}
      </div>
    </div>
  );
}
