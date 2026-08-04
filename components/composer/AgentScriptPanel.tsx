"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, RotateCcw } from "lucide-react";
import { useComposer } from "@/lib/composer/store";
import { serializeProject } from "@/lib/composer/serialize";
import { parseProjectFiles, type ParseFilesInput } from "@/lib/composer/parse";
import { Button } from "@/components/composer/ui";
import AgentScriptMonacoEditor, { type AgentScriptEditorHandle } from "@/components/composer/AgentScriptMonacoEditor";
import AgentFabricGraphView from "@/components/composer/AgentFabricGraphView";

const GRAPH_MIN_PX = 240;
const EDITOR_MIN_PX = 280;
const GRAPH_DEFAULT_RATIO = 0.42;

function toParseInput(drafts: Record<string, string>, paths: string[]): ParseFilesInput {
  const input: ParseFilesInput = {};
  for (const path of paths) {
    const text = drafts[path];
    if (text == null) continue;
    if (path.endsWith(".json")) input.exchangeJson = text;
    else if (path.endsWith(".yaml")) input.agentYaml = text;
    else if (path.endsWith(".agent")) input.brokerAgent = text;
  }
  return input;
}

function HorizontalResizeHandle({ onResizeStart }: { onResizeStart: (e: React.MouseEvent) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize graph and script panels"
      onMouseDown={onResizeStart}
      className="group flex w-2 shrink-0 cursor-ew-resize items-center justify-center border-x border-gray-200 bg-gray-100 hover:bg-gray-200 active:bg-gray-300"
    >
      <div className="h-10 w-1 rounded-full bg-gray-300 transition-colors group-hover:bg-gray-400 group-active:bg-gray-500" />
    </div>
  );
}

export default function AgentScriptPanel() {
  const { project, dispatch } = useComposer();
  const files = useMemo(() => serializeProject(project), [project]);
  const brokerFile = files.find((f) => f.language === "agent");
  const panelRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<AgentScriptEditorHandle>(null);

  const [draft, setDraft] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const [graphWidth, setGraphWidth] = useState(420);

  const modelSource = brokerFile?.content ?? "";

  // Edits elsewhere in the Builder (graph, inspector) re-serialize the broker file.
  // Only pull that back into the editor while the user has no unapplied edits,
  // otherwise switching panels would silently discard their script.
  const userEditedRef = useRef(false);

  useEffect(() => {
    if (userEditedRef.current) return;
    setDraft(modelSource);
    setErrors([]);
  }, [modelSource]);

  const editDraft = useCallback((next: string) => {
    userEditedRef.current = true;
    setDraft(next);
  }, []);

  const dirty = draft !== modelSource;

  const clampGraphWidth = useCallback((width: number) => {
    const panel = panelRef.current;
    const max = panel ? Math.max(GRAPH_MIN_PX, panel.clientWidth - EDITOR_MIN_PX - 8) : width;
    return Math.min(max, Math.max(GRAPH_MIN_PX, width));
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel) setGraphWidth(clampGraphWidth(Math.round(panel.clientWidth * GRAPH_DEFAULT_RATIO)));
  }, [clampGraphWidth]);

  const onGraphResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = graphWidth;

      function onMove(ev: MouseEvent) {
        const delta = ev.clientX - startX;
        // Graph is on the right: dragging the handle left widens the graph panel.
        setGraphWidth(clampGraphWidth(startWidth - delta));
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }

      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [clampGraphWidth, graphWidth]
  );

  function revertToModel() {
    userEditedRef.current = false;
    setDraft(modelSource);
    setErrors([]);
  }

  function apply() {
    if (!brokerFile) return;
    const drafts = Object.fromEntries(files.map((f) => [f.path, f.content]));
    drafts[brokerFile.path] = draft;
    const result = parseProjectFiles({
      ...toParseInput(drafts, files.map((f) => f.path)),
      fallbackGroupId: project.identity.organizationId,
    });
    if (!result.ok) {
      setErrors(result.errors);
      setApplied(false);
      return;
    }
    // Let the re-serialized (normalized) model flow back into the editor.
    userEditedRef.current = false;
    dispatch({ type: "loadProject", project: result.project });
    setErrors([]);
    setApplied(true);
    setTimeout(() => setApplied(false), 1500);
  }

  if (!brokerFile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        No broker agent file in project
      </div>
    );
  }

  return (
    <div ref={panelRef} className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">AgentScript</h3>
          <p className="truncate font-mono text-[11px] text-gray-400">
            {brokerFile.path}
            {dirty ? " · unsaved changes" : " · synced with model"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={revertToModel} disabled={!dirty} title="Reset script to current model">
            <RotateCcw className="h-3.5 w-3.5" /> Revert
          </Button>
          <Button variant="primary" onClick={apply} disabled={!dirty}>
            {applied ? <Check className="h-3.5 w-3.5" /> : null} Apply to project
          </Button>
        </div>
      </div>

      {errors.length > 0 ? (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Could not apply script
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-red-600">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-8 shrink-0 items-center border-b border-gray-200 bg-white px-3">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">AgentFabric script</span>
          </div>
          <div className="min-h-0 flex-1">
            <AgentScriptMonacoEditor ref={editorRef} value={draft} onChange={editDraft} className="h-full w-full" />
          </div>
        </div>

        <HorizontalResizeHandle onResizeStart={onGraphResizeStart} />

        <div className="flex min-h-0 shrink-0 flex-col overflow-hidden bg-gray-50" style={{ width: graphWidth }}>
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-3">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Official graph (read-only)</span>
            <span className="text-[10px] text-gray-400">Click a node to jump to source</span>
          </div>
          <div className="min-h-0 flex-1">
            <AgentFabricGraphView
              source={draft}
              onNavigateToSource={(position) => editorRef.current?.revealPosition(position)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
