"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, GitCompare, Pencil, RotateCcw } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import { serializeProject, type SerializedFile } from "@/lib/composer/serialize";
import { parseProjectFiles, type ParseFilesInput } from "@/lib/composer/parse";
import ProjectComparePanel from "@/components/composer/ProjectComparePanel";
import SegmentedControl from "@/components/composer/SegmentedControl";
import JsonMonacoEditor from "@/components/composer/JsonMonacoEditor";
import YamlMonacoEditor from "@/components/composer/YamlMonacoEditor";
import { Button } from "@/components/composer/ui";
import {
  PreviewResizeHandle,
  ProjectFilesToggle,
} from "@/components/composer/ProjectFilesChrome";
import { validateAgentScriptSource } from "@/lib/composer/agentscript-conformance";
import { validateProject } from "@/lib/composer/validate";

type PreviewMode = "live" | "edit" | "compare";

function CopyContentsButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  async function copyContents() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — no-op.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copyContents()}
      className="flex items-center gap-1 text-xs text-gray-500 hover:text-primary"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy contents"}
    </button>
  );
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

/** Shared empty set so unhighlighted files don't allocate one per render. */
const NO_HIGHLIGHT: ReadonlySet<number> = new Set<number>();

function FileBlock({ file, highlight }: { file: SerializedFile; highlight: ReadonlySet<number> }) {
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
        <CopyContentsButton content={file.content} />
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
  const isYaml = file.language === "yaml";
  const isJson = file.language === "json";
  return (
    <div className="mb-3 overflow-hidden rounded-md border border-gray-200">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-1.5">
        <span className="font-mono text-xs font-medium text-gray-700">{file.path}</span>
        <CopyContentsButton content={value} />
      </div>
      {isYaml ? (
        <div className="h-[360px] w-full bg-white">
          <YamlMonacoEditor value={value} onChange={onChange} className="h-full w-full" />
        </div>
      ) : isJson ? (
        <div className="h-[360px] w-full bg-white">
          <JsonMonacoEditor value={value} onChange={onChange} className="h-full w-full" />
        </div>
      ) : (
        <textarea
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block min-h-[160px] w-full resize-y overflow-auto bg-white px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-800 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-primary"
        />
      )}
    </div>
  );
}

const COMPARE_EGG_SESSION_KEY = "composer-baseline-compare-unlocked";
const COMPARE_EGG_CLICKS = 5;
const COMPARE_EGG_RESET_MS = 2000;

export default function FilePreview({
  onToggle,
  onResizeStart,
}: {
  onToggle: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
}) {
  const { project, dispatch } = useComposer();
  const files = useMemo(() => serializeProject(project), [project]);

  const [compareUnlocked, setCompareUnlocked] = useState(false);
  const [compareEggHint, setCompareEggHint] = useState(false);
  const compareClickCountRef = useRef(0);
  const compareClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mode, setMode] = useState<PreviewMode>("live");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const [applying, setApplying] = useState(false);
  const confirmedDraftRef = useRef<string | null>(null);
  const editBaseFilesRef = useRef<Map<string, string> | null>(null);

  const prevRef = useRef<Map<string, string>>(new Map());
  const [highlights, setHighlights] = useState<Map<string, Set<number>>>(new Map());

  useEffect(() => {
    if (sessionStorage.getItem(COMPARE_EGG_SESSION_KEY) === "1") {
      setCompareUnlocked(true);
    }
  }, []);

  useEffect(() => {
    if (mode === "compare" && !compareUnlocked) {
      setMode("live");
    }
  }, [compareUnlocked, mode]);

  useEffect(() => {
    return () => {
      if (compareClickTimerRef.current) clearTimeout(compareClickTimerRef.current);
    };
  }, []);

  function unlockCompareEasterEgg() {
    compareClickCountRef.current += 1;
    if (compareClickTimerRef.current) clearTimeout(compareClickTimerRef.current);
    compareClickTimerRef.current = setTimeout(() => {
      compareClickCountRef.current = 0;
    }, COMPARE_EGG_RESET_MS);

    if (compareClickCountRef.current < COMPARE_EGG_CLICKS) return;

    compareClickCountRef.current = 0;
    sessionStorage.setItem(COMPARE_EGG_SESSION_KEY, "1");
    setCompareUnlocked(true);
    setCompareEggHint(true);
    window.setTimeout(() => setCompareEggHint(false), 3200);
  }

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
    editBaseFilesRef.current = new Map(files.map((file) => [file.path, file.content]));
    setErrors([]);
    setWarnings([]);
    confirmedDraftRef.current = null;
    setApplied(false);
    setMode("edit");
  }

  function seedFromModel() {
    setDrafts(Object.fromEntries(files.map((f) => [f.path, f.content])));
    editBaseFilesRef.current = new Map(files.map((file) => [file.path, file.content]));
    setErrors([]);
    setWarnings([]);
    confirmedDraftRef.current = null;
  }

  async function apply() {
    if (modelChangedWhileEditing) {
      setErrors([
        "The graphical model changed after file editing began. Reset drafts to the current model before applying.",
      ]);
      setWarnings([]);
      return;
    }
    setApplying(true);
    try {
    for (const file of files.filter((candidate) => candidate.language === "agent")) {
      const conformanceErrors = await validateAgentScriptSource(
        drafts[file.path] ?? file.content,
        file.path,
        { allowMigratableLegacyActionHeaders: true }
      );
      if (conformanceErrors.length > 0) {
        setErrors(conformanceErrors.map((error) => `${error.path}: ${error.message}`));
        setWarnings([]);
        setApplied(false);
        return;
      }
    }
    const result = parseProjectFiles(toParseInput(drafts, files));
    if (!result.ok) {
      setErrors(result.errors);
      setWarnings([]);
      setApplied(false);
      return;
    }
    const validation = validateProject(result.project);
    if (!validation.ok) {
      setErrors(validation.errors.map((issue) => issue.message));
      setWarnings([]);
      setApplied(false);
      return;
    }
    const draftKey = JSON.stringify(drafts);
    if (result.warnings.length > 0 && confirmedDraftRef.current !== draftKey) {
      confirmedDraftRef.current = draftKey;
      setErrors([]);
      setWarnings(result.warnings);
      setApplied(false);
      return;
    }
    dispatch({ type: "loadProject", project: result.project });
    editBaseFilesRef.current = new Map(
      serializeProject(result.project).map((file) => [file.path, file.content])
    );
    setErrors([]);
    setWarnings([]);
    confirmedDraftRef.current = null;
    setApplied(true);
    setTimeout(() => setApplied(false), 1500);
    // Re-sync drafts to the normalized re-serialized model.
    setTimeout(() => {
      setDrafts(Object.fromEntries(serializeProject(result.project).map((f) => [f.path, f.content])));
    }, 0);
    } finally {
      setApplying(false);
    }
  }

  const modelChangedWhileEditing =
    mode === "edit" &&
    editBaseFilesRef.current !== null &&
    files.some((file) => editBaseFilesRef.current?.get(file.path) !== file.content);

  const modeHint =
    compareEggHint ? (
      <span className="text-primary">Baseline compare unlocked for this session.</span>
    ) : mode === "live" ? (
      "Read-only · live projection"
    ) : mode === "edit" ? (
      "Editable · Apply loads into model"
    ) : (
      "Compare live export vs baseline"
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-t border-b border-composer-border bg-composer-surface px-2">
        <ProjectFilesToggle open onToggle={onToggle} />
        <PreviewResizeHandle onResizeStart={onResizeStart} />
        <button
          type="button"
          onClick={unlockCompareEasterEgg}
          title="Project files"
          className="min-w-0 max-w-[28%] shrink truncate text-left text-xs text-composer-label-muted hover:text-composer-label"
        >
          {modeHint}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <SegmentedControl
            aria-label="Project files mode"
            value={mode}
            onChange={(next) => {
              if (next === "edit") enterEdit();
              else setMode(next);
            }}
            options={[
              ...(compareUnlocked
                ? [
                    {
                      value: "compare" as const,
                      label: "Compare",
                      icon: <GitCompare className="h-3.5 w-3.5" />,
                    },
                  ]
                : []),
              { value: "live" as const, label: "Live" },
              {
                value: "edit" as const,
                label: "Edit",
                icon: <Pencil className="h-3.5 w-3.5" />,
              },
            ]}
          />
          {mode === "edit" ? (
            <>
              <Button variant="ghost" onClick={seedFromModel} title="Reset drafts to the current model">
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="primary"
                onClick={() => void apply()}
                disabled={applying || modelChangedWhileEditing}
                title={
                  modelChangedWhileEditing
                    ? "The model changed while these drafts were open; reset before applying."
                    : undefined
                }
              >
                {applied ? <Check className="h-3.5 w-3.5" /> : null}
                {warnings.length > 0 ? "Apply with migrations" : applying ? "Validating…" : "Apply"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {modelChangedWhileEditing ? (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The graphical model changed while these file drafts were open. Reset drafts before
          applying.
        </div>
      ) : null}

      {mode === "edit" && errors.length > 0 ? (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Could not parse files
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-600">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {mode === "edit" && warnings.length > 0 ? (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" /> Review migrations before applying
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700">
            {warnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-amber-700">
            Click Apply with migrations to accept these semantic changes.
          </p>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "compare" ? (
          <ProjectComparePanel />
        ) : (
          <div className="h-full overflow-auto p-3 scrollbar-thin">
            {mode === "live"
              ? files.map((f) => (
                  <FileBlock key={f.path} file={f} highlight={highlights.get(f.path) ?? NO_HIGHLIGHT} />
                ))
              : files.map((f) => (
                  <EditableFileBlock
                    key={f.path}
                    file={f}
                    value={drafts[f.path] ?? f.content}
                    onChange={(next) => {
                      confirmedDraftRef.current = null;
                      setWarnings([]);
                      setDrafts((current) => ({ ...current, [f.path]: next }));
                    }}
                  />
                ))}
          </div>
        )}
      </div>
    </div>
  );
}
