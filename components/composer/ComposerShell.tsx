"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Network,
  GitBranch,
  PanelBottomClose,
  PanelBottomOpen,
  ChevronDown,
  Code2,
  X,
} from "lucide-react";
import { ComposerProvider, useComposer } from "@/lib/composer/store";
import { validateProject, type ValidationIssue } from "@/lib/composer/validate";
import { resolveIssueNavigation } from "@/lib/composer/issue-navigation";
import { Button } from "@/components/composer/ui";
import BrokerGraphEditor from "@/components/composer/BrokerGraphEditor";
import AgentScriptPanel from "@/components/composer/AgentScriptPanel";
import ComposerLanding from "@/components/composer/ComposerLanding";
import TopologyView from "@/components/composer/TopologyView";
import NodeInspector from "@/components/composer/NodeInspector";
import {
  ComposerNav,
  ComposerPanelContent,
  isGraphPanelTab,
  type PanelTab,
} from "@/components/composer/ProjectPanels";
import FilePreview from "@/components/composer/FilePreview";

type CenterTab = "graph" | "topology";
type GraphViewMode = "composer" | "agentscript";

const PREVIEW_HEIGHT_KEY = "composer-preview-height";
const PREVIEW_MIN_PX = 120;
const MAIN_MIN_PX = 160;
const PREVIEW_DEFAULT_RATIO = 0.35;
/** SSR-safe initial height — persisted value applied after mount. */
const PREVIEW_INITIAL_PX = 280;

function readStoredPreviewHeight(): number {
  const stored = window.localStorage.getItem(PREVIEW_HEIGHT_KEY);
  if (stored) {
    const n = Number.parseInt(stored, 10);
    if (Number.isFinite(n) && n >= PREVIEW_MIN_PX) return n;
  }
  return Math.round(window.innerHeight * PREVIEW_DEFAULT_RATIO);
}

function PreviewResizeHandle({ onResizeStart }: { onResizeStart: (e: React.MouseEvent) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize project files panel"
      onMouseDown={onResizeStart}
      className="group flex h-2 shrink-0 cursor-ns-resize items-center justify-center border-t border-gray-200 bg-gray-100 hover:bg-gray-200 active:bg-gray-300"
    >
      <div className="h-1 w-10 rounded-full bg-gray-300 transition-colors group-hover:bg-gray-400 group-active:bg-gray-500" />
    </div>
  );
}

function ValidationIssueList({
  title,
  issues,
  tone,
  onIssueClick,
}: {
  title: string;
  issues: ValidationIssue[];
  tone: "error" | "warning";
  onIssueClick: (issue: ValidationIssue) => void;
}) {
  if (issues.length === 0) return null;
  const titleCls = tone === "error" ? "text-red-700" : "text-amber-700";
  const buttonCls =
    tone === "error"
      ? "text-red-700 hover:bg-red-50"
      : "text-amber-800 hover:bg-amber-50";
  return (
    <div>
      <p className={`mb-1.5 text-xs font-semibold ${titleCls}`}>
        {title} ({issues.length})
      </p>
      <ul className="space-y-1">
        {issues.map((issue, i) => {
          const nav = resolveIssueNavigation(issue);
          return (
            <li key={`${tone}-${i}`}>
              <button
                type="button"
                onClick={() => onIssueClick(issue)}
                className={`w-full rounded-md px-2 py-1.5 text-left text-xs leading-relaxed ${buttonCls}`}
              >
                <span className="block">{issue.message}</span>
                <span className="mt-0.5 block text-[10px] font-medium opacity-70">Open {nav.tabLabel} tab</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ValidationStrip({ onIssueClick }: { onIssueClick: (issue: ValidationIssue) => void }) {
  const { project } = useComposer();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const result = useMemo(() => validateProject(project), [project]);

  useEffect(() => {
    if (!open) return;
    function onDocumentClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, [open]);

  function handleIssueClick(issue: ValidationIssue) {
    onIssueClick(issue);
    setOpen(false);
  }

  if (result.errors.length === 0 && result.warnings.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5" /> Valid
      </div>
    );
  }

  const hasErrors = result.errors.length > 0;

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs hover:bg-gray-100"
      >
        <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${hasErrors ? "text-red-500" : "text-amber-500"}`} />
        <span className="text-gray-600">
          {result.errors.length} error{result.errors.length === 1 ? "" : "s"},{" "}
          {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-1/2 top-full z-50 mt-1 max-h-[min(60vh,420px)] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 overflow-auto rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <div className="space-y-3">
            <ValidationIssueList title="Errors" issues={result.errors} tone="error" onIssueClick={handleIssueClick} />
            <ValidationIssueList title="Warnings" issues={result.warnings} tone="warning" onIssueClick={handleIssueClick} />
          </div>
        </div>
      )}
    </div>
  );
}

function Inner({
  importWarnings,
  onDismissWarnings,
}: {
  importWarnings: string[];
  onDismissWarnings: () => void;
}) {
  const { project } = useComposer();
  const shellRef = useRef<HTMLDivElement>(null);
  const [centerTab, setCenterTab] = useState<CenterTab>("graph");
  const [graphViewMode, setGraphViewMode] = useState<GraphViewMode>("composer");
  const [panelTab, setPanelTab] = useState<PanelTab>("identity");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewHeight, setPreviewHeight] = useState(PREVIEW_INITIAL_PX);
  const showCanvas = isGraphPanelTab(panelTab);

  const clampPreviewHeight = useCallback((height: number) => {
    const shell = shellRef.current;
    const max = shell ? Math.max(PREVIEW_MIN_PX, shell.clientHeight - MAIN_MIN_PX) : height;
    return Math.min(max, Math.max(PREVIEW_MIN_PX, height));
  }, []);

  // Restore persisted height after hydration to avoid SSR/client mismatch.
  useEffect(() => {
    setPreviewHeight(clampPreviewHeight(readStoredPreviewHeight()));
  }, [clampPreviewHeight]);

  const onPreviewResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = previewHeight;

      function onMove(ev: MouseEvent) {
        const delta = startY - ev.clientY;
        setPreviewHeight(clampPreviewHeight(startHeight + delta));
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setPreviewHeight((h) => {
          window.localStorage.setItem(PREVIEW_HEIGHT_KEY, String(h));
          return h;
        });
      }

      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [clampPreviewHeight, previewHeight]
  );

  useEffect(() => {
    function onWindowResize() {
      setPreviewHeight((h) => clampPreviewHeight(h));
    }
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [clampPreviewHeight]);

  function handlePanelTabChange(next: PanelTab) {
    setPanelTab(next);
    if (!isGraphPanelTab(next)) setSelectedNodeId(null);
  }

  const handleValidationIssueClick = useCallback(
    (issue: ValidationIssue) => {
      const { tab, focusId } = resolveIssueNavigation(issue);
      setPanelTab(tab);
      if (tab === "graph") {
        setCenterTab("graph");
        setSelectedNodeId(focusId ?? null);
      } else {
        setSelectedNodeId(null);
      }
    },
    []
  );

  return (
    <div ref={shellRef} className="flex h-full flex-col bg-gray-50">
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-gray-900">Agent Network Composer</h1>
          <span className="text-gray-300">/</span>
          <span className="max-w-[220px] truncate text-sm text-gray-600">{project.identity.name}</span>
        </div>
        <ValidationStrip onIssueClick={handleValidationIssueClick} />
        <div className="flex items-center gap-2">
          {showCanvas && (
            <>
              <div className="flex rounded-md border border-gray-300 p-0.5">
                <button
                  onClick={() => setCenterTab("graph")}
                  className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${centerTab === "graph" ? "bg-primary/10 text-primary" : "text-gray-500"}`}
                >
                  <GitBranch className="h-3.5 w-3.5" /> Broker graph
                </button>
                <button
                  onClick={() => setCenterTab("topology")}
                  className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${centerTab === "topology" ? "bg-primary/10 text-primary" : "text-gray-500"}`}
                >
                  <Network className="h-3.5 w-3.5" /> Topology
                </button>
              </div>
              {centerTab === "graph" && (
                <div className="flex rounded-md border border-gray-300 p-0.5">
                  <button
                    onClick={() => {
                      setGraphViewMode("composer");
                      setSelectedNodeId(null);
                    }}
                    className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${graphViewMode === "composer" ? "bg-primary/10 text-primary" : "text-gray-500"}`}
                  >
                    <GitBranch className="h-3.5 w-3.5" /> Composer
                  </button>
                  <button
                    onClick={() => {
                      setGraphViewMode("agentscript");
                      setSelectedNodeId(null);
                    }}
                    className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${graphViewMode === "agentscript" ? "bg-primary/10 text-primary" : "text-gray-500"}`}
                  >
                    <Code2 className="h-3.5 w-3.5" /> AgentScript
                  </button>
                </div>
              )}
            </>
          )}
          <Button variant="ghost" onClick={() => setPreviewOpen((v) => !v)} title="Toggle file preview">
            {previewOpen ? <PanelBottomClose className="h-4 w-4" /> : <PanelBottomOpen className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {importWarnings.length > 0 && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Imported with {importWarnings.length} warning{importWarnings.length === 1 ? "" : "s"}:
            </p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              {importWarnings.map((w, i) => (
                <li key={`import-warn-${i}`}>{w}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={onDismissWarnings}
            className="shrink-0 rounded p-0.5 text-amber-600 hover:bg-amber-100"
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <ComposerNav tab={panelTab} onTabChange={handlePanelTabChange} />
        {!showCanvas && (
          <div className="min-w-0 flex-1 overflow-hidden border-r border-gray-200">
            <ComposerPanelContent tab={panelTab} />
          </div>
        )}
        {showCanvas && (
          <>
            <div className="min-w-0 flex-1 bg-white">
              {centerTab === "graph" ? (
                graphViewMode === "composer" ? (
                  <BrokerGraphEditor selectedId={selectedNodeId} onSelect={setSelectedNodeId} />
                ) : (
                  <AgentScriptPanel />
                )
              ) : (
                <TopologyView />
              )}
            </div>
            {selectedNodeId && graphViewMode === "composer" && centerTab === "graph" && (
              <div className="w-[380px] shrink-0 overflow-hidden border-l border-gray-200 bg-white">
                <NodeInspector nodeId={selectedNodeId} onDeleted={() => setSelectedNodeId(null)} />
              </div>
            )}
          </>
        )}
      </div>

      {previewOpen && (
        <>
          <PreviewResizeHandle onResizeStart={onPreviewResizeStart} />
          <div className="shrink-0 overflow-hidden bg-white" style={{ height: previewHeight }}>
            <FilePreview />
          </div>
        </>
      )}

    </div>
  );
}

function Root() {
  const [phase, setPhase] = useState<"choosing" | "editing">("choosing");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  if (phase === "choosing") {
    return (
      <ComposerLanding
        onEnter={(warnings) => {
          setImportWarnings(warnings ?? []);
          setPhase("editing");
        }}
      />
    );
  }

  return <Inner importWarnings={importWarnings} onDismissWarnings={() => setImportWarnings([])} />;
}

export default function ComposerShell() {
  return (
    <ComposerProvider>
      <Root />
    </ComposerProvider>
  );
}
