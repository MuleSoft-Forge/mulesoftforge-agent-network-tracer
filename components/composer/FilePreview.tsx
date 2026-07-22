"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, FileDown, Pencil, RotateCcw, Check } from "lucide-react";
import JSZip from "jszip";
import { useComposer } from "@/lib/composer/store";
import { serializeProject, type SerializedFile } from "@/lib/composer/serialize";
import { parseProjectFiles, type ParseFilesInput } from "@/lib/composer/parse";
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

/** Map serialized files onto the parser's named inputs by language. */
function toParseInput(drafts: Record<string, string>, files: SerializedFile[]): ParseFilesInput {
  const input: ParseFilesInput = {};
  for (const f of files) {
    const text = drafts[f.path] ?? f.content;
    switch (f.language) {
      case "json":
        input.exchangeJson = text;
        break;
      case "yaml":
        input.agentYaml = text;
        break;
      case "agent":
        input.brokerAgent = text;
        break;
      default: {
        const _exhaustive: never = f.language;
        return _exhaustive;
      }
    }
  }
  return input;
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
      <pre className="overflow-auto bg-white text-[11px] leading-relaxed">
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

function EditableFileBlock({
  file,
  value,
  onChange,
}: {
  file: SerializedFile;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="mb-3 overflow-hidden rounded-md border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-1.5">
        <span className="font-mono text-xs font-medium text-gray-700">{file.path}</span>
        <span className="text-[10px] uppercase tracking-wide text-gray-400">{file.language}</span>
      </div>
      <textarea
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block min-h-[160px] w-full resize-y overflow-auto bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-800 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-primary"
      />
    </div>
  );
}

export default function FilePreview() {
  const { project, dispatch } = useComposer();
  const files = useMemo(() => serializeProject(project), [project]);

  const [mode, setMode] = useState<"live" | "edit">("live");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);

  const prevRef = useRef<Map<string, string>>(new Map());
  const [highlights, setHighlights] = useState<Map<string, Set<number>>>(new Map());

  useEffect(() => {
    if (mode !== "live") return;
    const next = new Map<string, Set<number>>();
    for (const f of files) {
      const prev = prevRef.current.get(f.path);
      if (prev !== undefined && prev !== f.content) {
        next.set(f.path, changedLines(prev, f.content));
      }
    }
    prevRef.current = new Map(files.map((f) => [f.path, f.content]));
    if (next.size > 0) {
      setHighlights(next);
      const timer = setTimeout(() => setHighlights(new Map()), 1400);
      return () => clearTimeout(timer);
    }
  }, [files, mode]);

  function enterEdit() {
    setDrafts(Object.fromEntries(files.map((f) => [f.path, f.content])));
    setErrors([]);
    setApplied(false);
    setMode("edit");
  }

  function seedFromModel() {
    setDrafts(Object.fromEntries(files.map((f) => [f.path, f.content])));
    setErrors([]);
  }

  function apply() {
    const result = parseProjectFiles(toParseInput(drafts, files));
    if (!result.ok) {
      setErrors(result.errors);
      setApplied(false);
      return;
    }
    dispatch({ type: "loadProject", project: result.project });
    setErrors([]);
    setApplied(true);
    setTimeout(() => setApplied(false), 1500);
    // Re-sync drafts to the normalized re-serialized model.
    setTimeout(() => {
      setDrafts(Object.fromEntries(serializeProject(result.project).map((f) => [f.path, f.content])));
    }, 0);
  }

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
          <p className="text-[11px] text-gray-400">
            {mode === "live"
              ? "Read-only · live projection of the model"
              : "Editable · paste test files, then Apply to load into the model"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mode === "live" ? (
            <>
              <Button variant="secondary" onClick={enterEdit}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button variant="primary" onClick={() => void downloadAll()}>
                <Download className="h-3.5 w-3.5" /> Download all
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={seedFromModel} title="Reset drafts to the current model">
                <RotateCcw className="h-3.5 w-3.5" /> Revert
              </Button>
              <Button variant="secondary" onClick={() => setMode("live")}>
                Done
              </Button>
              <Button variant="primary" onClick={apply}>
                {applied ? <Check className="h-3.5 w-3.5" /> : null} Apply to model
              </Button>
            </>
          )}
        </div>
      </div>

      {mode === "edit" && errors.length > 0 ? (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Could not parse files
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-red-600">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {mode === "live"
          ? files.map((f) => (
              <FileBlock key={f.path} file={f} highlight={highlights.get(f.path) ?? new Set()} />
            ))
          : files.map((f) => (
              <EditableFileBlock
                key={f.path}
                file={f}
                value={drafts[f.path] ?? f.content}
                onChange={(next) => setDrafts((d) => ({ ...d, [f.path]: next }))}
              />
            ))}
      </div>
    </div>
  );
}
