"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { MuleIcon } from "@/components/composer/MuleIcon";
import BetaBadge from "@/components/ui/BetaBadge";
import { useComposer } from "@/lib/composer/store";
import { Button, SelectField } from "@/components/composer/ui";
import BusinessGroupSelector from "@/components/BusinessGroupSelector";
import {
  useExchangeNetworkList,
  type ExchangeNetworkListItem,
} from "@/components/main-content/useExchangeNetworkList";
import { useExchangeNetworkImport } from "@/components/composer/useExchangeNetworkImport";
import { useLocalProjectImport } from "@/components/composer/useLocalProjectImport";
import type { LocalProjectImportResult } from "@/components/composer/useLocalProjectImport";
import { setLastProjectDir } from "@/lib/desktop/last-project-path";
import { clearComposerSession, hasComposerDraft } from "@/lib/composer/session-persistence";
import {
  deleteSavedProject,
  listSavedProjects,
  savedProjectId,
  PROJECT_LIBRARY_CHANGED_EVENT,
  type SavedProjectEntry,
} from "@/lib/composer/project-library";
import { AGENT_NETWORK_BEST_PRACTICES_URL } from "@/lib/composer/anf-docs-urls";
import { COMPOSER_EXAMPLES, COMPOSER_WORKSHOP_TEMPLATE } from "@/lib/composer/examples/catalog";
import { loadComposerExample } from "@/lib/composer/examples/load-example";
import type { ComposerExampleId } from "@/lib/composer/examples/catalog";
import { readAnypointUiContext, writeAnypointUiContext } from "@/lib/anypoint/ui-context";

const SIDEBAR_EXPANDED_KEY = "agent-network-sidebar-expanded";

function getStoredExpanded(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(SIDEBAR_EXPANDED_KEY);
    return v !== "false";
  } catch {
    return true;
  }
}

function networkKey(n: Pick<ExchangeNetworkListItem, "groupId" | "assetId">): string {
  return `${n.groupId}:${n.assetId}`;
}

export default function ComposerLanding({
  onEnter,
}: {
  onEnter: (importWarnings?: string[]) => void;
}) {
  const { project, dispatch } = useComposer();
  const [expanded, setExpanded] = useState(true);
  const [orgId, setOrgId] = useState("");

  const { networks, loading, error, refresh } = useExchangeNetworkList(orgId);
  const { importNetwork, importing, error: importError } = useExchangeNetworkImport();
  const {
    importing: localImporting,
    error: localError,
    folderInputRef,
    zipInputRef,
    importFromFolder,
    importFromZip,
    clearSelection,
  } = useLocalProjectImport();

  const [localProjectError, setLocalProjectError] = useState<string | null>(null);
  const [exampleError, setExampleError] = useState<string | null>(null);
  const [showDraftResume, setShowDraftResume] = useState(false);
  const [savedProjects, setSavedProjects] = useState<SavedProjectEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedVersion, setSelectedVersion] = useState("");

  const selectedNetwork = useMemo(
    () => networks.find((n) => networkKey(n) === selectedKey),
    [networks, selectedKey]
  );

  // The current draft and its browser-saved copy share one savedProjectId, so a
  // saved project that IS the current draft would otherwise show twice. Drop it
  // from the saved list and let the draft card stand in for it.
  const savedToShow = useMemo(() => {
    const currentId = showDraftResume ? savedProjectId(project) : null;
    return currentId ? savedProjects.filter((e) => e.id !== currentId) : savedProjects;
  }, [savedProjects, showDraftResume, project]);

  useEffect(() => {
    setExpanded(getStoredExpanded());
    setShowDraftResume(hasComposerDraft());
    const current = readAnypointUiContext();
    if (current?.orgId) {
      setOrgId(current.orgId);
    }
  }, []);

  useEffect(() => {
    const syncSavedProjects = () => setSavedProjects(listSavedProjects());
    syncSavedProjects();
    // "storage" keeps a second tab in step; the custom event covers this tab.
    window.addEventListener("storage", syncSavedProjects);
    window.addEventListener(PROJECT_LIBRARY_CHANGED_EVENT, syncSavedProjects);
    return () => {
      window.removeEventListener("storage", syncSavedProjects);
      window.removeEventListener(PROJECT_LIBRARY_CHANGED_EVENT, syncSavedProjects);
    };
  }, []);

  function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(next));
    } catch {
      /* ignore */
    }
  }

  function openLocalProject(result: LocalProjectImportResult, projectDir?: string | null) {
    if (projectDir) {
      setLastProjectDir(projectDir);
    }
    dispatch({ type: "loadProject", project: result.project });
    if (!result.project.identity.organizationId && orgId) {
      dispatch({ type: "setIdentity", patch: { organizationId: orgId } });
    }
    onEnter(result.warnings);
  }

  function handleBusinessGroupSelect(value: string) {
    if (!value) {
      setOrgId("");
      setSelectedKey("");
      setSelectedVersion("");
      clearSelection();
      setLocalProjectError(null);
      writeAnypointUiContext(null);
      return;
    }
    const currentContext = readAnypointUiContext();
    if (currentContext?.orgId === value) {
      setOrgId(value);
      setSelectedKey("");
      setSelectedVersion("");
      clearSelection();
      setLocalProjectError(null);
      setExampleError(null);
      writeAnypointUiContext(
        currentContext.envId ? { orgId: value, envId: currentContext.envId } : { orgId: value }
      );
      return;
    }
    setOrgId(value);
    setSelectedKey("");
    setSelectedVersion("");
    clearSelection();
    setLocalProjectError(null);
    setExampleError(null);
    writeAnypointUiContext({ orgId: value });
  }

  function handleLoadExample(exampleId: ComposerExampleId) {
    if (!orgId) return;
    setExampleError(null);
    try {
      const result = loadComposerExample(exampleId, orgId);
      dispatch({ type: "loadProject", project: result.project });
      if (!result.project.identity.organizationId && orgId) {
        dispatch({ type: "setIdentity", patch: { organizationId: orgId } });
      }
      onEnter(result.warnings);
    } catch (e) {
      setExampleError(e instanceof Error ? e.message : "Failed to load example");
    }
  }

  function handleContinueEditing() {
    const savedOrgId = project.identity.organizationId?.trim();
    const sidebarOrgId = orgId.trim();
    if (!savedOrgId && sidebarOrgId) {
      dispatch({ type: "setIdentity", patch: { organizationId: sidebarOrgId } });
    }
    onEnter();
  }

  function handleCreateNew() {
    if (!orgId) return;
    dispatch({ type: "resetProject", organizationId: orgId });
    onEnter();
  }

  async function handleImport() {
    if (!selectedNetwork || !selectedVersion) return;
    const result = await importNetwork(
      { groupId: selectedNetwork.groupId, assetId: selectedNetwork.assetId, name: selectedNetwork.name },
      selectedVersion
    );
    if (!result) return;
    dispatch({ type: "loadProject", project: result.project });
    if (!result.project.identity.organizationId && orgId) {
      dispatch({ type: "setIdentity", patch: { organizationId: orgId } });
    }
    onEnter(result.warnings);
  }

  async function handleLocalFolderChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!orgId) {
      setLocalProjectError("Select a business group first.");
      return;
    }
    const files = e.target.files;
    if (!files?.length) return;
    setLocalProjectError(null);
    const result = await importFromFolder(files, orgId);
    if (result) openLocalProject(result);
  }

  async function handlePickLocalFolder() {
    if (!orgId) {
      setLocalProjectError("Select a business group first.");
      return;
    }
    folderInputRef.current?.click();
  }

  async function handleLocalZipChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!orgId) {
      setLocalProjectError("Select a business group first.");
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalProjectError(null);
    const result = await importFromZip(file, orgId);
    if (result) openLocalProject(result);
  }

  function handleOpenSavedProject(entry: SavedProjectEntry) {
    dispatch({ type: "loadProject", project: entry.project });
    if (!entry.project.identity.organizationId && orgId) {
      dispatch({ type: "setIdentity", patch: { organizationId: orgId } });
    }
    onEnter();
  }

  function handleDiscardSavedProject(entry: SavedProjectEntry) {
    const label = entry.project.identity.name || entry.id;
    if (!window.confirm(`Discard "${label}"? The saved copy in this browser will be deleted.`)) {
      return;
    }
    deleteSavedProject(entry.id);
    setSavedProjects(listSavedProjects());
  }

  function handleDiscardDraft() {
    if (
      !window.confirm(
        "Discard your current Builder draft? Unsaved work in this browser session will be lost."
      )
    ) {
      return;
    }
    clearComposerSession();
    dispatch({ type: "resetProject", organizationId: orgId || undefined });
    setShowDraftResume(false);
  }

  const noBusinessGroup = !orgId;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left sidebar — same shell as Tracer (LeftSidebar) */}
      <div
        className={`flex h-full min-h-0 shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] ${
          expanded ? "w-72" : "w-12"
        }`}
      >
        <div className="flex h-10 items-center justify-end border-b border-gray-100 px-2">
          <button
            type="button"
            onClick={handleToggle}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          >
            {expanded ? (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>

        <div
          className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
            !expanded ? "w-0 min-w-0 overflow-hidden opacity-0 pointer-events-none" : ""
          }`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
            <BusinessGroupSelector
              initialOrgId={project.identity.organizationId?.trim() || orgId || undefined}
              onSelect={handleBusinessGroupSelect}
            />
          </div>

        </div>
      </div>

      {/* Main content — project picker, not a marketing hero */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-composer-surface-muted px-6 py-8 md:py-10">
        <div className="mx-auto w-full max-w-4xl">
          {showDraftResume || savedToShow.length > 0 ? (
            <section className="mb-8 rounded-anypoint border border-composer-border bg-white p-5">
              <div className="mb-1 flex items-center gap-2">
                <MuleIcon name="agentNetwork" size={18} />
                <h2 className="text-sm font-semibold text-gray-900">Projects in this browser</h2>
              </div>
              <p className="text-xs leading-relaxed text-composer-label-muted">
                Your current draft plus anything you kept with <strong>Save in browser</strong>. Opening one
                replaces the project currently in the Builder, so save that first if you still need it.
              </p>
              <ul className="mt-4 space-y-2">
                {showDraftResume ? (
                  <li className="rounded-anypoint border border-l-4 border-composer-border border-l-primary bg-composer-surface-muted/20 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                            Current
                          </span>
                          <p className="truncate text-sm font-semibold text-gray-900">
                            {project.identity.name || "Untitled network"}
                          </p>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500">
                          {project.identity.assetId || "no-asset-id"}
                          {project.identity.version ? ` · ${project.identity.version}` : ""}
                        </p>
                        {project.identity.organizationId?.trim() ? (
                          <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500">
                            {project.identity.organizationId.trim()}
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] text-amber-700">
                            Organization id missing — select your business group in the sidebar, then continue.
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="primary"
                          disabled={!project.identity.organizationId?.trim() && !orgId}
                          onClick={handleContinueEditing}
                        >
                          Continue editing <ArrowRight className="h-4 w-4" />
                        </Button>
                        <Button variant="danger" onClick={handleDiscardDraft}>
                          <Trash2 className="h-3.5 w-3.5" /> Discard
                        </Button>
                      </div>
                    </div>
                  </li>
                ) : null}
                {savedToShow.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center gap-3 rounded-anypoint border border-composer-border bg-composer-surface-muted/20 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {entry.project.identity.name || "Untitled network"}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-gray-500">
                        {entry.project.identity.assetId || "no-asset-id"}
                        {entry.project.identity.version ? ` · ${entry.project.identity.version}` : ""}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-composer-label-muted">
                        Saved {new Date(entry.savedAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="primary" onClick={() => handleOpenSavedProject(entry)}>
                        Open <ArrowRight className="h-4 w-4" />
                      </Button>
                      <Button variant="danger" onClick={() => handleDiscardSavedProject(entry)}>
                        <Trash2 className="h-3.5 w-3.5" /> Discard
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <header className="mb-8 flex items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-composer-label-muted">
                Agent Network Builder
                <BetaBadge />
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
                Open or create a project
              </h1>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-composer-label-muted">
                Compose broker graphs, wire Exchange assets, build, and export project files locally.
              </p>
            </div>
            <div className="relative hidden h-24 w-24 shrink-0 sm:block md:h-28 md:w-28">
              <Image
                src="/images/builder-ant.png"
                alt=""
                fill
                priority
                aria-hidden
                className="scale-[1.35] object-contain mix-blend-multiply"
                sizes="112px"
              />
            </div>
          </header>

          {noBusinessGroup ? (
            <div className="mb-8 flex items-center gap-3 rounded-anypoint border border-dashed border-composer-border bg-white px-4 py-5 text-sm text-composer-label-muted">
              <ArrowLeft className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span>Select a business group in the sidebar to create or import an agent network.</span>
            </div>
          ) : (
            <>
              <input
                ref={folderInputRef}
                type="file"
                className="hidden"
                multiple
                {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
                onChange={(e) => void handleLocalFolderChange(e)}
              />
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) => void handleLocalZipChange(e)}
              />

              <section className="mb-6 grid gap-4 sm:grid-cols-3">
                {/* Exchange */}
                <article className="flex h-full flex-col rounded-anypoint border border-composer-border bg-white p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <MuleIcon name="exchange" size={18} />
                    <h2 className="text-sm font-semibold text-gray-900">Open from Exchange</h2>
                  </div>
                  <div className="flex-1 space-y-3">
                    {loading ? (
                      <div className="flex items-center gap-2 text-xs text-composer-label-muted">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading agent networks…
                      </div>
                    ) : error ? (
                      <div className="space-y-2">
                        <p className="text-xs text-red-600">{error}</p>
                        <Button variant="secondary" className="h-7 px-2 text-xs" onClick={() => void refresh()}>
                          Retry
                        </Button>
                      </div>
                    ) : networks.length === 0 ? (
                      <p className="text-xs text-composer-label-muted">
                        No agent networks found in this organization.
                      </p>
                    ) : (
                      <>
                        <SelectField
                          label="Agent network"
                          uppercaseLabel
                          value={selectedKey}
                          options={[
                            { value: "", label: "Select a network…" },
                            ...networks.map((n) => ({ value: networkKey(n), label: n.name })),
                          ]}
                          onChange={(v) => {
                            setSelectedKey(v);
                            setSelectedVersion("");
                          }}
                        />
                        <SelectField
                          label="Version"
                          uppercaseLabel
                          value={selectedVersion}
                          disabled={!selectedNetwork}
                          options={[
                            { value: "", label: "Select a version…" },
                            ...(selectedNetwork?.versions.map((v) => ({
                              value: v.version,
                              label: `${v.version}${v.status ? ` (${v.status})` : ""}`,
                            })) ?? []),
                          ]}
                          onChange={setSelectedVersion}
                        />
                      </>
                    )}
                  </div>
                  {importError ? (
                    <p className="mt-3 rounded-anypoint border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                      {importError}
                    </p>
                  ) : null}
                  <Button
                    variant="primary"
                    className="mt-4 w-full"
                    disabled={!selectedNetwork || !selectedVersion || importing}
                    onClick={() => void handleImport()}
                  >
                    {importing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Importing…
                      </>
                    ) : (
                      <>
                        Open in Builder <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </article>

                {/* Local */}
                <article className="flex h-full flex-col rounded-anypoint border border-composer-border bg-white p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <MuleIcon name="agentNetwork" size={18} />
                    <h2 className="text-sm font-semibold text-gray-900">Open local project</h2>
                  </div>
                  <p className="text-xs leading-relaxed text-composer-label-muted">
                    Folder or zip with <span className="font-mono">exchange.json</span>,{" "}
                    <span className="font-mono">agent-network.yaml</span>, and{" "}
                    <span className="font-mono">brokers/*.agent</span>.
                  </p>
                  <div className="mt-4 flex-1 space-y-2">
                    <Button
                      variant="secondary"
                      className="w-full justify-center"
                      disabled={localImporting}
                      onClick={() => void handlePickLocalFolder()}
                    >
                      {localImporting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Reading…
                        </>
                      ) : (
                        "Choose project folder"
                      )}
                    </Button>
                    <Button
                      variant="secondary"
                      className="w-full justify-center"
                      disabled={localImporting}
                      onClick={() => zipInputRef.current?.click()}
                    >
                      Choose project zip
                    </Button>
                  </div>
                  {localProjectError ? (
                    <p className="mt-2 rounded-anypoint border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                      {localProjectError}
                    </p>
                  ) : null}
                  {localError ? (
                    <p className="mt-2 rounded-anypoint border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                      {localError}
                    </p>
                  ) : null}
                </article>

                {/* Blank */}
                <article className="flex h-full flex-col rounded-anypoint border border-composer-border bg-white p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <MuleIcon name="agentNetwork" size={18} />
                    <h2 className="text-sm font-semibold text-gray-900">Start blank</h2>
                  </div>
                  <p className="flex-1 text-xs leading-relaxed text-composer-label-muted">
                    Empty identity, broker shell, and graph — build from scratch.
                  </p>
                  <Button variant="primary" className="mt-4 w-full" onClick={handleCreateNew}>
                    Create blank network <ArrowRight className="h-4 w-4" />
                  </Button>
                </article>
              </section>
            </>
          )}

          {exampleError ? (
            <p className="mb-6 rounded-anypoint border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
              {exampleError}
            </p>
          ) : null}

          {!noBusinessGroup ? (
            <section className="mb-6 rounded-anypoint border border-composer-border bg-white p-5">
              <div className="mb-3 flex items-center gap-2">
                <MuleIcon name="agentNetwork" size={18} />
                <h2 className="text-sm font-semibold text-gray-900">Examples</h2>
              </div>
              <p className="text-xs leading-relaxed text-composer-label-muted">
                Open an official Agent Network 2.0 sample in Builder — explore a full broker graph, registry, and
                connections without starting from scratch.
              </p>
              <ul className="mt-4 space-y-3">
                {/* Featured workshop template — full picture and write-up */}
                <li className="overflow-hidden rounded-anypoint border border-composer-border bg-composer-surface-muted/20">
                  <div className="p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
                      {COMPOSER_WORKSHOP_TEMPLATE.eyebrow}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">
                      {COMPOSER_WORKSHOP_TEMPLATE.title}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-composer-label-muted">
                      {COMPOSER_WORKSHOP_TEMPLATE.summary}
                    </p>
                    <a
                      href={COMPOSER_WORKSHOP_TEMPLATE.workshopUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                    >
                      {COMPOSER_WORKSHOP_TEMPLATE.workshopLabel}{" "}
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>

                    <Image
                      src={COMPOSER_WORKSHOP_TEMPLATE.imageSrc}
                      alt={COMPOSER_WORKSHOP_TEMPLATE.imageAlt}
                      width={COMPOSER_WORKSHOP_TEMPLATE.imageWidth}
                      height={COMPOSER_WORKSHOP_TEMPLATE.imageHeight}
                      className="mt-4 h-auto w-full rounded-anypoint border border-composer-border bg-white"
                      sizes="(min-width: 896px) 896px, 100vw"
                    />

                    <ul className="mt-4 space-y-1.5 text-xs leading-relaxed text-composer-label-muted">
                      {COMPOSER_WORKSHOP_TEMPLATE.highlights.map((highlight, i) => (
                        <li key={i} className="flex gap-2">
                          <span
                            className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary"
                            aria-hidden
                          />
                          <span>{highlight}</span>
                        </li>
                      ))}
                    </ul>

                    <p className="mt-3 rounded-anypoint border border-composer-border bg-white px-3 py-2 text-[11px] leading-relaxed text-composer-label-muted">
                      {COMPOSER_WORKSHOP_TEMPLATE.note}
                    </p>

                    <Button
                      variant="primary"
                      className="mt-4 self-start"
                      onClick={() => handleLoadExample(COMPOSER_WORKSHOP_TEMPLATE.id)}
                    >
                      Open in Builder <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </li>

                {COMPOSER_EXAMPLES.map((example) => (
                  <li
                    key={example.id}
                    className="overflow-hidden rounded-anypoint border border-composer-border bg-composer-surface-muted/20"
                  >
                    <div className="p-4">
                      {example.eyebrow ? (
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
                          {example.eyebrow}
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm font-semibold text-gray-900">{example.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-composer-label-muted">{example.summary}</p>
                      <a
                        href={example.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                      >
                        View on GitHub <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>

                      {example.imageSrc && example.imageWidth && example.imageHeight ? (
                        <Image
                          src={example.imageSrc}
                          alt={example.imageAlt ?? `${example.title} diagram`}
                          width={example.imageWidth}
                          height={example.imageHeight}
                          className="mt-4 h-auto w-full rounded-anypoint border border-composer-border bg-white"
                          sizes="(min-width: 896px) 896px, 100vw"
                        />
                      ) : null}

                      <Button
                        variant="primary"
                        className="mt-4 self-start"
                        onClick={() => handleLoadExample(example.id)}
                      >
                        Open in Builder <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mt-8 border-t border-composer-border pt-5">
            <p className="text-xs font-medium text-composer-label">Governance</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-composer-label-muted">
              MuleSoft publishes a best-practices ruleset for agent networks — policy coverage, MCP tool
              permissions, agent card completeness, and topology limits. Builder warns on some of these as you
              edit.
            </p>
            <a
              href={AGENT_NETWORK_BEST_PRACTICES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80"
            >
              Agent Network Best Practices on Exchange <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
