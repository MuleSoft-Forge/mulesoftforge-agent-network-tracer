"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
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
import { getDesktop, isDesktop } from "@/lib/desktop/bridge";
import { setLastProjectDir } from "@/lib/desktop/last-project-path";
import { clearComposerSession, hasComposerDraft } from "@/lib/composer/session-persistence";
import { importLocalProjectEntries } from "@/lib/composer/import/import-local-project";
import { COMPOSER_EXAMPLES } from "@/lib/composer/examples/catalog";
import { loadComposerExample } from "@/lib/composer/examples/load-example";
import type { ComposerExampleId } from "@/lib/composer/examples/catalog";

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

  const [localDesktopError, setLocalDesktopError] = useState<string | null>(null);
  const [exampleError, setExampleError] = useState<string | null>(null);
  const [showDraftResume, setShowDraftResume] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);

  const [selectedKey, setSelectedKey] = useState("");
  const [selectedVersion, setSelectedVersion] = useState("");

  const selectedNetwork = useMemo(
    () => networks.find((n) => networkKey(n) === selectedKey),
    [networks, selectedKey]
  );

  useEffect(() => {
    setExpanded(getStoredExpanded());
    setShowDraftResume(hasComposerDraft());
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
      setLocalDesktopError(null);
      return;
    }
    setOrgId(value);
    setSelectedKey("");
    setSelectedVersion("");
    clearSelection();
    setLocalDesktopError(null);
    setExampleError(null);
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
    const files = e.target.files;
    if (!files?.length) return;
    setLocalDesktopError(null);
    const result = await importFromFolder(files, orgId || undefined);
    if (result) openLocalProject(result);
  }

  async function handleDesktopPickFolder() {
    const desktop = getDesktop();
    if (!desktop) return;
    setLocalDesktopError(null);
    const dir = await desktop.cli.pickProject();
    if (!dir) return;
    const read = await desktop.cli.readLocalProject(dir);
    if (!read.ok) {
      setLocalDesktopError(read.error);
      return;
    }
    try {
      const result = importLocalProjectEntries(read.entries, orgId || undefined);
      openLocalProject(result, dir);
    } catch (e) {
      setLocalDesktopError(e instanceof Error ? e.message : "Failed to open local project");
    }
  }

  async function handlePickLocalFolder() {
    if (isDesktop()) {
      await handleDesktopPickFolder();
      return;
    }
    folderInputRef.current?.click();
  }

  async function handleLocalZipChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await importFromZip(file, orgId || undefined);
    if (result) openLocalProject(result);
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
              initialOrgId={project.identity.organizationId?.trim() || undefined}
              onSelect={handleBusinessGroupSelect}
            />
          </div>

          <div className="border-t border-gray-200 bg-white px-3 py-2">
            <p className="text-xs text-gray-600">
              Questions:{" "}
              <a
                href="mailto:jeffcock@mulesoftforge.com"
                className="text-primary hover:text-indigo-700 hover:underline"
              >
                Ask Me
              </a>
            </p>
          </div>
        </div>
      </div>

      {/* Main content — project picker, not a marketing hero */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-composer-surface-muted px-6 py-8 md:py-10">
        <div className="mx-auto w-full max-w-4xl">
          {showDraftResume ? (
            <section className="mb-8 border-l-4 border-primary bg-white px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">Saved draft</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-gray-900">
                {project.identity.name}
              </h2>
              {project.identity.assetId ? (
                <p className="mt-0.5 font-mono text-xs text-gray-500">{project.identity.assetId}</p>
              ) : null}
              {project.identity.organizationId?.trim() ? (
                <p className="mt-0.5 font-mono text-xs text-gray-500">
                  {project.identity.organizationId.trim()}
                </p>
              ) : (
                <p className="mt-2 text-xs text-amber-700">
                  Organization id missing — select your business group in the sidebar, then continue.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  disabled={!project.identity.organizationId?.trim() && !orgId}
                  onClick={handleContinueEditing}
                >
                  Continue editing <ArrowRight className="h-4 w-4" />
                </Button>
                <Button variant="secondary" onClick={handleDiscardDraft}>
                  Discard draft
                </Button>
              </div>
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
                Compose broker graphs, wire Exchange assets, and export project files locally.
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
            <div className="mb-6 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              {/* Start blank — one-click path, smaller panel */}
              <section className="flex flex-col justify-between rounded-anypoint border border-composer-border bg-white p-5">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <MuleIcon name="agentNetwork" size={18} />
                    <h2 className="text-sm font-semibold text-gray-900">Start blank</h2>
                  </div>
                  <p className="text-xs leading-relaxed text-composer-label-muted">
                    Empty identity, broker shell, and graph — fill in project details and build from scratch.
                  </p>
                </div>
                <Button variant="primary" className="mt-5 w-full" onClick={handleCreateNew}>
                  Create blank network <ArrowRight className="h-4 w-4" />
                </Button>
              </section>

              {/* Exchange — primary path, more room for selects */}
              <section className="flex flex-col rounded-anypoint border border-composer-border bg-white p-5">
                <div className="mb-4 flex items-center gap-2">
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
                      {importError ? (
                        <p className="rounded-anypoint border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                          {importError}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>

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
              </section>
            </div>
          )}

          {!noBusinessGroup ? (
            <section className="mb-6 rounded-anypoint border border-composer-border bg-white p-5">
              <div className="mb-3 flex items-center gap-2">
                <MuleIcon name="agentNetwork" size={18} />
                <h2 className="text-sm font-semibold text-gray-900">Try a MuleSoft example</h2>
              </div>
              <p className="text-xs leading-relaxed text-composer-label-muted">
                Open an official Agent Network 2.0 sample in Builder — explore a full broker graph, registry, and
                connections without starting from scratch.
              </p>
              <ul className="mt-4 space-y-3">
                {COMPOSER_EXAMPLES.map((example) => (
                  <li
                    key={example.id}
                    className="flex flex-col gap-3 rounded-anypoint border border-composer-border bg-composer-surface-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{example.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-composer-label-muted">{example.summary}</p>
                      <a
                        href={example.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                      >
                        View on GitHub <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    </div>
                    <Button
                      variant="secondary"
                      className="shrink-0 sm:w-auto"
                      onClick={() => handleLoadExample(example.id)}
                    >
                      Open in Builder <ArrowRight className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
              {exampleError ? (
                <p className="mt-3 rounded-anypoint border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                  {exampleError}
                </p>
              ) : null}
            </section>
          ) : null}

          {/* Local import — tertiary, not a third equal card */}
          <section className="border-t border-composer-border pt-5">
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

            <p className="text-xs font-medium text-composer-label">Or open a local project</p>
            <p className="mt-0.5 text-[11px] text-composer-label-muted">
              Folder or zip with exchange.json, agent-network.yaml, and brokers/*.agent
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                disabled={localImporting}
                onClick={() => void handlePickLocalFolder()}
                className="text-sm font-medium text-primary hover:text-primary/80 disabled:opacity-50"
              >
                {localImporting ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading…
                  </span>
                ) : (
                  "Choose project folder"
                )}
              </button>
              <span className="text-composer-border" aria-hidden>
                ·
              </span>
              <button
                type="button"
                disabled={localImporting}
                onClick={() => zipInputRef.current?.click()}
                className="text-sm font-medium text-primary hover:text-primary/80 disabled:opacity-50"
              >
                Choose project zip
              </button>
              {!orgId ? (
                <span className="text-[11px] text-composer-label-muted">
                  (select a business group to fill missing org ids)
                </span>
              ) : null}
            </div>
            {isDesktop() ? (
              <p className="mt-2 text-[11px] text-composer-label-muted">
                On desktop, the same folder is remembered for Build &amp; Publish.
              </p>
            ) : null}
            {localDesktopError ? (
              <p className="mt-2 rounded-anypoint border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                {localDesktopError}
              </p>
            ) : null}
            {localError ? (
              <p className="mt-2 rounded-anypoint border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                {localError}
              </p>
            ) : null}
          </section>

          <section className="mt-8 border-t border-composer-border pt-4">
            <button
              type="button"
              onClick={() => setIntroOpen((open) => !open)}
              className="flex w-full items-center gap-2 text-left text-sm font-medium text-composer-label-muted transition-anypoint hover:text-composer-label"
              aria-expanded={introOpen}
            >
              {introOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0" />
              )}
              New to Builder?
            </button>
            {introOpen ? (
              <ul className="mt-3 space-y-2.5 border-l-2 border-composer-border pl-4 text-sm leading-relaxed text-composer-label-muted">
                <li>
                  <strong className="font-medium text-gray-900">Visual first, text second.</strong> Design the
                  broker graph on the canvas; AgentScript stays in sync for review and export.
                </li>
                <li>
                  <strong className="font-medium text-gray-900">Compose from Exchange or registry.</strong> Wire
                  published agents, MCPs, and LLMs from Exchange, or define registry-local entities — Builder does
                  not publish new Exchange assets.
                </li>
                <li>
                  <strong className="font-medium text-gray-900">One broker per network (for now).</strong> Each
                  project models a single broker graph.
                </li>
              </ul>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
