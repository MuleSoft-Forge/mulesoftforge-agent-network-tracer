"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  HelpCircle,
  ArrowLeft,
  Redo2,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { MuleIcon } from "@/components/composer/MuleIcon";
import SegmentedControl from "@/components/composer/SegmentedControl";
import BetaBadge from "@/components/ui/BetaBadge";
import { ComposerProvider, useComposer } from "@/lib/composer/store";
import { type ValidationIssue } from "@/lib/composer/validate";
import { resolveIssueNavigation } from "@/lib/composer/issue-navigation";
import {
  ValidationProvider,
  useValidationResult,
} from "@/lib/composer/validation/validation-context";
import { Button } from "@/components/composer/ui";
import BrokerGraphEditor from "@/components/composer/BrokerGraphEditor";
import AgentScriptPanel from "@/components/composer/AgentScriptPanel";
import ComposerLanding from "@/components/composer/ComposerLanding";
import NodeInspector from "@/components/composer/NodeInspector";
import {
  ComposerNav,
  ComposerPanelContent,
  isGraphPanelTab,
  type PanelTab,
} from "@/components/composer/ProjectPanels";
import { buildTabGate, isTabLocked } from "@/lib/composer/tab-gating";
import type { ProjectFocusTarget } from "@/lib/composer/project-field-anchors";
import FilePreview from "@/components/composer/FilePreview";
import { ProjectFilesClosedBar } from "@/components/composer/ProjectFilesChrome";
import { HelpModeProvider, useHelpMode } from "@/lib/composer/help/help-mode";
import { isEditorSurface, resolveShortcut } from "@/lib/composer/keyboard";
import CommandPalette from "@/components/composer/CommandPalette";
import type { Command } from "@/lib/composer/command-palette";
import type { CanvasCommand } from "@/components/composer/BrokerGraphEditor";
import ProjectMethodologyModal from "@/components/composer/ProjectMethodologyModal";
import {
  loadComposerPhaseFromSession,
  markComposerDraft,
  saveComposerPhaseToSession,
  type ComposerSessionPhase,
} from "@/lib/composer/session-persistence";

type GraphViewMode = "composer" | "agentscript";

const PREVIEW_HEIGHT_KEY = "composer-preview-height";
const INSPECTOR_WIDTH_KEY = "composer-inspector-width";
const PREVIEW_MIN_PX = 120;
const MAIN_MIN_PX = 160;
const INSPECTOR_MIN_PX = 320;
const INSPECTOR_DEFAULT_PX = 380;
const PREVIEW_DEFAULT_RATIO = 0.35;
const METHODOLOGY_MODAL_KEY = "composer-methodology-modal-dismissed";
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

function readStoredInspectorWidth(): number {
  const stored = window.localStorage.getItem(INSPECTOR_WIDTH_KEY);
  if (stored) {
    const n = Number.parseInt(stored, 10);
    if (Number.isFinite(n) && n >= INSPECTOR_MIN_PX) return n;
  }
  return INSPECTOR_DEFAULT_PX;
}

function isMethodologyModalDismissed(): boolean {
  try {
    return window.localStorage.getItem(METHODOLOGY_MODAL_KEY) === "true";
  } catch {
    return false;
  }
}

function InspectorResizeHandle({ onResizeStart }: { onResizeStart: (e: React.MouseEvent) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize node inspector"
      onMouseDown={onResizeStart}
      className="group flex w-1.5 shrink-0 cursor-ew-resize items-center justify-center border-l border-composer-border bg-composer-surface-muted hover:bg-gray-200 active:bg-gray-300"
    >
      <div className="h-10 w-0.5 rounded-full bg-gray-300 transition-colors group-hover:bg-gray-400 group-active:bg-gray-500" />
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
                <span className="mt-0.5 block text-xs font-medium opacity-70">Open {nav.tabLabel} tab</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ValidationStrip({ onIssueClick }: { onIssueClick: (issue: ValidationIssue) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const result = useValidationResult();

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
      <div
        className="flex items-center gap-1.5 text-xs text-emerald-600"
        title="No errors or warnings. Export readiness is shown on the Project tab."
      >
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
        title="Errors and warnings in the project model"
        className="flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs hover:bg-gray-100"
      >
        <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${hasErrors ? "text-red-500" : "text-amber-500"}`} />
        <span className="text-gray-600">
          {result.errors.length > 0 && (
            <span className="font-medium text-red-600">{result.errors.length} blocking</span>
          )}
          {result.errors.length > 0 && result.warnings.length > 0 ? <span aria-hidden> · </span> : null}
          {result.warnings.length > 0 && (
            <span className="text-amber-700">
              {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}
            </span>
          )}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-1/2 top-full z-50 mt-1 max-h-[min(60vh,420px)] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 overflow-auto rounded-anypoint border border-composer-border bg-composer-surface p-3 shadow-lg scrollbar-thin">
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
  onExitToProjects,
}: {
  importWarnings: string[];
  onDismissWarnings: () => void;
  onExitToProjects: () => void;
}) {
  const { project, undo, redo, canUndo, canRedo } = useComposer();
  const { helpMode, setHelpMode, toggleHelpMode } = useHelpMode();
  const validationResult = useValidationResult();
  const shellRef = useRef<HTMLDivElement>(null);
  const [graphViewMode, setGraphViewMode] = useState<GraphViewMode>("composer");
  const [panelTab, setPanelTab] = useState<PanelTab>("identity");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<ProjectFocusTarget | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pendingCanvasCommand, setPendingCanvasCommand] = useState<CanvasCommand | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewHeight, setPreviewHeight] = useState(PREVIEW_INITIAL_PX);
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_PX);
  const [orderedTabsOverride, setOrderedTabsOverride] = useState<boolean | null>(null);
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<PanelTab>>(() => new Set(["identity"]));
  const [methodologyModalOpen, setMethodologyModalOpen] = useState(false);
  const [dontShowMethodologyAgain, setDontShowMethodologyAgain] = useState(false);
  const showCanvas = isGraphPanelTab(panelTab);

  useEffect(() => {
    const dismissed = isMethodologyModalDismissed();
    setDontShowMethodologyAgain(dismissed);
    setMethodologyModalOpen(!dismissed);
  }, []);

  const gate = useMemo(
    () =>
      buildTabGate({
        project,
        validation: validationResult,
        visitedTabs,
        enabled: orderedTabsOverride ?? "auto",
      }),
    [project, validationResult, visitedTabs, orderedTabsOverride]
  );

  const canOpenTab = useCallback((next: PanelTab): boolean => !isTabLocked(gate, next), [gate]);

  const clampPreviewHeight = useCallback((height: number) => {
    const shell = shellRef.current;
    const max = shell ? Math.max(PREVIEW_MIN_PX, shell.clientHeight - MAIN_MIN_PX) : height;
    return Math.min(max, Math.max(PREVIEW_MIN_PX, height));
  }, []);

  const clampInspectorWidth = useCallback((width: number) => {
    const shell = shellRef.current;
    const max = shell ? Math.max(INSPECTOR_MIN_PX, Math.floor(shell.clientWidth * 0.5)) : width;
    return Math.min(max, Math.max(INSPECTOR_MIN_PX, width));
  }, []);

  // Restore persisted height after hydration to avoid SSR/client mismatch.
  useEffect(() => {
    setPreviewHeight(clampPreviewHeight(readStoredPreviewHeight()));
    setInspectorWidth(clampInspectorWidth(readStoredInspectorWidth()));
  }, [clampPreviewHeight, clampInspectorWidth]);

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

  const onInspectorResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = inspectorWidth;

      function onMove(ev: MouseEvent) {
        const delta = startX - ev.clientX;
        setInspectorWidth(clampInspectorWidth(startWidth + delta));
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setInspectorWidth((w) => {
          window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(w));
          return w;
        });
      }

      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [clampInspectorWidth, inspectorWidth]
  );

  useEffect(() => {
    function onWindowResize() {
      setPreviewHeight((h) => clampPreviewHeight(h));
      setInspectorWidth((w) => clampInspectorWidth(w));
    }
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [clampPreviewHeight, clampInspectorWidth]);

  const tryOpenTab = useCallback(
    (next: PanelTab): boolean => {
      if (!canOpenTab(next)) return false;
      setPanelTab(next);
      setVisitedTabs((seen) => (seen.has(next) ? seen : new Set(seen).add(next)));
      if (!isGraphPanelTab(next)) setSelectedNodeId(null);
      return true;
    },
    [canOpenTab]
  );

  function handlePanelTabChange(next: PanelTab) {
    tryOpenTab(next);
  }

  // An edit can re-lock the tab in view (clearing the project name while on a
  // later tab); fall back to the stage that now needs the work.
  const activeStageTab = gate.activeStage.primaryTab;
  useEffect(() => {
    if (!canOpenTab(panelTab)) {
      setPanelTab(activeStageTab);
      setVisitedTabs((seen) => (seen.has(activeStageTab) ? seen : new Set(seen).add(activeStageTab)));
      setSelectedNodeId(null);
      setPendingFocus(null);
    }
  }, [panelTab, canOpenTab, activeStageTab]);

  const handleValidationIssueClick = useCallback(
    (issue: ValidationIssue) => {
      const { tab, registry } = resolveIssueNavigation(issue);
      if (!tryOpenTab(tab)) return;
      const loc = issue.location;
      if (registry) {
        setPendingFocus({
          tab: "registry",
          registryKind: registry.kind,
          registryKey: registry.key,
          anchor: registry.anchor,
        });
      } else {
        setPendingFocus({
          tab,
          ...(loc.fieldAnchor ? { anchor: loc.fieldAnchor } : {}),
          ...(loc.nodeId ? { nodeId: loc.nodeId } : {}),
          ...(loc.assetId ? { assetId: loc.assetId } : {}),
        });
      }
      setSelectedNodeId(tab === "graph" ? loc.nodeId ?? null : null);
    },
    [tryOpenTab]
  );

  const handleProjectFocus = useCallback((target: ProjectFocusTarget) => {
    if (!tryOpenTab(target.tab)) return;
    setPendingFocus(target);
    if (target.tab === "graph" && target.nodeId) {
      setSelectedNodeId(target.nodeId);
    } else if (target.tab !== "graph") {
      setSelectedNodeId(null);
    }
  }, [tryOpenTab]);

  const handleFocusHandled = useCallback(() => {
    setPendingFocus(null);
  }, []);

  const handleCanvasCommandHandled = useCallback(() => {
    setPendingCanvasCommand(null);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditorSurface(event.target)) return;
      const shortcut = resolveShortcut(event);
      if (shortcut === "undo") {
        event.preventDefault();
        undo();
      } else if (shortcut === "redo") {
        event.preventDefault();
        redo();
      } else if (shortcut === "commandPalette") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const runCommand = useCallback(
    (command: Command) => {
      setPaletteOpen(false);
      const action = command.action;
      switch (action.kind) {
        case "openTab":
          if (!tryOpenTab(action.tab)) return;
          return;
        case "selectNode":
          if (!tryOpenTab("graph")) return;
          setGraphViewMode("composer");
          setSelectedNodeId(action.nodeId);
          return;
        case "addNode":
          if (!tryOpenTab("graph")) return;
          setGraphViewMode("composer");
          setPendingCanvasCommand({ kind: "addNode", nodeKind: action.nodeKind });
          return;
        case "resetLayout":
          if (!tryOpenTab("graph")) return;
          setGraphViewMode("composer");
          setPendingCanvasCommand({ kind: "resetLayout" });
          return;
        case "toggleHelp":
          toggleHelpMode();
          return;
        case "undo":
          undo();
          return;
        case "redo":
          redo();
          return;
        default: {
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }
    },
    [toggleHelpMode, undo, redo, tryOpenTab]
  );

  return (
    <div ref={shellRef} className="flex h-full flex-col bg-composer-surface-muted">
      <div className="flex items-center justify-between gap-4 border-b border-composer-border bg-gradient-to-r from-composer-surface via-composer-surface to-primary/[0.04] px-4 py-2">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            className="h-8 gap-1.5 px-2 text-xs text-composer-label-muted"
            onClick={onExitToProjects}
            title="Return to project picker"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Projects
          </Button>
          <span className="text-gray-300">|</span>
          <h1 className="inline-flex items-center gap-2 text-sm font-semibold text-gray-900">
            Agent Network Builder
            <BetaBadge />
          </h1>
          <span className="text-gray-300">/</span>
          <span className="max-w-[220px] truncate text-sm text-composer-label-muted">{project.identity.name}</span>
          <span className="text-gray-300">|</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              title="Undo (⌘Z)"
              aria-label="Undo"
              className="rounded-anypoint p-1.5 text-composer-label-muted transition-anypoint hover:bg-composer-surface-muted hover:text-composer-label disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              title="Redo (⇧⌘Z)"
              aria-label="Redo"
              className="rounded-anypoint p-1.5 text-composer-label-muted transition-anypoint hover:bg-composer-surface-muted hover:text-composer-label disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Redo2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        <ValidationStrip onIssueClick={handleValidationIssueClick} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title="Search and commands (⌘K)"
            className="inline-flex items-center gap-1.5 rounded-anypoint border border-composer-border px-2 py-1 text-xs text-composer-label-muted transition-anypoint hover:bg-composer-surface-muted hover:text-composer-label"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded border border-composer-border px-1 font-sans text-[10px] sm:inline">⌘K</kbd>
          </button>
          {showCanvas && (
            <SegmentedControl
              aria-label="Graph view mode"
              value={graphViewMode}
              onChange={(mode) => {
                setGraphViewMode(mode);
                setSelectedNodeId(null);
              }}
              options={[
                {
                  value: "composer",
                  label: (
                    <span className="inline-flex items-center gap-1">
                      Builder
                      <BetaBadge />
                    </span>
                  ),
                  icon: <MuleIcon name="organize" size={14} />,
                },
                {
                  value: "agentscript",
                  label: "AgentScript",
                  icon: <MuleIcon name="sourceCode" size={14} />,
                },
              ]}
            />
          )}
          <button
            type="button"
            onClick={toggleHelpMode}
            title="Help mode — highlight guidance throughout the builder"
            className={`inline-flex items-center gap-1 rounded-anypoint px-2 py-1 text-xs font-medium transition-anypoint ${
              helpMode ? "bg-primary/10 text-primary ring-1 ring-primary/20" : "text-composer-label-muted hover:bg-composer-surface-muted"
            }`}
          >
            <HelpCircle className="h-3.5 w-3.5" />
            Help
          </button>
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
            aria-label="Dismiss import warnings"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <ComposerNav
          tab={panelTab}
          onTabChange={handlePanelTabChange}
          gate={gate}
          onOrderedTabsChange={setOrderedTabsOverride}
          onOpenMethodology={() => setMethodologyModalOpen(true)}
          onRequirementFocus={handleProjectFocus}
        />
        {!showCanvas && (
          <div className="min-w-0 flex-1 overflow-hidden border-r border-gray-200">
            <ComposerPanelContent
              tab={panelTab}
              pendingFocus={pendingFocus}
              onFocusHandled={handleFocusHandled}
              onProjectFocus={handleProjectFocus}
            />
          </div>
        )}
        {showCanvas && (
          <>
            <div className="min-w-0 flex-1 bg-white">
              {graphViewMode === "composer" ? (
                <BrokerGraphEditor
                  selectedId={selectedNodeId}
                  onSelect={setSelectedNodeId}
                  pendingCommand={pendingCanvasCommand}
                  onCommandHandled={handleCanvasCommandHandled}
                  onRequestFocus={(target) => handleProjectFocus(target)}
                />
              ) : (
                <AgentScriptPanel />
              )}
            </div>
            {selectedNodeId && graphViewMode === "composer" && (
              <>
                <InspectorResizeHandle onResizeStart={onInspectorResizeStart} />
                <div
                  className="shrink-0 overflow-hidden border-l border-composer-border bg-composer-surface"
                  style={{ width: inspectorWidth }}
                >
                  <NodeInspector
                    nodeId={selectedNodeId}
                    onDeleted={() => setSelectedNodeId(null)}
                    focusAnchor={
                      pendingFocus?.tab === "graph" && pendingFocus.nodeId === selectedNodeId
                        ? pendingFocus.anchor
                        : null
                    }
                    onFocusAnchorHandled={handleFocusHandled}
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>

      {previewOpen ? (
        <div className="shrink-0 overflow-hidden bg-white" style={{ height: previewHeight }}>
          <FilePreview
            onToggle={() => setPreviewOpen(false)}
            onResizeStart={onPreviewResizeStart}
          />
        </div>
      ) : (
        <ProjectFilesClosedBar onOpen={() => setPreviewOpen(true)} />
      )}

      {paletteOpen ? (
        <CommandPalette onRun={runCommand} onClose={() => setPaletteOpen(false)} />
      ) : null}

      <ProjectMethodologyModal
        open={methodologyModalOpen}
        helpModeEnabled={helpMode}
        dontShowAgain={dontShowMethodologyAgain}
        onDontShowAgainChange={setDontShowMethodologyAgain}
        onDisableHighlights={() => setHelpMode(false)}
        onClose={() => {
          try {
            if (dontShowMethodologyAgain) {
              window.localStorage.setItem(METHODOLOGY_MODAL_KEY, "true");
            } else {
              window.localStorage.removeItem(METHODOLOGY_MODAL_KEY);
            }
          } catch {
            /* ignore */
          }
          setMethodologyModalOpen(false);
        }}
      />
    </div>
  );
}

function Root() {
  const [phase, setPhase] = useState<ComposerSessionPhase>("choosing");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  useEffect(() => {
    const restoredPhase = loadComposerPhaseFromSession();
    if (restoredPhase) setPhase(restoredPhase);
  }, []);

  useEffect(() => {
    saveComposerPhaseToSession(phase);
    if (phase === "editing") markComposerDraft();
  }, [phase]);

  if (phase === "choosing") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ComposerLanding
          onEnter={(warnings) => {
            setImportWarnings(warnings ?? []);
            markComposerDraft();
            setPhase("editing");
          }}
        />
      </div>
    );
  }

  return (
    <Inner
      importWarnings={importWarnings}
      onDismissWarnings={() => setImportWarnings([])}
      onExitToProjects={() => setPhase("choosing")}
    />
  );
}

export default function ComposerShell() {
  return (
    <ComposerProvider>
      <ValidationProvider>
        <HelpModeProvider>
          <Root />
        </HelpModeProvider>
      </ValidationProvider>
    </ComposerProvider>
  );
}
